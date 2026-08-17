import * as vscode from 'vscode';

function createNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i++) {
		nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	}
	return nonce;
}

/**
 * Returns the shell HTML for the sidebar. It carries no data — the view posts
 * the current state in once the script signals that it is ready — so this stays
 * a pure function of the extension's own asset URIs.
 *
 * The CSP allows no remote content at all: styles and scripts are served from
 * the extension directory, and the script additionally has to match a per-load
 * nonce, so nothing injected into the DOM can execute.
 */
export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const nonce = createNonce();
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<link href="${styleUri}" rel="stylesheet">
	<title>Firebase Remote Config</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
