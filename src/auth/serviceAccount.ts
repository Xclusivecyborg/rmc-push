import * as fs from 'fs';
import * as vscode from 'vscode';
import { isServiceAccount, ServiceAccount, ServiceAccountValidationError } from '../types/index';

/** Returns the configured service account path, or prompts the user to pick one. */
export async function resolveServiceAccountPath(): Promise<string | undefined> {
	const config = vscode.workspace.getConfiguration('rmcPush');
	const existing = config.get<string>('serviceAccountPath');
	if (existing) {
		return existing;
	}

	vscode.window.showWarningMessage('Please select your Firebase service account JSON file.');
	const fileUri = await vscode.window.showOpenDialog({
		canSelectMany: false,
		filters: { 'JSON': ['json'] },
		openLabel: 'Select Service Account JSON'
	});
	if (fileUri && fileUri[0]) {
		const path = fileUri[0].fsPath;
		await config.update('serviceAccountPath', path, vscode.ConfigurationTarget.Workspace);
		vscode.window.showInformationMessage('Service account file set for this workspace. Please re-run the command.');
		return path;
	}
	return undefined;
}

/** Reads and validates a service account JSON file. Throws on failure. */
export async function readServiceAccount(path: string): Promise<ServiceAccount> {
	let raw: string;
	try {
		raw = await fs.promises.readFile(path, 'utf8');
	} catch (err) {
		throw new ServiceAccountValidationError(`Cannot read service account file at "${path}"`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new ServiceAccountValidationError('Service account file is not valid JSON');
	}

	if (!isServiceAccount(parsed)) {
		throw new ServiceAccountValidationError(
			'Service account file is missing required fields (project_id, private_key, client_email)'
		);
	}
	return parsed;
}
