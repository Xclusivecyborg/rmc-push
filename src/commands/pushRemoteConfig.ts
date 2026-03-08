import * as vscode from 'vscode';
import { getAuthContext } from '../auth/googleAuth';
import { fetchRemoteConfig, mergeParameter, mergeParameterInGroup, pushRemoteConfig } from '../firebase/remoteConfig';
import { logger } from '../logger';
import { AuthError, FirebaseApiError, PushConfigMessage } from '../types/index';
import { createOrRevealPanel, postMessage } from '../webview/panel';

export function registerPushRemoteConfig(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.commands.registerCommand('rmc-push.pushRemoteConfig', async () => {
		// 1. Resolve Firebase project ID
		const projectId = await resolveProjectId();
		if (!projectId) {
			return;
		}

		// 2. Sign in with Google (or use cached tokens)
		let auth;
		try {
			auth = await getAuthContext(context.secrets, projectId);
			logger.info(`Signed in as ${auth.userEmail} for project: ${auth.projectId}`);
		} catch (err) {
			if (err instanceof AuthError) {
				vscode.window.showErrorMessage(err.message);
			} else {
				vscode.window.showErrorMessage('Failed to sign in with Google.');
			}
			logger.error('Authentication error', err);
			return;
		}

		// 3. Verify connectivity (quick GET)
		try {
			await fetchRemoteConfig(auth);
			logger.info('Successfully connected to Firebase Remote Config.');
			vscode.window.showInformationMessage(`Connected to ${projectId}. Opening push UI...`);
		} catch (err) {
			if (err instanceof FirebaseApiError) {
				vscode.window.showErrorMessage('Failed to connect to Firebase: ' + err.message);
			} else {
				vscode.window.showErrorMessage('Failed to connect to Firebase.');
			}
			logger.error('Remote Config connection failed', err);
			return;
		}

		// 4. Open webview
		const panel = createOrRevealPanel(context, auth, async (message: PushConfigMessage) => {
			await handlePushMessage(panel, context, projectId, message);
		});
	});
}

async function resolveProjectId(): Promise<string | undefined> {
	const config = vscode.workspace.getConfiguration('rmcPush');
	const existing = config.get<string>('projectId')?.trim();
	if (existing) {
		return existing;
	}

	const input = await vscode.window.showInputBox({
		prompt: 'Enter your Firebase Project ID',
		placeHolder: 'e.g. my-firebase-project-12345',
		ignoreFocusOut: true,
		validateInput: v => v.trim() ? null : 'Project ID is required'
	});
	if (!input?.trim()) {
		return undefined;
	}
	await config.update('projectId', input.trim(), vscode.ConfigurationTarget.Workspace);
	return input.trim();
}

async function handlePushMessage(
	panel: vscode.WebviewPanel,
	context: vscode.ExtensionContext,
	projectId: string,
	message: PushConfigMessage
): Promise<void> {
	postMessage(panel, { status: 'loading' });
	try {
		// Always get a fresh AuthContext so tokens are silently refreshed if needed
		const auth = await getAuthContext(context.secrets, projectId);
		const authorName = auth.userName || auth.userEmail;

		const { template, etag } = await fetchRemoteConfig(auth);
		const updated = message.group
			? mergeParameterInGroup(template, message.group, message.key, message.value, message.type)
			: mergeParameter(template, message.key, message.value, message.type);
		await pushRemoteConfig(auth, updated, etag, authorName);
		const location = message.group ? `group "${message.group}"` : 'root parameters';
		logger.info(`Pushed config: ${message.key} = ${message.value} (${message.type}) → ${location}`);
		postMessage(panel, { status: 'success', message: 'Successfully pushed config!' });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error('Push failed', err);
		postMessage(panel, { status: 'error', message: msg });
	}
}
