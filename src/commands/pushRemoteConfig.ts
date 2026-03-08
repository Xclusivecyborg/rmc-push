import * as vscode from 'vscode';
import { getAuthContext, isTokenExpired } from '../auth/googleAuth';
import { readServiceAccount, resolveServiceAccountPath } from '../auth/serviceAccount';
import { fetchRemoteConfig, mergeParameter, mergeParameterInGroup, pushRemoteConfig } from '../firebase/remoteConfig';
import { logger } from '../logger';
import { AuthContext, AuthError, FirebaseApiError, PushConfigMessage, ServiceAccountValidationError } from '../types/index';
import { createOrRevealPanel, postMessage } from '../webview/panel';

let authContext: AuthContext | null = null;

export function registerPushRemoteConfig(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.commands.registerCommand('rmc-push.pushRemoteConfig', async () => {
		// 1. Resolve service account path
		const path = await resolveServiceAccountPath();
		if (!path) {
			return;
		}

		// 2. Read + validate service account
		let serviceAccount;
		try {
			serviceAccount = await readServiceAccount(path);
		} catch (err) {
			if (err instanceof ServiceAccountValidationError) {
				vscode.window.showErrorMessage(err.message);
			} else {
				vscode.window.showErrorMessage('Failed to read service account file.');
			}
			logger.error('Service account error', err);
			return;
		}

		// 3. Authenticate (or re-use cached token)
		try {
			if (!authContext || isTokenExpired(authContext)) {
				authContext = await getAuthContext(serviceAccount);
				logger.info(`Authenticated for project: ${authContext.projectId}`);
			}
		} catch (err) {
			if (err instanceof AuthError) {
				vscode.window.showErrorMessage(err.message);
			} else {
				vscode.window.showErrorMessage('Failed to authenticate with Firebase.');
			}
			logger.error('Authentication error', err);
			return;
		}

		// 4. Verify connectivity (quick GET)
		try {
			await fetchRemoteConfig(authContext);
			logger.info('Successfully connected to Firebase Remote Config.');
			vscode.window.showInformationMessage('Authenticated with Firebase. Opening push UI...');
		} catch (err) {
			if (err instanceof FirebaseApiError) {
				vscode.window.showErrorMessage('Failed to connect to Firebase: ' + err.message);
			} else {
				vscode.window.showErrorMessage('Failed to connect to Firebase.');
			}
			logger.error('Remote Config connection failed', err);
			return;
		}

		// 5. Open webview
		const capturedAuth = authContext;
		const panel = createOrRevealPanel(context, capturedAuth, async (message: PushConfigMessage) => {
			await handlePushMessage(panel, capturedAuth, message);
		});

		panel.onDidDispose(() => {
			authContext = null;
		});
	});
}

async function handlePushMessage(
	panel: vscode.WebviewPanel,
	auth: AuthContext,
	message: PushConfigMessage
): Promise<void> {
	postMessage(panel, { status: 'loading' });
	try {
		// Re-auth if token expired
		if (isTokenExpired(auth)) {
			logger.info('Token expired — re-authenticating is not possible without service account. Please reset and re-run.');
			postMessage(panel, { status: 'error', message: 'Session expired. Please re-run the Push command.' });
			return;
		}

		const { template, etag } = await fetchRemoteConfig(auth);
		const updated = message.group
			? mergeParameterInGroup(template, message.group, message.key, message.value, message.type)
			: mergeParameter(template, message.key, message.value, message.type);
		await pushRemoteConfig(auth, updated, etag);
		const location = message.group ? `group "${message.group}"` : 'root parameters';
		logger.info(`Pushed config: ${message.key} = ${message.value} (${message.type}) → ${location}`);
		postMessage(panel, { status: 'success', message: 'Successfully pushed config!' });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error('Push failed', err);
		postMessage(panel, { status: 'error', message: msg });
	}
}
