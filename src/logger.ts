import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;
let disposed = false;

/**
 * The channel is created on first use rather than at import time, and writes
 * are dropped once the extension has been deactivated.
 *
 * Both matter because activate() starts work it does not await (the initial
 * session.connect()). If the window closes mid-connect, deactivate() runs
 * first and the extension host tears down its disposable store; a later
 * appendLine would then write to a closed channel, and lazily recreating one
 * at that point throws "Trying to add a disposable to a DisposableStore that
 * has already been disposed of". Dropping the message is the correct outcome —
 * there is no longer anywhere for it to go.
 */
function write(line: string): void {
	if (disposed) {
		return;
	}
	if (channel === undefined) {
		channel = vscode.window.createOutputChannel('RMC Push');
	}
	channel.appendLine(line);
}

export const logger = {
	info(message: string): void {
		write(`[INFO]  ${message}`);
	},
	error(message: string, err?: unknown): void {
		const detail = err instanceof Error ? err.message : String(err ?? '');
		write(`[ERROR] ${message}${detail ? ': ' + detail : ''}`);
	},
	dispose(): void {
		disposed = true;
		channel?.dispose();
		channel = undefined;
	}
};
