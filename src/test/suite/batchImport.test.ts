import * as assert from 'assert';
import { MAX_PARAMETERS, parseBatchJson } from '../../batchImport';
import { ConfigEntry } from '../../types/index';

function entry(key: string, group?: string): ConfigEntry {
	return { key, value: 'x', valueType: 'STRING', group, conditionCount: 0, usesInAppDefault: false };
}

suite('batchImport — simple map', () => {
	test('infers each type from the JSON value', () => {
		const result = parseBatchJson(
			'{"flag": true, "min": 2.4, "title": "Hi", "features": {"chat": true}, "list": [1, 2]}',
			undefined,
			[]
		);
		assert.strictEqual(result.format, 'map');
		assert.deepStrictEqual(
			result.rows.map(r => [r.key, r.valueType, r.value]),
			[
				['flag', 'BOOLEAN', 'true'],
				['min', 'NUMBER', '2.4'],
				['title', 'STRING', 'Hi'],
				['features', 'JSON', '{"chat":true}'],
				['list', 'JSON', '[1,2]']
			]
		);
		assert.ok(result.rows.every(r => r.isNew && !r.error));
	});

	test('new keys land in the target group', () => {
		const result = parseBatchJson('{"a": 1}', ' Promo ', []);
		assert.strictEqual(result.rows[0].group, 'Promo');
	});

	test('an existing key is updated in the group it already lives in', () => {
		const result = parseBatchJson('{"a": 1, "b": 2}', 'Promo', [entry('a', 'Ops'), entry('b', 'Promo')]);
		const [a, b] = result.rows;
		assert.strictEqual(a.isNew, false);
		assert.strictEqual(a.group, 'Ops');
		assert.match(a.note ?? '', /group "Ops"/);
		assert.strictEqual(b.group, 'Promo');
		assert.strictEqual(b.note, undefined);
	});

	test('invalid keys and null values are flagged, not dropped', () => {
		const result = parseBatchJson('{"bad key": 1, "empty": null, "ok": "x"}', undefined, []);
		assert.ok(result.rows[0].error);
		assert.ok(result.rows[1].error);
		assert.strictEqual(result.rows[2].error, undefined);
	});

	test('a plain map with a "parameters" key holding data is still a map', () => {
		const result = parseBatchJson('{"parameters": {"a": 1}}', undefined, []);
		assert.strictEqual(result.format, 'map');
		assert.strictEqual(result.rows[0].valueType, 'JSON');
	});
});

suite('batchImport — Firebase template', () => {
	const template = JSON.stringify({
		conditions: [{ name: 'android', expression: "device.os == 'android'" }],
		parameters: {
			welcome: {
				defaultValue: { value: 'Hello' },
				conditionalValues: { android: { value: 'Hi Android' } },
				valueType: 'STRING'
			},
			legacy: { defaultValue: { useInAppDefault: true } }
		},
		parameterGroups: {
			Ops: { parameters: { maintenance: { defaultValue: { value: 'false' }, valueType: 'BOOLEAN' } } }
		},
		version: { versionNumber: '12' }
	});

	test('takes groups and types from the file', () => {
		const result = parseBatchJson(template, 'Ignored', []);
		assert.strictEqual(result.format, 'template');
		const maintenance = result.rows.find(r => r.key === 'maintenance');
		assert.strictEqual(maintenance?.group, 'Ops');
		assert.strictEqual(maintenance?.valueType, 'BOOLEAN');
		assert.strictEqual(result.rows.find(r => r.key === 'welcome')?.group, undefined);
	});

	test('a parameter without a default value is flagged', () => {
		const result = parseBatchJson(template, undefined, []);
		assert.ok(result.rows.find(r => r.key === 'legacy')?.error);
	});

	test('warns that conditions are not imported', () => {
		const result = parseBatchJson(template, undefined, []);
		assert.ok(result.warnings.some(w => w.includes('Conditions')));
	});

	test('a key in both root and a group is flagged the second time', () => {
		const result = parseBatchJson(JSON.stringify({
			parameters: { a: { defaultValue: { value: '1' } } },
			parameterGroups: { G: { parameters: { a: { defaultValue: { value: '2' } } } } }
		}), undefined, []);
		assert.strictEqual(result.rows[0].error, undefined);
		assert.ok(result.rows[1].error);
	});
});

suite('batchImport — whole input', () => {
	test('empty input is not an error', () => {
		const result = parseBatchJson('   ', undefined, []);
		assert.strictEqual(result.error, undefined);
		assert.strictEqual(result.rows.length, 0);
	});

	test('malformed JSON and non-objects are rejected', () => {
		assert.ok(parseBatchJson('{"a": ', undefined, []).error);
		assert.ok(parseBatchJson('[1, 2]', undefined, []).error);
	});

	test('warns when the project would exceed the parameter limit', () => {
		const existing = Array.from({ length: MAX_PARAMETERS }, (_, i) => entry(`k${i}`));
		const result = parseBatchJson('{"one_more": 1}', undefined, existing);
		assert.ok(result.warnings.some(w => w.includes(String(MAX_PARAMETERS))));
	});
});
