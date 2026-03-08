import * as assert from 'assert';
import { mergeParameter } from '../../firebase/remoteConfig';
import { RemoteConfigTemplate } from '../../types/index';

suite('firebase/remoteConfig — mergeParameter', () => {
	test('adds a new key to an empty template', () => {
		const template: RemoteConfigTemplate = {};
		const result = mergeParameter(template, 'welcome_title', 'Hello', 'STRING');
		assert.deepStrictEqual(result.parameters, {
			welcome_title: { defaultValue: { value: 'Hello' }, valueType: 'STRING' }
		});
	});

	test('adds a new key while preserving existing keys', () => {
		const template: RemoteConfigTemplate = {
			parameters: {
				existing_key: { defaultValue: { value: 'old' }, valueType: 'STRING' }
			}
		};
		const result = mergeParameter(template, 'new_key', '42', 'NUMBER');
		assert.ok(result.parameters?.['existing_key']);
		assert.deepStrictEqual(result.parameters?.['new_key'], {
			defaultValue: { value: '42' },
			valueType: 'NUMBER'
		});
	});

	test('overwrites a key with the same name', () => {
		const template: RemoteConfigTemplate = {
			parameters: {
				flag: { defaultValue: { value: 'true' }, valueType: 'BOOLEAN' }
			}
		};
		const result = mergeParameter(template, 'flag', 'false', 'BOOLEAN');
		assert.strictEqual(result.parameters?.['flag']?.defaultValue?.value, 'false');
	});

	test('does not mutate the input template', () => {
		const template: RemoteConfigTemplate = {
			parameters: { a: { defaultValue: { value: '1' }, valueType: 'NUMBER' } }
		};
		mergeParameter(template, 'b', '2', 'NUMBER');
		assert.strictEqual(Object.keys(template.parameters ?? {}).length, 1);
	});

	test('preserves conditions array', () => {
		const template: RemoteConfigTemplate = {
			conditions: [{ name: 'ios', expression: 'device.os == "ios"' }]
		};
		const result = mergeParameter(template, 'k', 'v', 'STRING');
		assert.deepStrictEqual(result.conditions, template.conditions);
	});

	test('preserves parameterGroups', () => {
		const template: RemoteConfigTemplate = {
			parameterGroups: {
				groupA: { parameters: { x: { defaultValue: { value: '1' }, valueType: 'NUMBER' } } }
			}
		};
		const result = mergeParameter(template, 'y', '2', 'NUMBER');
		assert.deepStrictEqual(result.parameterGroups, template.parameterGroups);
	});
});
