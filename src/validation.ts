// Validation shared by the extension host and the tests.
//
// The webview runs its own copy of these rules for instant feedback, but that
// copy is only a convenience: the host re-validates every push here before it
// touches Firebase, so a malformed message can never reach the API.

import { RemoteConfigValueType } from './types/index';

/** Parameter keys are read as code identifiers by client SDKs — no spaces. */
export const KEY_REGEX = /^[a-zA-Z0-9_]+$/;

/**
 * Group names are display labels in the Firebase console, not identifiers, so
 * they routinely contain spaces ("Feature Flags"). Leading and trailing
 * whitespace is trimmed before this is applied.
 */
export const GROUP_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_ -]*$/;

export const VALUE_TYPES: RemoteConfigValueType[] = ['STRING', 'NUMBER', 'BOOLEAN', 'JSON'];

export interface PushInput {
	key: string;
	value: string;
	valueType: RemoteConfigValueType;
	group?: string;
}

/** Which field an error belongs to, so the webview can place the message. */
export type PushField = 'key' | 'value' | 'group';

export interface ValidationError {
	field: PushField;
	message: string;
}

/**
 * Pure function — returns the first validation error, or null when the input is
 * safe to push.
 */
export function validatePush(input: PushInput): ValidationError | null {
	const key = input.key.trim();
	const group = input.group?.trim() ?? '';

	if (key === '') {
		return { field: 'key', message: 'Key is required' };
	}
	if (!KEY_REGEX.test(key)) {
		return { field: 'key', message: 'Use only letters, numbers, and underscores' };
	}
	if (group !== '' && !GROUP_REGEX.test(group)) {
		return {
			field: 'group',
			message: 'Use letters, numbers, spaces, underscores, and hyphens'
		};
	}
	if (input.value === '') {
		return { field: 'value', message: 'Value is required' };
	}

	switch (input.valueType) {
		case 'NUMBER':
			if (input.value.trim() === '' || Number.isNaN(Number(input.value))) {
				return { field: 'value', message: 'Must be a valid number' };
			}
			break;
		case 'BOOLEAN':
			if (!['true', 'false'].includes(input.value.toLowerCase().trim())) {
				return { field: 'value', message: 'Must be "true" or "false"' };
			}
			break;
		case 'JSON':
			try {
				JSON.parse(input.value);
			} catch (err) {
				const detail = err instanceof Error ? err.message : 'invalid';
				return { field: 'value', message: `Invalid JSON: ${detail}` };
			}
			break;
		case 'STRING':
			break;
	}

	return null;
}

/**
 * Pure function — canonicalises a value for storage. Booleans are lower-cased so
 * Firebase always receives exactly "true" or "false".
 */
export function normalizeValue(value: string, valueType: RemoteConfigValueType): string {
	return valueType === 'BOOLEAN' ? value.toLowerCase().trim() : value;
}
