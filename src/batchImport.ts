// Turns pasted or uploaded JSON into batch rows the user can preview before
// anything is staged. Pure — no vscode import — so it is unit-testable.
//
// Two shapes are accepted and told apart automatically:
//
//   A simple map — {"enable_new_home": true, "app_min_version": 2.4} — whose
//   types are inferred from the JSON values and which lands in the target group
//   the user picked.
//
//   A Firebase template — what the console's Download and `firebase
//   remoteconfig:get` produce — whose groups and types come from the file.

import { ConfigEntry, RemoteConfigValueType } from './types/index';
import { VALUE_TYPES, validatePush } from './validation';

/** Firebase's cap on parameters per template. */
export const MAX_PARAMETERS = 2000;

/** One parameter the import would stage, or why it cannot. */
export interface ImportRow {
	key: string;
	value: string;
	valueType: RemoteConfigValueType;
	/** Where it will be written. Undefined for root parameters. */
	group?: string;
	/** False when the key already exists and this updates it. */
	isNew: boolean;
	/** Something the user should know but that does not block the row. */
	note?: string;
	/** Why the row cannot be staged. */
	error?: string;
}

export interface ImportResult {
	format: 'map' | 'template' | 'empty';
	rows: ImportRow[];
	/** The whole input is unusable — nothing to preview. */
	error?: string;
	warnings: string[];
}

/** Top-level keys a Firebase template can carry. */
const TEMPLATE_KEYS = new Set(['conditions', 'parameters', 'parameterGroups', 'version', 'etag']);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A template is recognised by its shape, not by one key: every top-level key
 * must be one a template has, and its parameters must look like parameters.
 * A simple map that happens to have a key called "parameters" whose value is
 * plain data is still read as a map.
 */
function isTemplate(json: JsonObject): boolean {
	const keys = Object.keys(json);
	if (!keys.includes('parameters') && !keys.includes('parameterGroups')) {
		return false;
	}
	if (!keys.every(k => TEMPLATE_KEYS.has(k))) {
		return false;
	}
	const looksLikeParameters = (value: Json | undefined): boolean =>
		value === undefined ||
		(isObject(value) && Object.values(value).every(p =>
			isObject(p) && ('defaultValue' in p || 'valueType' in p || 'conditionalValues' in p)));
	const groups = json['parameterGroups'];
	return looksLikeParameters(json['parameters']) &&
		(groups === undefined || (isObject(groups) && Object.values(groups).every(g =>
			isObject(g) && looksLikeParameters(g['parameters']))));
}

/** True when any parameter in the template carries conditional values. */
function hasConditionalValues(template: JsonObject): boolean {
	const groups = isObject(template['parameterGroups']) ? Object.values(template['parameterGroups']) : [];
	const parameterSets = [template['parameters'], ...groups.map(g => (isObject(g) ? g['parameters'] : undefined))];
	return parameterSets.some(set => isObject(set) && Object.values(set).some(p =>
		isObject(p) && isObject(p['conditionalValues']) && Object.keys(p['conditionalValues']).length > 0));
}

interface RawRow {
	key: string;
	value: string;
	valueType: RemoteConfigValueType;
	group?: string;
	error?: string;
}

/** A simple map value → the string Firebase stores and the type it implies. */
function inferred(key: string, value: Json, group: string | undefined): RawRow {
	if (typeof value === 'boolean') {
		return { key, value: String(value), valueType: 'BOOLEAN', group };
	}
	if (typeof value === 'number') {
		return { key, value: String(value), valueType: 'NUMBER', group };
	}
	if (typeof value === 'string') {
		return { key, value, valueType: 'STRING', group };
	}
	if (value === null) {
		return { key, value: '', valueType: 'STRING', group, error: 'null is not a value Remote Config can store' };
	}
	return { key, value: JSON.stringify(value), valueType: 'JSON', group };
}

