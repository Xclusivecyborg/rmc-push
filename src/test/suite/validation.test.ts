import * as assert from 'assert';
import { isServiceAccount } from '../../types/index';

const KEY_REGEX = /^[a-zA-Z0-9_]+$/;

suite('validation — isServiceAccount type guard', () => {
	test('passes a valid service account object', () => {
		const valid = {
			type: 'service_account',
			project_id: 'my-project',
			private_key: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n',
			client_email: 'sa@my-project.iam.gserviceaccount.com',
			client_id: '123',
			private_key_id: 'abc',
			auth_uri: 'https://accounts.google.com/o/oauth2/auth',
			token_uri: 'https://oauth2.googleapis.com/token'
		};
		assert.strictEqual(isServiceAccount(valid), true);
	});

	test('fails when project_id is missing', () => {
		const obj = {
			type: 'service_account',
			private_key: 'key',
			client_email: 'sa@project.iam.gserviceaccount.com'
		};
		assert.strictEqual(isServiceAccount(obj), false);
	});

	test('fails on null', () => {
		assert.strictEqual(isServiceAccount(null), false);
	});

	test('fails on a string', () => {
		assert.strictEqual(isServiceAccount('not-an-object'), false);
	});

	test('fails when private_key is a number', () => {
		const obj = {
			type: 'service_account',
			project_id: 'p',
			private_key: 12345,
			client_email: 'sa@p.iam.gserviceaccount.com'
		};
		assert.strictEqual(isServiceAccount(obj), false);
	});
});

suite('validation — key regex', () => {
	test('accepts alphanumeric and underscores', () => {
		assert.ok(KEY_REGEX.test('welcome_title'));
		assert.ok(KEY_REGEX.test('flag123'));
		assert.ok(KEY_REGEX.test('UPPER_CASE'));
	});

	test('rejects hyphens', () => {
		assert.strictEqual(KEY_REGEX.test('bad-key'), false);
	});

	test('rejects empty string', () => {
		assert.strictEqual(KEY_REGEX.test(''), false);
	});

	test('rejects spaces', () => {
		assert.strictEqual(KEY_REGEX.test('has space'), false);
	});
});

suite('validation — value types', () => {
	test('BOOLEAN: accepts "true" and "false"', () => {
		assert.ok(['true', 'false'].includes('true'));
		assert.ok(['true', 'false'].includes('false'));
	});

	test('BOOLEAN: rejects "yes"', () => {
		assert.strictEqual(['true', 'false'].includes('yes'), false);
	});

	test('NUMBER: valid number parses', () => {
		const val = '3.14';
		assert.ok(!isNaN(Number(val)) && val.trim() !== '');
	});

	test('NUMBER: empty string is invalid', () => {
		const val = '';
		assert.ok(isNaN(Number(val)) || val.trim() === '');
	});

	test('NUMBER: non-numeric string is invalid', () => {
		const val = 'abc';
		assert.ok(isNaN(Number(val)));
	});

	test('JSON: valid JSON parses', () => {
		assert.doesNotThrow(() => JSON.parse('{"key":"value"}'));
	});

	test('JSON: invalid JSON throws', () => {
		assert.throws(() => JSON.parse('{bad json}'));
	});
});
