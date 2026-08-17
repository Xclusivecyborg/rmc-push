import fetch from 'node-fetch';
import { AuthContext, ConfigEntry, ConfigSection, FirebaseApiError, RemoteConfigParameter, RemoteConfigTemplate, RemoteConfigValueType } from '../types/index';

function apiUrl(projectId: string): string {
	return `https://firebaseremoteconfig.googleapis.com/v1/projects/${projectId}/remoteConfig`;
}

/** Fetches the current Remote Config template and its ETag. */
export async function fetchRemoteConfig(auth: AuthContext): Promise<{ template: RemoteConfigTemplate; etag: string }> {
	const res = await fetch(apiUrl(auth.projectId), {
		method: 'GET',
		headers: { 'Authorization': `Bearer ${auth.accessToken}` }
	});
	if (!res.ok) {
		throw new FirebaseApiError('Failed to fetch Remote Config', res.status);
	}
	const etag = res.headers.get('etag') ?? '*';
	const template = await res.json() as RemoteConfigTemplate;
	return { template, etag };
}

function toEntry(key: string, param: RemoteConfigParameter, group?: string): ConfigEntry {
	const defaultValue = param.defaultValue;
	return {
		key,
		value: defaultValue?.value ?? '',
		// valueType is optional in the REST API; Firebase treats an absent type as a string.
		valueType: param.valueType ?? 'STRING',
		group,
		conditionCount: Object.keys(param.conditionalValues ?? {}).length,
		usesInAppDefault: defaultValue?.useInAppDefault === true
	};
}

function byKey(a: ConfigEntry, b: ConfigEntry): number {
	return a.key.localeCompare(b.key);
}

/**
 * Pure function — flattens a template into the sections the sidebar renders:
 * the root parameters first, then each parameter group alphabetically.
 * Empty groups are preserved so they remain visible and selectable.
 */
export function toSections(template: RemoteConfigTemplate): ConfigSection[] {
	const rootEntries = Object.entries(template.parameters ?? {})
		.map(([key, param]) => toEntry(key, param))
		.sort(byKey);

	const groupSections = Object.entries(template.parameterGroups ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([group, value]): ConfigSection => ({
			group,
			description: value.description,
			entries: Object.entries(value.parameters ?? {})
				.map(([key, param]) => toEntry(key, param, group))
				.sort(byKey)
		}));

	return [{ entries: rootEntries }, ...groupSections];
}

/**
 * Pure function — merges a single parameter into an existing template.
 * Does not mutate the input template.
 */
export function mergeParameter(
	template: RemoteConfigTemplate,
	key: string,
	value: string,
	type: RemoteConfigValueType
): RemoteConfigTemplate {
	const newParam: RemoteConfigParameter = {
		defaultValue: { value },
		valueType: type
	};
	return {
		...template,
		parameters: {
			...(template.parameters ?? {}),
			[key]: newParam
		}
	};
}

/**
 * Pure function — merges a single parameter into a named parameter group.
 * Creates the group if it does not exist. Does not mutate the input template.
 */
export function mergeParameterInGroup(
	template: RemoteConfigTemplate,
	groupName: string,
	key: string,
	value: string,
	type: RemoteConfigValueType
): RemoteConfigTemplate {
	const newParam: RemoteConfigParameter = {
		defaultValue: { value },
		valueType: type
	};
	const existingGroups = template.parameterGroups ?? {};
	const existingGroup = existingGroups[groupName] ?? { parameters: {} };
	return {
		...template,
		parameterGroups: {
			...existingGroups,
			[groupName]: {
				...existingGroup,
				parameters: {
					...existingGroup.parameters,
					[key]: newParam
				}
			}
		}
	};
}

/** PUTs the full merged template back to Firebase using the ETag for optimistic concurrency. */
export async function pushRemoteConfig(
	auth: AuthContext,
	template: RemoteConfigTemplate,
	etag: string
): Promise<void> {
	const res = await fetch(apiUrl(auth.projectId), {
		method: 'PUT',
		headers: {
			'Authorization': `Bearer ${auth.accessToken}`,
			'Content-Type': 'application/json; charset=UTF-8',
			'If-Match': etag
		},
		body: JSON.stringify(template)
	});
	if (!res.ok) {
		const errText = await res.text();
		throw new FirebaseApiError(`Failed to update Remote Config: ${errText}`, res.status);
	}
}
