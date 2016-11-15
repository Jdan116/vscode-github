import {join} from 'path';
import * as sander from 'sander';
import * as vscode from 'vscode';
import * as git from './git';
import {GitHubError} from './github';
import {StatusBarManager} from './status-bar-manager';
import {GitHubManager} from './github-manager';

let cwd: string;
let channel: vscode.OutputChannel;
let githubManager: GitHubManager;
let statusBarManager: StatusBarManager;

export function activate(context: vscode.ExtensionContext): void {
  cwd = vscode.workspace.rootPath;

  channel = vscode.window.createOutputChannel('github');
  context.subscriptions.push(channel);
  channel.appendLine('Visual Studio Code GitHub Extension');

  githubManager = new GitHubManager(cwd, channel);
  statusBarManager = new StatusBarManager(context, githubManager);

  const token = getToken(context);
  if (token) {
    githubManager.connect(token);
  }
  checkVersionAndToken(context, token);

  context.subscriptions.push(
    vscode.commands.registerCommand('extension.setGitHubToken',
      createGithubTokenCommand(context)));
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.createPullRequest',
      wrapCommand(createPullRequest)));
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.checkoutPullRequests',
      wrapCommand(checkoutPullRequests)));
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.browserPullRequest',
      wrapCommand(browserPullRequest)));
}

function checkVersionAndToken(context: vscode.ExtensionContext, token: string|undefined): void {
  sander.readFile(join(context.extensionPath, 'package.json'))
    .then(content => JSON.parse(content))
    .then(json => json.version as string)
    .then((version) => {
      const storedVersion = context.globalState.get('version-test');
      if (version !== storedVersion && !Boolean(token)) {
        context.globalState.update('version-test', version);
        vscode.window.showInformationMessage(
          'To enable the Visual Studio Code GitHub Support, please set a Personal Access Token');
      }
    });
}

function wrapCommand<T>(command: T): T {
  const wrap: any = (...args: any[]) => {
    if (githubManager.connected && cwd) {
      return (command as any).apply(null, args);
    } else {
      vscode.window.showWarningMessage('Please setup your Github Personal Access Token '
        + 'and open a GitHub project in your workspace');
    }
  };
  return wrap;
}

function getToken(context: vscode.ExtensionContext): string|undefined {
  return context.globalState.get<string|undefined>('token');
}

function logAndShowError(e: Error): void {
    channel.appendLine(e.message);
    if (e instanceof GitHubError) {
      console.error(e.response);
      vscode.window.showErrorMessage('GitHub error: ' + e.message);
    } else {
      vscode.window.showErrorMessage('Error: ' + e.message);
    }
}

function createGithubTokenCommand(context: vscode.ExtensionContext): () => PromiseLike<void> {
  return () => {
    const options = {
      ignoreFocusOut: true,
      password: true,
      placeHolder: 'GitHub Personal Access Token'
    };
    return vscode.window.showInputBox(options)
      .then(input => {
        context.globalState.update('token', input);
        githubManager.connect(input);
      });
  };
}

async function createPullRequest(): Promise<void> {
  try {
    const pullRequest = await githubManager.createPullRequest();
    if (pullRequest) {
      statusBarManager.updatePullRequestStatus(true);
      vscode.window.showInformationMessage(`Successfully created #${pullRequest.number}`);
    }
  } catch (e) {
    logAndShowError(e);
  }
}

async function checkoutPullRequests(): Promise<void> {
  try {
    const pullRequests = await githubManager.listPullRequests();
    vscode.window.showQuickPick(pullRequests.map(pullRequest => ({
      label: pullRequest.title,
      description: `#${pullRequest.number}`,
      pullRequest
    }))).then(selected => {
      if (selected) {
        git.checkout(cwd, selected.pullRequest.head.ref)
          .then(() => {
            statusBarManager.updatePullRequestStatus();
          });
      }
    });
  } catch (e) {
    logAndShowError(e);
  }
}

async function browserPullRequest(): Promise<void> {
  try {
    const response = await githubManager.listPullRequests();
    vscode.window.showQuickPick(response.map(pullRequest => ({
      label: pullRequest.title,
      description: `#${pullRequest.number}`,
      pullRequest
    }))).then(selected => {
      if (selected) {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(selected.pullRequest.html_url));
      }
    });
  } catch (e) {
    logAndShowError(e);
  }
}
