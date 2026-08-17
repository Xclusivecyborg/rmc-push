// Palette commands.
//
// These are deliberately thin. The sidebar is now the place where work happens,
// so a command either changes which Firebase project is connected or brings the
// sidebar into view — it never runs the push flow itself.

import * as vscode from 'vscode';
import { RmcPushSession } from '../session';
import { RmcPushViewProvider } from '../webview/view';

export function registerCommands(
	session: RmcPushSession,
	provider: RmcPushViewProvider
): vscode.Disposable[] {
	return [
		// Kept under its original id so existing keybindings and muscle memory
		// still work; it now opens the panel instead of driving a modal flow.
		vscode.commands.registerCommand('rmc-push.pushRemoteConfig', async () => {
			await provider.reveal();
		}),

		vscode.commands.registerCommand('rmc-push.selectServiceAccount', async () => {
			const picked = await session.selectAccount();
			if (picked) {
				await provider.reveal();
			}
		}),

		vscode.commands.registerCommand('rmc-push.resetServiceAccountPath', async () => {
			await session.clearAccount();
			vscode.window.showInformationMessage('Firebase service account has been reset.');
		}),

		vscode.commands.registerCommand('rmc-push.refresh', async () => {
			await session.refresh();
		})
	];
}
