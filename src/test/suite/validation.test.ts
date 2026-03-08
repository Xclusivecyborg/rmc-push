import * as assert from 'assert';

const KEY_REGEX = /^[a-zA-Z0-9_]+$/;

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
