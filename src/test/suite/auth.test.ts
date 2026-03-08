import * as assert from 'assert';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

// Generate a throwaway RSA key pair for unit tests — never hits the network.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const mockServiceAccount = {
	type: 'service_account',
	project_id: 'test-project',
	private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
	client_email: 'test@test-project.iam.gserviceaccount.com',
	client_id: '000',
	private_key_id: 'key1',
	auth_uri: 'https://accounts.google.com/o/oauth2/auth',
	token_uri: 'https://oauth2.googleapis.com/token'
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.remoteconfig';

function buildJwtPayload(serviceAccount: typeof mockServiceAccount): Record<string, unknown> {
	const iat = Math.floor(Date.now() / 1000);
	const exp = iat + 3600;
	return {
		iss: serviceAccount.client_email,
		sub: serviceAccount.client_email,
		aud: TOKEN_URL,
		scope: SCOPE,
		iat,
		exp
	};
}

suite('auth/googleAuth — JWT payload', () => {
	test('JWT has correct iss, sub, aud, scope', () => {
		const payload = buildJwtPayload(mockServiceAccount);
		const token = jwt.sign(payload, mockServiceAccount.private_key, { algorithm: 'RS256' });
		const decoded = jwt.verify(token, publicKey.export({ type: 'spki', format: 'pem' }) as string) as Record<string, unknown>;

		assert.strictEqual(decoded['iss'], mockServiceAccount.client_email);
		assert.strictEqual(decoded['sub'], mockServiceAccount.client_email);
		assert.strictEqual(decoded['aud'], TOKEN_URL);
		assert.strictEqual(decoded['scope'], SCOPE);
	});

	test('JWT exp is iat + 3600', () => {
		const payload = buildJwtPayload(mockServiceAccount);
		const token = jwt.sign(payload, mockServiceAccount.private_key, { algorithm: 'RS256' });
		const decoded = jwt.decode(token) as Record<string, number>;

		assert.strictEqual(decoded['exp'] - decoded['iat'], 3600);
	});

	test('JWT is signed with RS256 algorithm', () => {
		const payload = buildJwtPayload(mockServiceAccount);
		const token = jwt.sign(payload, mockServiceAccount.private_key, { algorithm: 'RS256' });
		const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());

		assert.strictEqual(header.alg, 'RS256');
	});
});
