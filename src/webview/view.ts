import * as vscode from 'vscode';
import { logger } from '../logger';
import { PushValidationError, RmcPushSession } from '../session';
import { HostMessage, isWebviewMessage, ViewState, WebviewMessage } from '../types/index';
import { getWebviewContent } from './content';

type PushMessage = Extract<WebviewMessage, { type: 'push' }>;

/**
 * Runs work that nothing awaits, without leaking a rejection.
 *
 * An unhandled rejection here surfaces in the debug console as a bare
 * "rejected promise not handled within 1 second" with no indication of which
 * extension caused it, so route the failure to our own log instead.
 */
function fireAndForget(work: Thenable<unknown>, context: string): void {
	work.then(undefined, (err: unknown) => logger.error(context, err));
}

/**
 * Hosts the sidebar. Holds no application state of its own — it renders
 * whatever RmcPushSession reports and forwards user intent back to it, so
 * VS Code can dispose and recreate it at will.
 */
export class RmcPushViewProvider implements vscode.WebviewViewProvider {
	/** Must match the view id contributed in package.json. */
	static readonly viewType = 'rmcPush.configView';

	private view: vscode.WebviewView | undefined;

	constructor(
		private readonly session: RmcPushSession,
		private readonly extensionUri: vscode.Uri
	) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
		};
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		webviewView.webview.onDidReceiveMessage((message: unknown) => {
			if (!isWebviewMessage(message)) {
				logger.error('Ignored unrecognised message from webview');
				return;
			}
			switch (message.type) {
				case 'ready':
					// The script mounts after the HTML is set, so the first state has
					// to wait for it to say so or it lands on a page with no listener.
					this.render(this.session.getState());
					break;
				case 'selectAccount':
					fireAndForget(this.session.selectAccount(), 'Selecting a service account failed');
					break;
				case 'refresh':
					fireAndForget(this.session.refresh(), 'Refreshing Remote Config failed');
					break;
				case 'push':
					fireAndForget(this.handlePush(message), 'Push handling failed');
					break;
			}
		});

		webviewView.onDidDispose(() => {
			this.view = undefined;
		});
	}

	private async handlePush(message: PushMessage): Promise<void> {
		try {
			await this.session.push(message);
			const target = message.group ? `group "${message.group}"` : 'root parameters';
			this.post({ type: 'pushResult', ok: true, message: `Pushed "${message.key}" to ${target}.` });
		} catch (err) {
			const text =
				err instanceof PushValidationError
					? err.message
					: err instanceof Error
						? err.message
						: String(err);
			logger.error('Push failed', err);
			this.post({ type: 'pushResult', ok: false, message: text });
		}
	}

	/** Pushes new state into the webview, if one is currently alive. */
	render(state: ViewState): void {
		this.post({ type: 'state', state });
	}

	private post(message: HostMessage): void {
		const view = this.view;
		if (view === undefined) {
			return;
		}
		// Rejects if the webview was disposed between the check and the send —
		// a normal race when the user hides the sidebar mid-request, not an error.
		view.webview.postMessage(message).then(undefined, () => undefined);
	}

	/** Reveals the sidebar and gives it focus. */
	async reveal(): Promise<void> {
		if (this.view) {
			this.view.show(true);
			return;
		}
		// No view yet — asking VS Code to focus it creates and resolves one.
		await vscode.commands.executeCommand(`${RmcPushViewProvider.viewType}.focus`);
	}
}
