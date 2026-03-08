import fetch from 'node-fetch';
import { AuthContext, FirebaseApiError, RemoteConfigParameter, RemoteConfigTemplate, RemoteConfigValueType } from '../types/index';

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
	etag: string,
	authorName?: string
): Promise<void> {
	const description = authorName
		? `Pushed by ${authorName} via rmc-push`
		: 'Pushed via rmc-push';
	const body: RemoteConfigTemplate = { ...template, version: { description } };
	const res = await fetch(apiUrl(auth.projectId), {
		method: 'PUT',
		headers: {
			'Authorization': `Bearer ${auth.accessToken}`,
			'Content-Type': 'application/json; charset=UTF-8',
			'If-Match': etag
		},
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const errText = await res.text();
		throw new FirebaseApiError(`Failed to update Remote Config: ${errText}`, res.status);
	}
}
