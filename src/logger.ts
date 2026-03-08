import * as vscode from 'vscode';

const channel = vscode.window.createOutputChannel('RMC Push');

export const logger = {
	info(message: string): void {
		channel.appendLine(`[INFO]  ${message}`);
	},
	error(message: string, err?: unknown): void {
		const detail = err instanceof Error ? err.message : String(err ?? '');
		channel.appendLine(`[ERROR] ${message}${detail ? ': ' + detail : ''}`);
	},
	dispose(): void {
		channel.dispose();
	}
};
