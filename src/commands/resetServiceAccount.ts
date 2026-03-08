import * as vscode from 'vscode';

export function registerResetServiceAccount(): vscode.Disposable {
	return vscode.commands.registerCommand('rmc-push.resetServiceAccountPath', async () => {
		await vscode.workspace.getConfiguration('rmcPush').update(
			'serviceAccountPath',
			undefined,
			vscode.ConfigurationTarget.Workspace
		);
		vscode.window.showInformationMessage('Service account path has been reset for this workspace.');
	});
}
