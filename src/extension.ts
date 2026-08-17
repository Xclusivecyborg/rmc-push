import * as vscode from 'vscode';
import { registerCommands } from './commands/index';
import { logger } from './logger';
import { RmcPushSession } from './session';
import { RmcPushViewProvider } from './webview/view';

export function activate(context: vscode.ExtensionContext): void {
	logger.info('rmc-push extension activated.');

	const session = new RmcPushSession();
	const provider = new RmcPushViewProvider(session, context.extensionUri);

	context.subscriptions.push(
		session,
		// Every state change re-renders whichever view is currently alive.
		session.onDidChangeState(state => provider.render(state)),
		vscode.window.registerWebviewViewProvider(RmcPushViewProvider.viewType, provider, {
			// Keeps a half-filled form intact when the user switches to another
			// sidebar view and comes back.
			webviewOptions: { retainContextWhenHidden: true }
		}),
		...registerCommands(session, provider)
	);

	// Connect in the background so the sidebar is populated the moment it is
	// first opened, rather than only after the user interacts with it.
	// connect() reports its own failures into view state; this guard only stops
	// an unexpected throw from surfacing as an unhandled rejection.
	session.connect().then(undefined, (err: unknown) => logger.error('Initial connect failed', err));
}

export function deactivate(): void {
	logger.dispose();
}
