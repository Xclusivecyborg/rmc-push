// All shared interfaces, type aliases, typed error classes, and type guards.
// No logic, no other src/ imports.

export type RemoteConfigValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';

export interface ServiceAccount {
	type: string;
	project_id: string;
	private_key_id: string;
	private_key: string;
	client_email: string;
	client_id: string;
	auth_uri: string;
	token_uri: string;
}

export interface RemoteConfigParameterValue {
	value?: string;
	useInAppDefault?: boolean;
}

export interface RemoteConfigParameter {
	defaultValue?: RemoteConfigParameterValue;
	conditionalValues?: Record<string, RemoteConfigParameterValue>;
	description?: string;
	valueType?: RemoteConfigValueType;
}

export interface RemoteConfigCondition {
	name: string;
	expression: string;
	tagColor?: string;
}

export interface RemoteConfigParameterGroup {
	description?: string;
	parameters: Record<string, RemoteConfigParameter>;
}

export interface RemoteConfigTemplate {
	parameters?: Record<string, RemoteConfigParameter>;
	conditions?: RemoteConfigCondition[];
	parameterGroups?: Record<string, RemoteConfigParameterGroup>;
	version?: Record<string, unknown>;
}

export interface OAuthTokenResponse {
	access_token: string;
	expires_in: number;
	token_type: string;
}

export interface AuthContext {
	accessToken: string;
	projectId: string;
	/** Unix epoch seconds when the token expires */
	expiresAt: number;
}

export interface PushConfigMessage {
	command: 'pushConfig';
	key: string;
	value: string;
	type: RemoteConfigValueType;
}

export type WebviewStatusMessage =
	| { status: 'loading' }
	| { status: 'success'; message: string }
	| { status: 'error'; message: string };

// Typed error classes

export class AuthError extends Error {
	constructor(message: string, public readonly cause?: unknown) {
		super(message);
		this.name = 'AuthError';
	}
}

export class FirebaseApiError extends Error {
	constructor(message: string, public readonly statusCode?: number, public readonly cause?: unknown) {
		super(message);
		this.name = 'FirebaseApiError';
	}
}

export class ServiceAccountValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ServiceAccountValidationError';
	}
}

// Type guard

export function isServiceAccount(obj: unknown): obj is ServiceAccount {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}
	const sa = obj as Record<string, unknown>;
	return (
		typeof sa['project_id'] === 'string' &&
		typeof sa['private_key'] === 'string' &&
		typeof sa['client_email'] === 'string' &&
		typeof sa['type'] === 'string'
	);
}