function fromTemplateParameters(parameters: Json | undefined, group: string | undefined): RawRow[] {
	if (!isObject(parameters)) {
		return [];
	}
	return Object.entries(parameters).map(([key, raw]): RawRow => {
		const param = isObject(raw) ? raw : {};
		const type = typeof param['valueType'] === 'string' ? param['valueType'] : 'STRING';
		const valueType = (VALUE_TYPES as string[]).includes(type) ? type as RemoteConfigValueType : 'STRING';
		const defaultValue = isObject(param['defaultValue']) ? param['defaultValue'] : undefined;
		const value = defaultValue?.['value'];
		if (typeof value !== 'string') {
			return {
				key, value: '', valueType, group,
				error: 'No default value in the file (it uses the in-app default)'
			};
		}
		if (!(VALUE_TYPES as string[]).includes(type)) {
			return { key, value, valueType, group, error: `Unknown value type "${type}"` };
		}
		return { key, value, valueType, group };
	});
}

/**
 * Parses [text] into rows, resolving each key against what Firebase already
 * holds ([existing]). An existing key is updated where it lives — even when
 * that is not [targetGroup] — because Firebase keys are unique across the
 * whole template, so writing it elsewhere would create a duplicate.
 */
export function parseBatchJson(text: string, targetGroup: string | undefined, existing: ConfigEntry[]): ImportResult {
	if (text.trim() === '') {
		return { format: 'empty', rows: [], warnings: [] };
	}

	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (err) {
		const detail = err instanceof Error ? err.message : 'could not parse';
		return { format: 'empty', rows: [], warnings: [], error: `Invalid JSON: ${detail}` };
	}
	if (!isObject(json)) {
		return {
			format: 'empty', rows: [], warnings: [],
			error: 'Expected a JSON object: {"key": value, …} or a Firebase template'
		};
	}

	const target = targetGroup?.trim() || undefined;
	const warnings: string[] = [];
	let raw: RawRow[];
	let format: 'map' | 'template';

	if (isTemplate(json)) {
		format = 'template';
		raw = fromTemplateParameters(json['parameters'], undefined);
		const groups = json['parameterGroups'];
		if (isObject(groups)) {
			for (const [name, group] of Object.entries(groups)) {
				raw.push(...fromTemplateParameters(isObject(group) ? group['parameters'] : undefined, name));
			}
		}
		const hasConditions = Array.isArray(json['conditions']) && json['conditions'].length > 0;
		if (hasConditions || hasConditionalValues(json)) {
			warnings.push('Conditions and conditional values in the file are not imported — only default values.');
		}
	} else {
		format = 'map';
		raw = Object.entries(json).map(([key, value]) => inferred(key, value, target));
	}

	const byKey = new Map(existing.map(e => [e.key, e]));
	const seen = new Set<string>();
	const rows = raw.map((row): ImportRow => {
		const current = byKey.get(row.key);
		const group = current ? current.group : row.group;
		const resolved: ImportRow = {
			key: row.key,
			value: row.value,
			valueType: row.valueType,
			group,
			isNew: current === undefined
		};
		if (current && (current.group ?? '') !== (row.group ?? '')) {
			resolved.note = `Already in ${current.group ? `group "${current.group}"` : 'root parameters'} — updated there`;
		}

		const invalid = row.error ??
			(seen.has(row.key) ? 'Appears more than once in the file' : undefined) ??
			validatePush({ key: row.key, value: row.value, valueType: row.valueType, group })?.message;
		seen.add(row.key);
		if (invalid) {
			resolved.error = invalid;
		}
		return resolved;
	});

	const added = rows.filter(r => r.isNew && !r.error).length;
	if (existing.length + added > MAX_PARAMETERS) {
		warnings.push(
			`This would bring the project to ${existing.length + added} parameters; Firebase allows at most ${MAX_PARAMETERS}.`
		);
	}

	return { format, rows, warnings };
}
