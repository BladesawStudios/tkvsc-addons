/**
 * Minimal TKVSC API types for addon development.
 * Keep in sync with totk-vscode/docs/api/v1.md
 */
import type * as vscode from 'vscode';

export const TKVSC_EXTENSION_ID = 'BladesawStudios.totk-vscode';
export const TKVSC_API_VERSION = 1 as const;

export interface GameIndexingConfig {
    enableRomfsSearch?: boolean;
    enableCanonicalPaths?: boolean;
    archiveExtensions?: string[];
}

export interface GameProfileRegistration {
    id: string;
    displayName: string;
    romfsSentinel: string;
    compressionBackend: string;
    romfsSettingsKey?: string;
    legacyRomfsSettingsKeys?: string[];
    indexing?: GameIndexingConfig;
    archivePatterns?: string[];
    /** MSBT tag definitions (.gcf), relative to the registering addon root. */
    msbtConfigPath?: string;
    /** File of `hash;type;name` lines naming flag hashes. */
    hashNamesPath?: string;
    /** Names for hashed BYML values, one per line; shown in the text as `!hash Name`. */
    valueNamesPath?: string;
    /** More AAMP names, as JSON from hash to name. Relative to the registering addon root. */
    aampHashNamesPath?: string;
    /** The XLink versions new files are written with. */
    xlinkVersions?: { elink?: number; slink?: number };
    /** Name endings that mark a compressed file; default ['.zs']. */
    compressedSuffixes?: string[];
    /** Built-in AAMP names to start from; default 'totk'. */
    aampNameTable?: 'totk' | 'botw' | 'none';
    /** Game plugin DLL for the host, relative to the registering addon root. */
    hostPlugin?: string;
}

export interface GameProfile extends GameProfileRegistration {
    source: 'builtin' | 'manifest' | 'api';
    msbtConfigResolvedPath?: string;
}

export interface TkvscBridgeAccess {
    getHost(): string;
    getBridgeEnv(): NodeJS.ProcessEnv;
    runBridgeJsonAsync<T>(
        hostExecutable: string,
        bridgePath: string,
        args: string[],
        stdin?: string,
        env?: NodeJS.ProcessEnv,
    ): Promise<T>;
}

export interface TkvscApi {
    readonly apiVersion: typeof TKVSC_API_VERSION;
    readonly extensionId: string;
    readonly onDidReady: vscode.Event<void>;
    registerGameProfile(
        registration: GameProfileRegistration,
        options?: { extensionRoot?: string },
    ): vscode.Disposable;
    getActiveGameProfile(): GameProfile;
    getGameProfile(gameId: string): GameProfile | undefined;
    getProjectRoots(): string[];
    readRawBytes(uri: vscode.Uri): Promise<Uint8Array>;
    writeRawBytes(uri: vscode.Uri, data: Uint8Array): Promise<void>;
    getBridge(): TkvscBridgeAccess;
}
