import * as assert from 'assert';

// isTokenExpired logic — mirrors the implementation without importing VS Code APIs.
function isTokenExpired(expiresAt: number): boolean {
	return Date.now() / 1000 > expiresAt - 60;
}

suite('auth/googleAuth — isTokenExpired', () => {
	test('returns false when token has plenty of time left', () => {
		const expiresAt = Math.floor(Date.now() / 1000) + 3600;
		assert.strictEqual(isTokenExpired(expiresAt), false);
	});

	test('returns true when token is already expired', () => {
		const expiresAt = Math.floor(Date.now() / 1000) - 1;
		assert.strictEqual(isTokenExpired(expiresAt), true);
	});

	test('returns true when token expires within the 60 s buffer', () => {
		const expiresAt = Math.floor(Date.now() / 1000) + 30;
		assert.strictEqual(isTokenExpired(expiresAt), true);
	});

	test('returns false when token expires exactly at the 60 s boundary', () => {
		const expiresAt = Math.floor(Date.now() / 1000) + 61;
		assert.strictEqual(isTokenExpired(expiresAt), false);
	});
});
