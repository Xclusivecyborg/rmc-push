import * as vscode from 'vscode';
import { signOut } from '../auth/googleAuth';

export function registerSignOut(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.commands.registerCommand('rmc-push.signOut', async () => {
		await signOut(context.secrets);
		vscode.window.showInformationMessage('Signed out of Firebase Push.');
	});
}
