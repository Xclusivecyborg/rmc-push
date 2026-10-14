// Owns everything that must outlive the sidebar view.
//
// VS Code freely disposes a WebviewView whenever it is hidden, so the service
// account, access token, and fetched template cannot live in the view or in a
// command closure. They live here, and the view re-renders from getState()
// every time it is (re)created.

import * as vscode from 'vscode';
import { getAuthContext, isTokenExpired } from './auth/googleAuth';
import { readServiceAccount } from './auth/serviceAccount';
import {
	fetchRemoteConfig,
	keysOf,
	mergeChanges,
	pushRemoteConfig,
	toSections
} from './firebase/remoteConfig';
import { logger } from './logger';
import { AuthContext, ConfigSection, ParameterChange, ServiceAccount, ViewState } from './types/index';
import { normalizeValue, validatePush } from './validation';

const CONFIG_SECTION = 'rmcPush';
const CONFIG_KEY = 'serviceAccountPath';

/** Thrown by push() when the input fails host-side validation. */
export class PushValidationError extends Error {
	constructor(message: string, public readonly field: string) {
		super(message);
		this.name = 'PushValidationError';
	}
}

export class RmcPushSession implements vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<ViewState>();
	/** Fires whenever the state changes, so every attached view can re-render. */
	readonly onDidChangeState = this.emitter.event;

	private state: ViewState = { kind: 'no-account' };
	private serviceAccount: ServiceAccount | null = null;
	private auth: AuthContext | null = null;

	/** Changes waiting for a batch push, by key. */
	private readonly staged = new Map<string, ParameterChange>();
	/** The account the batch was staged against; a different one discards it. */
	private stagedForPath = '';

	/**
	 * Incremented on every connect(). An in-flight connect whose generation is
	 * stale discards its result, so a slow first attempt cannot overwrite the
	 * state produced by a faster later one.
	 */
	private generation = 0;

	private readonly subscriptions: vscode.Disposable[] = [];

	constructor() {
		this.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_KEY}`)) {
					void this.connect();
				}
			})
		);
	}

	getState(): ViewState {
		return this.state;
	}

	private setState(state: ViewState): void {
		this.state = state;
		this.emitter.fire(state);
	}

	private static readConfiguredPath(): string {
		return vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(CONFIG_KEY)?.trim() ?? '';
	}

	/**
	 * Workspace scope keeps the path next to the project it belongs to, but that
	 * target does not exist when the user has no folder open — the sidebar is
	 * reachable then too, so fall back to global scope.
	 */
	private static writeConfiguredPath(path: string | undefined): Thenable<void> {
		const target = vscode.workspace.workspaceFolders?.length
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global;
		return vscode.workspace.getConfiguration(CONFIG_SECTION).update(CONFIG_KEY, path, target);
	}

	/**
	 * Reads the configured service account, authenticates, and loads the current
	 * template. Safe to call repeatedly; the newest call wins.
	 */
	async connect(): Promise<void> {
		const generation = ++this.generation;
		const isCurrent = (): boolean => generation === this.generation;

		const path = RmcPushSession.readConfiguredPath();
		// Staged changes belong to the project they were made against.
		if (path !== this.stagedForPath) {
			this.staged.clear();
			this.stagedForPath = path;
		}
		if (path === '') {
			this.serviceAccount = null;
			this.auth = null;
			this.setState({ kind: 'no-account' });
			return;
		}

		this.setState({ kind: 'busy', message: 'Connecting to Firebase…' });

		try {
			const serviceAccount = await readServiceAccount(path);
			if (!isCurrent()) {
				return;
			}
			this.serviceAccount = serviceAccount;
			this.auth = await getAuthContext(serviceAccount);
			if (!isCurrent()) {
				return;
			}
			logger.info(`Authenticated for project: ${this.auth.projectId}`);
			await this.loadTemplate(isCurrent);
		} catch (err) {
			if (!isCurrent()) {
				return;
			}
			this.fail(err, 'Failed to connect to Firebase');
		}
	}

	/** Re-fetches the template using the existing credentials. */
	async refresh(): Promise<void> {
		if (this.serviceAccount === null) {
			await this.connect();
			return;
		}
		const generation = ++this.generation;
		const isCurrent = (): boolean => generation === this.generation;

		this.setState({ kind: 'busy', message: 'Loading Remote Config…' });
		try {
			await this.ensureAuth();
			await this.loadTemplate(isCurrent);
		} catch (err) {
			if (isCurrent()) {
				this.fail(err, 'Failed to load Remote Config');
			}
		}
	}

	private async loadTemplate(isCurrent: () => boolean): Promise<void> {
		const auth = this.auth;
		if (auth === null) {
			throw new Error('Not authenticated');
		}
		const { template } = await fetchRemoteConfig(auth);
		if (!isCurrent()) {
			return;
		}
		this.setReady(auth, toSections(template));
	}

	private setReady(auth: AuthContext, sections: ConfigSection[]): void {
		this.setState({
			kind: 'ready',
			projectId: auth.projectId,
			accountPath: RmcPushSession.readConfiguredPath(),
			sections,
			staged: [...this.staged.values()]
		});
	}

	/** Re-sends the ready state after the batch changed. */
	private emitStaged(): void {
		if (this.state.kind === 'ready') {
			this.setState({ ...this.state, staged: [...this.staged.values()] });
		}
	}

	/**
	 * Refreshes the access token when it is close to expiry. The service account
	 * is held for the lifetime of the session, so this never needs the user.
	 */
	private async ensureAuth(): Promise<AuthContext> {
		const serviceAccount = this.serviceAccount;
		if (serviceAccount === null) {
			throw new Error('No service account selected');
		}
		if (this.auth === null || isTokenExpired(this.auth)) {
			logger.info('Access token expired — re-authenticating.');
			this.auth = await getAuthContext(serviceAccount);
		}
		return this.auth;
	}

	private fail(err: unknown, fallback: string): void {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(fallback, err);
		this.setState({
			kind: 'error',
			message: message || fallback,
			hasAccount: RmcPushSession.readConfiguredPath() !== ''
		});
	}

	/** Prompts for a service account JSON file and connects to it. */
	async selectAccount(): Promise<boolean> {
		const picked = await vscode.window.showOpenDialog({
			canSelectMany: false,
			filters: { JSON: ['json'] },
			openLabel: 'Select Service Account JSON',
			title: 'Select your Firebase service account JSON file'
		});
		const file = picked?.[0];
		if (file === undefined) {
			return false;
		}
		await RmcPushSession.writeConfiguredPath(file.fsPath);
		await this.connect();
		return true;
	}

	/** Forgets the configured service account and returns to the empty state. */
	async clearAccount(): Promise<void> {
		await RmcPushSession.writeConfiguredPath(undefined);
		await this.connect();
	}

	/**
	 * Validates, merges, and pushes a single parameter, then shows the template
	 * Firebase now holds. Anything staged for the same key is dropped — this
	 * push supersedes it.
	 */
	async push(input: ParameterChange): Promise<void> {
		const change = RmcPushSession.checked(input);
		await this.write([change]);
		this.staged.delete(change.key);
		this.emitStaged();
	}

	/** Adds a change to the batch, replacing anything already staged for its key. */
	stage(input: ParameterChange): void {
		const change = RmcPushSession.checked(input);
		if (change.isNew && this.state.kind === 'ready') {
			const taken = this.state.sections.some(s => s.entries.some(e => e.key === change.key));
			if (taken) {
				throw new PushValidationError(`A parameter named "${change.key}" already exists`, 'key');
			}
		}
		this.staged.set(change.key, change);
		this.emitStaged();
	}

	/**
	 * Stages several changes at once — an import, or the batch form. All are
	 * validated before any is staged, so a bad row cannot leave half a batch.
	 */
	stageMany(inputs: ParameterChange[]): void {
		const changes = inputs.map(input => {
			try {
				return RmcPushSession.checked(input);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				throw new PushValidationError(`"${input.key}": ${reason}`, 'key');
			}
		});
		changes.forEach(change => this.staged.set(change.key, change));
		this.emitStaged();
	}

	unstage(key: string): void {
		if (this.staged.delete(key)) {
			this.emitStaged();
		}
	}

	discardStaged(): void {
		this.staged.clear();
		this.emitStaged();
	}

	getStaged(): ParameterChange[] {
		return [...this.staged.values()];
	}

	/**
	 * Pushes [changes] — normally everything staged — as one template version.
	 * On success they leave the batch, unless one was re-staged with a
	 * different value while the push was in flight; that newer edit is kept.
	 */
	async pushStaged(changes: ParameterChange[]): Promise<void> {
		if (changes.length === 0) {
			throw new PushValidationError('Nothing to push', 'key');
		}
		const checked = changes.map(RmcPushSession.checked);
		await this.write(checked);
		for (const pushed of changes) {
			const current = this.staged.get(pushed.key);
			if (current !== undefined && sameChange(current, pushed)) {
				this.staged.delete(pushed.key);
			}
		}
		this.emitStaged();
	}

	/**
	 * Re-fetches immediately before the write so the ETag is fresh — a stale
	 * one would be rejected by the API — then merges and PUTs once.
	 */
	private async write(changes: ParameterChange[]): Promise<void> {
		const auth = await this.ensureAuth();
		const { template, etag } = await fetchRemoteConfig(auth);

		// Firebase keys are unique across root and groups; a "new" key that
		// already exists would land as a second parameter and be rejected.
		const existing = keysOf(template);
		const clash = changes.find(c => c.isNew && existing.has(c.key));
		if (clash) {
			throw new PushValidationError(`A parameter named "${clash.key}" already exists`, 'key');
		}

		const updated = mergeChanges(template, changes);
		await pushRemoteConfig(auth, updated, etag);
		logger.info(`Pushed ${changes.map(c => `${c.key} (${c.valueType})`).join(', ')}`);

		this.setReady(auth, toSections(updated));
	}

	/** Validates and canonicalises a change, or throws PushValidationError. */
	private static checked(input: ParameterChange): ParameterChange {
		const invalid = validatePush(input);
		if (invalid !== null) {
			throw new PushValidationError(invalid.message, invalid.field);
		}
		const group = input.group?.trim() ?? '';
		return {
			key: input.key.trim(),
			value: normalizeValue(input.value, input.valueType),
			valueType: input.valueType,
			group: group === '' ? undefined : group,
			isNew: input.isNew === true
		};
	}

	dispose(): void {
		this.emitter.dispose();
		this.subscriptions.forEach(d => d.dispose());
	}
}

function sameChange(a: ParameterChange, b: ParameterChange): boolean {
	return a.key === b.key && a.value === b.value && a.valueType === b.valueType &&
		(a.group ?? '') === (b.group ?? '') && a.isNew === b.isNew;
}
