import * as vscode from 'vscode';
import { logger } from '../logger';
import { PushValidationError, RmcPushSession } from '../session';
import { parseBatchJson } from '../batchImport';
import { ConfigEntry, HostMessage, isWebviewMessage, ParameterChange, ViewState } from '../types/index';
import { getWebviewContent } from './content';

/**
 * Runs work that nothing awaits, without leaking a rejection.
 *
 * An unhandled rejection here surfaces in the debug console as a bare
 * "rejected promise not handled within 1 second" with no indication of which
 * extension caused it, so route the failure to our own log instead.
 */
function fireAndForget(work: Thenable<unknown>, context: string): void {
	work.then(undefined, (err: unknown) => logger.error(context, err));
}

/**
 * Hosts the sidebar. Holds no application state of its own — it renders
 * whatever RmcPushSession reports and forwards user intent back to it, so
 * VS Code can dispose and recreate it at will.
 */
/** Firebase rejects templates over 1 MB, so a larger import could never be pushed. */
const MAX_IMPORT_BYTES = 1024 * 1024;

function errorText(err: unknown): string {
	if (err instanceof PushValidationError || err instanceof Error) {
		return err.message;
	}
	return String(err);
}

function oneLine(value: string): string {
	const flat = value.replace(/\s*\n\s*/g, ' ').trim();
	return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

export class RmcPushViewProvider implements vscode.WebviewViewProvider {
	/** Must match the view id contributed in package.json. */
	static readonly viewType = 'rmcPush.configView';

	private view: vscode.WebviewView | undefined;

	constructor(
		private readonly session: RmcPushSession,
		private readonly extensionUri: vscode.Uri
	) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
		};
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		webviewView.webview.onDidReceiveMessage((message: unknown) => {
			if (!isWebviewMessage(message)) {
				logger.error('Ignored unrecognised message from webview');
				return;
			}
			switch (message.type) {
				case 'ready':
					// The script mounts after the HTML is set, so the first state has
					// to wait for it to say so or it lands on a page with no listener.
					this.render(this.session.getState());
					break;
				case 'selectAccount':
					fireAndForget(this.session.selectAccount(), 'Selecting a service account failed');
					break;
				case 'refresh':
					fireAndForget(this.session.refresh(), 'Refreshing Remote Config failed');
					break;
				case 'clearAccount':
					fireAndForget(this.session.clearAccount(), 'Disconnecting failed');
					break;
				case 'openSettings':
					fireAndForget(
						vscode.commands.executeCommand('workbench.action.openSettings', 'rmcPush'),
						'Opening settings failed'
					);
					break;
				case 'push':
					fireAndForget(this.handlePush(message.change), 'Push handling failed');
					break;
				case 'stage':
					this.handleStage(message.change);
					break;
				case 'unstage':
					this.session.unstage(message.key);
					break;
				case 'discardStaged':
					fireAndForget(this.confirmDiscard(), 'Discarding the batch failed');
					break;
				case 'reviewStaged':
					fireAndForget(this.reviewAndPush(), 'Batch push failed');
					break;
				case 'stageMany':
					this.handleStageMany(message.changes);
					break;
				case 'previewImport':
					this.post({
						type: 'importPreview',
						requestId: message.requestId,
						result: parseBatchJson(message.text, message.group, this.currentEntries())
					});
					break;
				case 'pickImportFile':
					fireAndForget(this.pickImportFile(), 'Reading the JSON file failed');
					break;
			}
		});

		webviewView.onDidDispose(() => {
			this.view = undefined;
		});
	}

	private async handlePush(change: ParameterChange): Promise<void> {
		try {
			await this.session.push(change);
			const target = change.group ? `group "${change.group}"` : 'root parameters';
			this.post({ type: 'pushResult', ok: true, message: `Pushed "${change.key}" to ${target}.`, key: change.key });
		} catch (err) {
			logger.error('Push failed', err);
			this.post({ type: 'pushResult', ok: false, message: errorText(err), key: change.key });
		}
	}

	private handleStage(change: ParameterChange): void {
		try {
			this.session.stage(change);
			this.post({ type: 'stageResult', ok: true, message: `Added "${change.key}" to the batch.`, key: change.key });
		} catch (err) {
			this.post({ type: 'stageResult', ok: false, message: errorText(err), key: change.key });
		}
	}

	private handleStageMany(changes: ParameterChange[]): void {
		try {
			this.session.stageMany(changes);
			const n = changes.length;
			this.post({ type: 'stageManyResult', ok: true, message: `Added ${n} parameter${n === 1 ? '' : 's'} to the batch.` });
		} catch (err) {
			this.post({ type: 'stageManyResult', ok: false, message: errorText(err) });
		}
	}

	private currentEntries(): ConfigEntry[] {
		const state = this.session.getState();
		return state.kind === 'ready' ? state.sections.flatMap(s => s.entries) : [];
	}

	/** Opens a native file picker and hands the chosen file's text to the import box. */
	private async pickImportFile(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({
			canSelectMany: false,
			filters: { JSON: ['json'] },
			openLabel: 'Import',
			title: 'Choose a JSON file to add to the batch'
		});
		const file = picked?.[0];
		if (file === undefined) {
			return;
		}
		const stat = await vscode.workspace.fs.stat(file);
		// Firebase's own template limit; anything larger cannot be pushed anyway.
		if (stat.size > MAX_IMPORT_BYTES) {
			this.post({ type: 'importFileError', message: 'That file is over 1 MB — larger than Firebase allows a template to be.' });
			return;
		}
		const bytes = await vscode.workspace.fs.readFile(file);
		const name = file.path.split('/').pop() ?? 'file';
		this.post({ type: 'importFile', text: new TextDecoder('utf-8').decode(bytes), name });
	}

	private async confirmDiscard(): Promise<void> {
		const n = this.session.getStaged().length;
		if (n === 0) {
			return;
		}
		const choice = await vscode.window.showWarningMessage(
			`Discard ${n} staged change${n === 1 ? '' : 's'}? Nothing has been pushed yet.`,
			{ modal: true },
			'Discard'
		);
		if (choice === 'Discard') {
			this.session.discardStaged();
		}
	}

	/**
	 * Lists everything staged, current value beside new, with every change
	 * ticked; the user unticks any to hold back and confirms. The ticked ones
	 * are pushed as one template version.
	 */
	private async reviewAndPush(): Promise<void> {
		const staged = this.session.getStaged();
		if (staged.length === 0) {
			return;
		}
		const state = this.session.getState();
		const current = new Map(
			state.kind === 'ready' ? state.sections.flatMap(s => s.entries).map(e => [e.key, e] as const) : []
		);

		const items = staged.map(change => {
			const before = current.get(change.key);
			const was = before ? oneLine(before.value) : 'new parameter';
			return {
				label: change.key,
				description: [change.valueType, change.group].filter(Boolean).join(' · '),
				detail: `${was}  →  ${oneLine(change.value)}`,
				picked: true,
				change
			};
		});

		const picked = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			title: 'Push batch to Firebase',
			placeHolder: 'Untick any change to hold it back, then press Enter to push. All of it lands or none does.',
			ignoreFocusOut: true
		});
		if (!picked || picked.length === 0) {
			return;
		}

		const changes = picked.map(p => p.change);
		this.post({ type: 'batchResult', status: 'pending', message: 'Pushing…' });
		try {
			await this.session.pushStaged(changes);
			const n = changes.length;
			this.post({ type: 'batchResult', status: 'ok', message: `Pushed ${n} change${n === 1 ? '' : 's'} to Firebase.` });
		} catch (err) {
			logger.error('Batch push failed', err);
			this.post({ type: 'batchResult', status: 'bad', message: errorText(err) });
		}
	}

	/** Pushes new state into the webview, if one is currently alive. */
	render(state: ViewState): void {
		this.post({ type: 'state', state });
	}

	private post(message: HostMessage): void {
		const view = this.view;
		if (view === undefined) {
			return;
		}
		// Rejects if the webview was disposed between the check and the send —
		// a normal race when the user hides the sidebar mid-request, not an error.
		view.webview.postMessage(message).then(undefined, () => undefined);
	}

	/** Reveals the sidebar and gives it focus. */
	async reveal(): Promise<void> {
		if (this.view) {
			this.view.show(true);
			return;
		}
		// No view yet — asking VS Code to focus it creates and resolves one.
		await vscode.commands.executeCommand(`${RmcPushViewProvider.viewType}.focus`);
	}
}
