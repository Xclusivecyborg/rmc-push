import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'Xclusivecyborg.rmc-push';

suite('Extension — smoke tests', () => {
	test('the extension activates', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `${EXTENSION_ID} should be installed in the test host`);
		await extension.activate();
		assert.strictEqual(extension.isActive, true);
	});

	test('every contributed command is registered after activation', async () => {
		await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
		const commands = await vscode.commands.getCommands(true);

		for (const id of [
			'rmc-push.pushRemoteConfig',
			'rmc-push.selectServiceAccount',
			'rmc-push.resetServiceAccountPath',
			'rmc-push.refresh'
		]) {
			assert.ok(commands.includes(id), `${id} should be registered`);
		}
	});

	test('the sidebar view is contributed to its own activity bar container', () => {
		const packageJson = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON;
		const containers = packageJson?.contributes?.viewsContainers?.activitybar ?? [];
		const views = packageJson?.contributes?.views?.rmcPush ?? [];

		assert.ok(
			containers.some((c: { id: string }) => c.id === 'rmcPush'),
			'an rmcPush activity bar container should be contributed'
		);
		assert.deepStrictEqual(
			views.map((v: { id: string; type?: string }) => [v.id, v.type]),
			[['rmcPush.configView', 'webview']]
		);
	});
});
