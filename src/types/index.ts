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

/** A single Remote Config parameter, flattened for display in the sidebar. */
export interface ConfigEntry {
	key: string;
	/** The parameter's default value, or '' when it defers to the in-app default. */
	value: string;
	valueType: RemoteConfigValueType;
	/** Undefined for root parameters. */
	group?: string;
	/** How many conditional overrides this parameter carries. */
	conditionCount: number;
	/** True when the parameter has no default value of its own. */
	usesInAppDefault: boolean;
}

/** Root parameters, or one named parameter group, with their entries. */
export interface ConfigSection {
	/** Undefined for the root parameter section. */
	group?: string;
	description?: string;
	entries: ConfigEntry[];
}

/**
 * Everything the sidebar needs to render itself. The view is a pure function of
 * this state, so it can be torn down and rebuilt whenever VS Code hides it.
 */
export type ViewState =
	| { kind: 'no-account' }
	| { kind: 'busy'; message: string }
	| { kind: 'error'; message: string; hasAccount: boolean }
	| {
		kind: 'ready';
		projectId: string;
		accountPath: string;
		sections: ConfigSection[];
	};

/** Extension host → webview. */
export type HostMessage =
	| { type: 'state'; state: ViewState }
	| { type: 'pushResult'; ok: boolean; message: string };

/** Webview → extension host. */
export type WebviewMessage =
	| { type: 'ready' }
	| { type: 'selectAccount' }
	| { type: 'refresh' }
	| { type: 'push'; key: string; value: string; valueType: RemoteConfigValueType; group?: string };

export function isWebviewMessage(value: unknown): value is WebviewMessage {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const type = (value as { type?: unknown }).type;
	return type === 'ready' || type === 'selectAccount' || type === 'refresh' || type === 'push';
}

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
