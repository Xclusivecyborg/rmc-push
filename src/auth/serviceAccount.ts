import * as fs from 'fs';
import { isServiceAccount, ServiceAccount, ServiceAccountValidationError } from '../types/index';

// Picking and storing the path is RmcPushSession's job — this module only turns
// a path into a validated ServiceAccount, and so stays free of vscode imports.

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
