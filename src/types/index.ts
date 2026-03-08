// All shared interfaces, type aliases, typed error classes, and type guards.
// No logic, no other src/ imports.

export type RemoteConfigValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';

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

export interface AuthContext {
	accessToken: string;
	projectId: string;
	/** Unix epoch seconds when the token expires */
	expiresAt: number;
	userEmail: string;
	userName?: string;
}

export interface PushConfigMessage {
	command: 'pushConfig';
	key: string;
	value: string;
	type: RemoteConfigValueType;
	/** Optional parameter group name. If set, the parameter is placed under parameterGroups[group]. */
	group?: string;
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
