import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension — smoke tests', () => {
	test('both command IDs are registered after activation', async () => {
		// Activation is triggered by getting all commands
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('rmc-push.pushRemoteConfig'),
			'rmc-push.pushRemoteConfig should be registered'
		);
		assert.ok(
			commands.includes('rmc-push.resetServiceAccountPath'),
			'rmc-push.resetServiceAccountPath should be registered'
		);
	});
});
