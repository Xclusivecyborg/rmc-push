import * as vscode from 'vscode';
import { AuthContext, PushConfigMessage, WebviewStatusMessage } from '../types/index';
import { getWebviewContent } from './content';

export type MessageHandler = (message: PushConfigMessage) => Promise<void>;

/**
 * Creates (or reveals an existing) webview panel for the push UI.
 * Wires up message handling and returns the panel.
 */
export function createOrRevealPanel(
	context: vscode.ExtensionContext,
	auth: AuthContext,
	onMessage: MessageHandler
): vscode.WebviewPanel {
	const panel = vscode.window.createWebviewPanel(
		'rmcPushConfig',
		'Push to Firebase Remote Config',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: []
		}
	);

	panel.webview.html = getWebviewContent(auth.projectId);

	panel.webview.onDidReceiveMessage(
		async (message: unknown) => {
			if (
				typeof message === 'object' &&
				message !== null &&
				(message as PushConfigMessage).command === 'pushConfig'
			) {
				await onMessage(message as PushConfigMessage);
			}
		},
		undefined,
		context.subscriptions
	);

	return panel;
}

/** Posts a typed status message to the webview. */
export function postMessage(panel: vscode.WebviewPanel, message: WebviewStatusMessage): void {
	panel.webview.postMessage(message);
}
