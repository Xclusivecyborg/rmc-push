import * as assert from 'assert';
import { keysOf, mergeChanges, mergeParameter, mergeParameterInGroup } from '../../firebase/remoteConfig';
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

suite('firebase/remoteConfig — mergeParameterInGroup', () => {
	test('creates a new group when it does not exist', () => {
		const template: RemoteConfigTemplate = {};
		const result = mergeParameterInGroup(template, 'feature_flags', 'dark_mode', 'true', 'BOOLEAN');
		assert.deepStrictEqual(result.parameterGroups?.['feature_flags']?.parameters?.['dark_mode'], {
			defaultValue: { value: 'true' },
			valueType: 'BOOLEAN'
		});
	});

	test('adds parameter to an existing group without overwriting other keys', () => {
		const template: RemoteConfigTemplate = {
			parameterGroups: {
				feature_flags: {
					parameters: {
						old_flag: { defaultValue: { value: 'false' }, valueType: 'BOOLEAN' }
					}
				}
			}
		};
		const result = mergeParameterInGroup(template, 'feature_flags', 'new_flag', 'true', 'BOOLEAN');
		assert.ok(result.parameterGroups?.['feature_flags']?.parameters?.['old_flag']);
		assert.ok(result.parameterGroups?.['feature_flags']?.parameters?.['new_flag']);
	});

	test('overwrites an existing key within the group', () => {
		const template: RemoteConfigTemplate = {
			parameterGroups: {
				ui: { parameters: { color: { defaultValue: { value: 'blue' }, valueType: 'STRING' } } }
			}
		};
		const result = mergeParameterInGroup(template, 'ui', 'color', 'red', 'STRING');
		assert.strictEqual(result.parameterGroups?.['ui']?.parameters?.['color']?.defaultValue?.value, 'red');
	});

	test('does not mutate the input template', () => {
		const template: RemoteConfigTemplate = {
			parameterGroups: {
				g: { parameters: { x: { defaultValue: { value: '1' }, valueType: 'NUMBER' } } }
			}
		};
		mergeParameterInGroup(template, 'g', 'y', '2', 'NUMBER');
		assert.strictEqual(Object.keys(template.parameterGroups?.['g']?.parameters ?? {}).length, 1);
	});

	test('preserves root parameters when adding to a group', () => {
		const template: RemoteConfigTemplate = {
			parameters: { root_key: { defaultValue: { value: 'root' }, valueType: 'STRING' } }
		};
		const result = mergeParameterInGroup(template, 'myGroup', 'grouped_key', 'val', 'STRING');
		assert.deepStrictEqual(result.parameters, template.parameters);
	});

	test('preserves group description when adding a parameter', () => {
		const template: RemoteConfigTemplate = {
			parameterGroups: {
				described: { description: 'A described group', parameters: {} }
			}
		};
		const result = mergeParameterInGroup(template, 'described', 'k', 'v', 'STRING');
		assert.strictEqual(result.parameterGroups?.['described']?.description, 'A described group');
	});
});

suite('firebase/remoteConfig — preserving untouched fields', () => {
	const rich: RemoteConfigTemplate = {
		parameters: {
			welcome: {
				defaultValue: { value: 'Hello' },
				conditionalValues: { android: { value: 'Hello, Android' } },
				description: 'Shown on the home screen',
				valueType: 'STRING'
			}
		},
		parameterGroups: {
			ui: {
				description: 'UI knobs',
				parameters: {
					color: {
						defaultValue: { value: 'blue' },
						conditionalValues: { ios: { value: 'red' } },
						valueType: 'STRING'
					}
				}
			}
		}
	};

	test('editing a root parameter keeps its conditional values and description', () => {
		const welcome = mergeParameter(rich, 'welcome', 'Hi', 'STRING').parameters?.['welcome'];
		assert.strictEqual(welcome?.defaultValue?.value, 'Hi');
		assert.deepStrictEqual(welcome?.conditionalValues, { android: { value: 'Hello, Android' } });
		assert.strictEqual(welcome?.description, 'Shown on the home screen');
	});

	test('editing a grouped parameter keeps its conditional values', () => {
		const color = mergeParameterInGroup(rich, 'ui', 'color', 'green', 'STRING')
			.parameterGroups?.['ui']?.parameters['color'];
		assert.strictEqual(color?.defaultValue?.value, 'green');
		assert.deepStrictEqual(color?.conditionalValues, { ios: { value: 'red' } });
	});

	test('a batch applies every change in one template', () => {
		const result = mergeChanges(rich, [
			{ key: 'welcome', value: 'Hi', valueType: 'STRING', isNew: false },
			{ key: 'color', value: 'green', valueType: 'STRING', group: 'ui', isNew: false },
			{ key: 'brand_new', value: 'true', valueType: 'BOOLEAN', group: 'Fresh', isNew: true }
		]);
		assert.strictEqual(result.parameters?.['welcome']?.defaultValue?.value, 'Hi');
		assert.strictEqual(result.parameters?.['welcome']?.description, 'Shown on the home screen');
		assert.strictEqual(result.parameterGroups?.['ui']?.parameters['color']?.defaultValue?.value, 'green');
		assert.strictEqual(result.parameterGroups?.['ui']?.description, 'UI knobs');
		assert.strictEqual(result.parameterGroups?.['Fresh']?.parameters['brand_new']?.valueType, 'BOOLEAN');
	});

	test('a batch does not mutate the input template', () => {
		const before = JSON.stringify(rich);
		mergeChanges(rich, [{ key: 'welcome', value: 'Changed', valueType: 'STRING', isNew: false }]);
		assert.strictEqual(JSON.stringify(rich), before);
	});

	test('keysOf lists root and grouped keys', () => {
		assert.deepStrictEqual([...keysOf(rich)].sort(), ['color', 'welcome']);
	});
});
