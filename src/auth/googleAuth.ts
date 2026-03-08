import * as jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { AuthContext, AuthError, OAuthTokenResponse, ServiceAccount } from '../types/index';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.remoteconfig';

function generateJwt(serviceAccount: ServiceAccount): string {
	const iat = Math.floor(Date.now() / 1000);
	const exp = iat + 3600; // 1 hour
	const payload = {
		iss: serviceAccount.client_email,
		sub: serviceAccount.client_email,
		aud: TOKEN_URL,
		scope: SCOPE,
		iat,
		exp
	};
	try {
		return jwt.sign(payload, serviceAccount.private_key, { algorithm: 'RS256' });
	} catch (err) {
		throw new AuthError('Failed to sign JWT for Firebase authentication', err);
	}
}

/** Exchanges a service account for an OAuth2 access token. Returns an AuthContext. */
export async function getAuthContext(serviceAccount: ServiceAccount): Promise<AuthContext> {
	const token = generateJwt(serviceAccount);

	let data: OAuthTokenResponse;
	try {
		const res = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${token}`
		});
		const body = await res.json() as Partial<OAuthTokenResponse>;
		if (!body.access_token) {
			throw new AuthError('No access_token in OAuth2 response');
		}
		data = body as OAuthTokenResponse;
	} catch (err) {
		if (err instanceof AuthError) {
			throw err;
		}
		throw new AuthError('Failed to obtain Firebase access token', err);
	}

	const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600);
	return {
		accessToken: data.access_token,
		projectId: serviceAccount.project_id,
		expiresAt
	};
}

/** Returns true when the token is within 60 s of expiry. */
export function isTokenExpired(auth: AuthContext): boolean {
	return Date.now() / 1000 > auth.expiresAt - 60;
}
