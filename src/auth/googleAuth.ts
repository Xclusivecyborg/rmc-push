import * as http from 'http';
import * as net from 'net';
import fetch from 'node-fetch';
import * as vscode from 'vscode';
import { AuthContext, AuthError } from '../types/index';

// Register an OAuth 2.0 "Desktop app" client at console.cloud.google.com,
// enable the Firebase Remote Config API, and replace these values before publishing.
const CLIENT_ID = '';
const CLIENT_SECRET = '';

const SCOPE = [
	'https://www.googleapis.com/auth/cloud-platform',
	'https://www.googleapis.com/auth/userinfo.email',
	'https://www.googleapis.com/auth/userinfo.profile'
].join(' ');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const TOKENS_SECRET_KEY = 'rmc-push.oauth.tokens';

interface StoredTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	error?: string;
}

interface UserInfoResponse {
	email: string;
	name?: string;
}

async function getAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, '127.0.0.1', () => {
			const port = (server.address() as net.AddressInfo).port;
			server.close(() => resolve(port));
		});
		server.on('error', reject);
	});
}

async function fetchUserInfo(accessToken: string): Promise<UserInfoResponse> {
	const res = await fetch(USERINFO_URL, {
		headers: { 'Authorization': `Bearer ${accessToken}` }
	});
	if (!res.ok) {
		throw new AuthError('Failed to fetch user info from Google');
	}
	return res.json() as Promise<UserInfoResponse>;
}

async function storeTokens(secrets: vscode.SecretStorage, tokens: StoredTokens): Promise<void> {
	await secrets.store(TOKENS_SECRET_KEY, JSON.stringify(tokens));
}

async function refreshTokens(secrets: vscode.SecretStorage, refreshToken: string): Promise<StoredTokens> {
	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			refresh_token: refreshToken,
			grant_type: 'refresh_token'
		}).toString()
	});
	const data = await res.json() as TokenResponse;
	if (!data.access_token) {
		throw new AuthError('Session expired. Please sign in again.');
	}
	const tokens: StoredTokens = {
		accessToken: data.access_token,
		refreshToken,
		expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600)
	};
	await storeTokens(secrets, tokens);
	return tokens;
}

async function runLoopbackFlow(): Promise<StoredTokens> {
	const port = await getAvailablePort();
	const redirectUri = `http://localhost:${port}`;

	const authUrl = new URL(AUTH_URL);
	authUrl.searchParams.set('client_id', CLIENT_ID);
	authUrl.searchParams.set('redirect_uri', redirectUri);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('scope', SCOPE);
	authUrl.searchParams.set('access_type', 'offline');
	authUrl.searchParams.set('prompt', 'consent');

	const code = await new Promise<string>((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url ?? '/', `http://localhost:${port}`);
			const authCode = url.searchParams.get('code');
			const error = url.searchParams.get('error');

			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end(
				'<html><body style="font-family:sans-serif;padding:40px">' +
				'<h2>Signed in successfully!</h2>' +
				'<p>You can close this tab and return to VS Code.</p>' +
				'</body></html>'
			);
			server.close();

			if (error) {
				reject(new AuthError(`Sign-in cancelled: ${error}`));
			} else if (authCode) {
				resolve(authCode);
			} else {
				reject(new AuthError('No authorization code received'));
			}
		});

		server.listen(port, '127.0.0.1');
		server.on('error', reject);

		vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));
	});

	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			code,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code'
		}).toString()
	});
	const data = await res.json() as TokenResponse;
	if (!data.access_token || !data.refresh_token) {
		throw new AuthError(`Sign-in failed: ${data.error ?? 'no token received'}`);
	}

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600)
	};
}

/** Returns a valid AuthContext, running the browser sign-in flow if not already signed in. */
export async function getAuthContext(secrets: vscode.SecretStorage, projectId: string): Promise<AuthContext> {
	const stored = await secrets.get(TOKENS_SECRET_KEY);

	if (stored) {
		let tokens: StoredTokens = JSON.parse(stored) as StoredTokens;
		if (Date.now() / 1000 > tokens.expiresAt - 60) {
			tokens = await refreshTokens(secrets, tokens.refreshToken);
		}
		const userInfo = await fetchUserInfo(tokens.accessToken);
		return {
			accessToken: tokens.accessToken,
			projectId,
			expiresAt: tokens.expiresAt,
			userEmail: userInfo.email,
			userName: userInfo.name
		};
	}

	// No stored tokens — open browser for sign-in
	const tokens = await runLoopbackFlow();
	await storeTokens(secrets, tokens);
	const userInfo = await fetchUserInfo(tokens.accessToken);
	vscode.window.showInformationMessage(`Signed in as ${userInfo.email}`);
	return {
		accessToken: tokens.accessToken,
		projectId,
		expiresAt: tokens.expiresAt,
		userEmail: userInfo.email,
		userName: userInfo.name
	};
}

/** Returns true when the token is within 60 s of expiry. */
export function isTokenExpired(auth: AuthContext): boolean {
	return Date.now() / 1000 > auth.expiresAt - 60;
}

/** Clears stored OAuth tokens, effectively signing the user out. */
export async function signOut(secrets: vscode.SecretStorage): Promise<void> {
	await secrets.delete(TOKENS_SECRET_KEY);
}
