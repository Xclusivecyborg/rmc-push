// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "rmc-push" is now active!');
	vscode.window.showInformationMessage('RMC Push Extension is now active in this window!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	// Command: Hello World (default)
	const disposable = vscode.commands.registerCommand('rmc-push.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Firebase Remote Config Push!');
	});
	context.subscriptions.push(disposable);

	// Command: Open Remote Config Push UI
	const pushConfigDisposable = vscode.commands.registerCommand('rmc-push.pushRemoteConfig', async () => {
		// Authenticate with Firebase using a service account JSON file
		// Prompt user to select their service account file if not already set
		const config = vscode.workspace.getConfiguration('rmcPush');
		let serviceAccountPath = config.get<string>('serviceAccountPath');
		if (!serviceAccountPath) {
			vscode.window.showWarningMessage('Please select your Firebase service account JSON file.');
			const fileUri = await vscode.window.showOpenDialog({
				canSelectMany: false,
				filters: { 'JSON': ['json'] },
				openLabel: 'Select Service Account JSON'
			});
			if (fileUri && fileUri[0]) {
				await vscode.workspace.getConfiguration('rmcPush').update('serviceAccountPath', fileUri[0].fsPath, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage('Service account file set. Please re-run the command.');
			}
			return;
		}

		// Read service account JSON
		let serviceAccount: any;
		try {
			serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
		} catch (err) {
			vscode.window.showErrorMessage('Failed to read service account file.');
			return;
		}

		// Generate JWT for OAuth2
		const iat = Math.floor(Date.now() / 1000);
		const exp = iat + 60 * 60; // 1 hour
		const payload = {
			iss: serviceAccount.client_email,
			sub: serviceAccount.client_email,
			aud: 'https://oauth2.googleapis.com/token',
			scope: 'https://www.googleapis.com/auth/firebase.remoteconfig',
			iat,
			exp
		};
		let token: string;
		try {
			token = jwt.sign(payload, serviceAccount.private_key, { algorithm: 'RS256' });
		} catch (err) {
			vscode.window.showErrorMessage('Failed to sign JWT for Firebase authentication.');
			return;
		}

		// Exchange JWT for access token
		let accessToken: string;
		try {
			const res = await fetch('https://oauth2.googleapis.com/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${token}`
			});
			const data = await res.json();
			if (!data.access_token) {
				throw new Error('No access token in response');
			}
			accessToken = data.access_token;
		} catch (err) {
			vscode.window.showErrorMessage('Failed to obtain Firebase access token.');
			return;
		}

		// Now you can use accessToken to call the Remote Config REST API
		try {
			const projectId = serviceAccount.project_id;
			const apiUrl = `https://firebaseremoteconfig.googleapis.com/v1/projects/${projectId}/remoteConfig`;

			// Fetch current config (GET) to verify access
			const getRes = await fetch(apiUrl, {
				method: 'GET',
				headers: { 'Authorization': `Bearer ${accessToken}` }
			});
			if (!getRes.ok) {
				throw new Error('Failed to fetch Remote Config');
			}
			console.log('Successfully connected to Firebase Remote Config.');
			vscode.window.showInformationMessage('Authenticated with Firebase. Opening push UI...');
		} catch (err: any) {
			console.error('Remote Config connection failed:', err);
			vscode.window.showErrorMessage('Failed to connect to Firebase: ' + (err?.message || err));
			return;
		}

		// Open a webview for Remote Config push UI
		const panel = vscode.window.createWebviewPanel(
			'rmcPushConfig',
			'Push to Firebase Remote Config',
			vscode.ViewColumn.One,
			{ enableScripts: true }
		);
		panel.webview.html = getWebviewContent();

		// Listen for messages from the webview
		panel.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'pushConfig') {
				const { key, value } = message;
				try {
					const projectId = serviceAccount.project_id;
					const apiUrl = `https://firebaseremoteconfig.googleapis.com/v1/projects/${projectId}/remoteConfig`;

					// 1. Fetch current config to get ETag AND existing parameters
					const getRes = await fetch(apiUrl, {
						method: 'GET',
						headers: { 'Authorization': `Bearer ${accessToken}` }
					});
					if (!getRes.ok) {
						throw new Error('Failed to fetch Remote Config');
					}

					const ETag = getRes.headers.get('etag') || '*';
					const currentConfig = await getRes.json();

					// 2. Merge update into existing parameters
					// We preserve all other keys (conditions, parameterGroups, etc.)
					const updatedConfig = {
						...currentConfig,
						parameters: {
							...(currentConfig.parameters || {}),
							[key]: {
								defaultValue: { value }
							}
						}
					};

					// 3. Push the FULL merged template back
					const putRes = await fetch(apiUrl, {
						method: 'PUT',
						headers: {
							'Authorization': `Bearer ${accessToken}`,
							'Content-Type': 'application/json; charset=UTF-8',
							'If-Match': ETag
						},
						body: JSON.stringify(updatedConfig)
					});
					if (!putRes.ok) {
						const errText = await putRes.text();
						panel.webview.postMessage({ status: 'error', message: 'Failed to update: ' + errText });
						return;
					}
					panel.webview.postMessage({ status: 'success', message: 'Successfully pushed config!' });
				} catch (err: any) {
					panel.webview.postMessage({ status: 'error', message: err?.message || String(err) });
				}
			}
		}, undefined, context.subscriptions);
	});
	context.subscriptions.push(pushConfigDisposable);
}

function getWebviewContent(): string {
	// Simple HTML form for Remote Config key/value
	return `
		<html>
		<head><title>Push to Firebase Remote Config</title></head>
		<body>
			<h2>Push to Firebase Remote Config</h2>
			<form id="configForm">
				<label>Key: <input type="text" id="key" required /></label><br><br>
				<label>Value: <input type="text" id="value" required /></label><br><br>
				<button type="submit">Push Config</button>
			</form>
			<div id="result"></div>
			<script>
				const vscode = acquireVsCodeApi();
				document.getElementById('configForm').addEventListener('submit', function(e) {
					e.preventDefault();
					const key = document.getElementById('key').value;
					const value = document.getElementById('value').value;
					vscode.postMessage({ command: 'pushConfig', key, value });
				});
				window.addEventListener('message', event => {
					const msg = event.data;
					const result = document.getElementById('result');
					if (msg.status === 'success') {
						result.innerHTML = '<span style="color:green">' + msg.message + '</span>';
					} else if (msg.status === 'error') {
						result.innerHTML = '<span style="color:red">' + msg.message + '</span>';
					}
				});
			</script>
		</body>
		</html>
	`;
}

// This method is called when your extension is deactivated
export function deactivate() { }
