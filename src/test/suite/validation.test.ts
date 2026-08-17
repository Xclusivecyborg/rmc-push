import * as assert from 'assert';
import { isServiceAccount } from '../../types/index';
import { normalizeValue, validatePush } from '../../validation';

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

suite('validation — validatePush keys and groups', () => {
	const ok = { value: 'v', valueType: 'STRING' as const };

	test('accepts alphanumerics and underscores', () => {
		assert.strictEqual(validatePush({ ...ok, key: 'welcome_title' }), null);
		assert.strictEqual(validatePush({ ...ok, key: 'flag123' }), null);
		assert.strictEqual(validatePush({ ...ok, key: 'UPPER_CASE' }), null);
	});

	test('rejects an empty key', () => {
		assert.deepStrictEqual(validatePush({ ...ok, key: '   ' })?.field, 'key');
	});

	test('rejects hyphens in a key', () => {
		assert.strictEqual(validatePush({ ...ok, key: 'bad-key' })?.field, 'key');
	});

	test('rejects spaces in a key', () => {
		assert.strictEqual(validatePush({ ...ok, key: 'has space' })?.field, 'key');
	});

	test('a blank group means root and is allowed', () => {
		assert.strictEqual(validatePush({ ...ok, key: 'k', group: '  ' }), null);
	});

	test('rejects an invalid group name against the group field', () => {
		assert.strictEqual(validatePush({ ...ok, key: 'k', group: 'bad group' })?.field, 'group');
	});
});

suite('validation — validatePush value types', () => {
	const base = { key: 'k' };

	test('an empty value is rejected whatever the type', () => {
		assert.strictEqual(validatePush({ ...base, value: '', valueType: 'STRING' })?.field, 'value');
	});

	test('STRING accepts anything non-empty', () => {
		assert.strictEqual(validatePush({ ...base, value: 'anything at all', valueType: 'STRING' }), null);
	});

	test('NUMBER accepts a decimal', () => {
		assert.strictEqual(validatePush({ ...base, value: '3.14', valueType: 'NUMBER' }), null);
	});

	test('NUMBER rejects a non-numeric string', () => {
		assert.strictEqual(validatePush({ ...base, value: 'abc', valueType: 'NUMBER' })?.field, 'value');
	});

	test('BOOLEAN accepts true and false in any case', () => {
		assert.strictEqual(validatePush({ ...base, value: 'true', valueType: 'BOOLEAN' }), null);
		assert.strictEqual(validatePush({ ...base, value: 'FALSE', valueType: 'BOOLEAN' }), null);
	});

	test('BOOLEAN rejects "yes"', () => {
		assert.strictEqual(validatePush({ ...base, value: 'yes', valueType: 'BOOLEAN' })?.field, 'value');
	});

	test('JSON accepts a valid object', () => {
		assert.strictEqual(validatePush({ ...base, value: '{"key":"value"}', valueType: 'JSON' }), null);
	});

	test('JSON rejects malformed input', () => {
		assert.strictEqual(validatePush({ ...base, value: '{bad json}', valueType: 'JSON' })?.field, 'value');
	});
});

suite('validation — normalizeValue', () => {
	test('lower-cases and trims booleans so Firebase gets exactly true/false', () => {
		assert.strictEqual(normalizeValue('  TRUE ', 'BOOLEAN'), 'true');
	});

	test('leaves other types untouched, including surrounding whitespace', () => {
		assert.strictEqual(normalizeValue('  Hello  ', 'STRING'), '  Hello  ');
		assert.strictEqual(normalizeValue('42', 'NUMBER'), '42');
	});
});
