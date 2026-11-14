import * as path from 'path';
import * as vscode from 'vscode';
import type { TkvscApi } from '../tkvscTypes';

/** A file sent to a plugin command: its bytes, and for textures the .xtx or .brres beside it. */
export interface PluginInput {
    name: string;
    data: Uint8Array;
    sibling?: Uint8Array;
    siblingName?: string;
}

/**
 * Runs one of the SSHD plugin's viewer commands. The file goes on standard input, so it works for any URI the add-on can
 * read (inside archives, in projects, or in the game dump), and the plugin removes LZ compression itself.
 */
export async function runPluginCommand<T>(api: TkvscApi, args: string[], input: PluginInput): Promise<T> {
    const bridge = api.getBridge();
    const host = bridge.getHost();
    if (!host) {
        throw new Error('The TKVSC host is not available for this platform.');
    }
    const stdin = JSON.stringify({
        name: input.name,
        data: Buffer.from(input.data).toString('base64'),
        sibling: input.sibling ? Buffer.from(input.sibling).toString('base64') : undefined,
        siblingName: input.siblingName,
    });
    return bridge.runBridgeJsonAsync<T>(host, '', args, stdin, bridge.getBridgeEnv());
}

export function fileName(uri: vscode.Uri): string {
    return path.posix.basename(uri.path);
}

/** The same file with a different extension, e.g. model.xtx -> model.brres. */
export function withExtension(uri: vscode.Uri, extension: string): vscode.Uri {
    const name = fileName(uri);
    const dot = name.indexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    return uri.with({ path: path.posix.join(path.posix.dirname(uri.path), stem + extension) });
}

export function nonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
