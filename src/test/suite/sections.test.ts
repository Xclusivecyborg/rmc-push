import * as assert from 'assert';
import { toSections } from '../../firebase/remoteConfig';
import { RemoteConfigTemplate } from '../../types/index';

suite('firebase/remoteConfig — toSections', () => {
	test('an empty template still yields the root section', () => {
		const sections = toSections({});
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].group, undefined);
		assert.deepStrictEqual(sections[0].entries, []);
	});

	test('root parameters are returned in the root section, sorted by key', () => {
		const template: RemoteConfigTemplate = {
			parameters: {
				zebra: { defaultValue: { value: 'z' }, valueType: 'STRING' },
				apple: { defaultValue: { value: 'a' }, valueType: 'STRING' }
			}
		};
		const [root] = toSections(template);
		assert.deepStrictEqual(root.entries.map(e => e.key), ['apple', 'zebra']);
	});

	test('groups follow the root section, sorted by group name', () => {
		const template: RemoteConfigTemplate = {
			parameterGroups: {
				ui: { parameters: {} },
				flags: { parameters: {} }
			}
		};
		const sections = toSections(template);
		assert.deepStrictEqual(sections.map(s => s.group), [undefined, 'flags', 'ui']);
	});

	test('an empty group is preserved rather than dropped', () => {
		const template: RemoteConfigTemplate = {
			parameterGroups: { empty_group: { parameters: {} } }
		};
		const sections = toSections(template);
		assert.strictEqual(sections.length, 2);
		assert.strictEqual(sections[1].group, 'empty_group');
		assert.deepStrictEqual(sections[1].entries, []);
	});

	test('group entries carry their group name', () => {
		const template: RemoteConfigTemplate = {
			parameterGroups: {
				flags: { parameters: { dark_mode: { defaultValue: { value: 'true' }, valueType: 'BOOLEAN' } } }
			}
		};
		const sections = toSections(template);
		assert.strictEqual(sections[1].entries[0].group, 'flags');
	});

	test('a missing valueType falls back to STRING', () => {
		const template: RemoteConfigTemplate = {
			parameters: { legacy: { defaultValue: { value: 'x' } } }
		};
		const [root] = toSections(template);
		assert.strictEqual(root.entries[0].valueType, 'STRING');
	});

	test('conditional values are counted', () => {
		const template: RemoteConfigTemplate = {
			parameters: {
				greeting: {
					defaultValue: { value: 'hi' },
					valueType: 'STRING',
					conditionalValues: { ios: { value: 'hi ios' }, android: { value: 'hi android' } }
				}
			}
		};
		const [root] = toSections(template);
		assert.strictEqual(root.entries[0].conditionCount, 2);
	});

	test('a parameter deferring to the in-app default is flagged with an empty value', () => {
		const template: RemoteConfigTemplate = {
			parameters: { fallback: { defaultValue: { useInAppDefault: true }, valueType: 'STRING' } }
		};
		const [root] = toSections(template);
		assert.strictEqual(root.entries[0].usesInAppDefault, true);
		assert.strictEqual(root.entries[0].value, '');
	});

	test('group descriptions are carried through', () => {
		const template: RemoteConfigTemplate = {
			parameterGroups: { described: { description: 'Feature flags', parameters: {} } }
		};
		const sections = toSections(template);
		assert.strictEqual(sections[1].description, 'Feature flags');
	});
});
