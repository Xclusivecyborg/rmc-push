import * as vscode from 'vscode';
import { registerPushRemoteConfig } from './commands/pushRemoteConfig';
import { registerSignOut } from './commands/resetServiceAccount';
import { logger } from './logger';

export function activate(context: vscode.ExtensionContext): void {
	logger.info('rmc-push extension activated.');
	context.subscriptions.push(
		registerPushRemoteConfig(context),
		registerSignOut(context)
	);
}

export function deactivate(): void {
	logger.dispose();
}
