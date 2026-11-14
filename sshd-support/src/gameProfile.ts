import * as fs from 'fs';
import * as path from 'path';
import type { GameProfileRegistration } from './tkvscTypes';

export const SSHD_GAME_ID = 'sshd';

export const SSHD_ROMFS_SENTINEL_POSIX = 'Object/NX/ObjectPack.arc.LZ';

const SSHD_ROMFS_SENTINEL = path.join(...SSHD_ROMFS_SENTINEL_POSIX.split('/'));

/** Must match `contributes.tkvsc.gameProfile` in package.json. */
export const SSHD_GAME_PROFILE: GameProfileRegistration = {
    id: SSHD_GAME_ID,
    displayName: 'Skyward Sword HD',
    romfsSentinel: SSHD_ROMFS_SENTINEL_POSIX,
    // The host plugin provides LZ11; the field is still required.
    compressionBackend: 'plugin',
    compressedSuffixes: ['.LZ'],
    romfsSettingsKey: 'sshd.romfsPath',
    indexing: {
        enableRomfsSearch: true,
        enableCanonicalPaths: false,
        archiveExtensions: ['.arc', '.arc.LZ'],
    },
    archivePatterns: ['\\.arc(\\.LZ)?$'],
    aampNameTable: 'none',
    hostPlugin: 'bin/plugin/Tkvsc.Sshd.Plugin.dll',
};

function isSshdRomfsPath(romfsRoot: string): boolean {
    return romfsRoot.length > 0 && fs.existsSync(path.join(romfsRoot, SSHD_ROMFS_SENTINEL));
}

/**
 * Accepts the RomFS folder itself or a parent holding it, such as a dump with `exefs` and `romfs` side by side.
 */
export function resolveSshdRomfsRoot(selectedPath: string): string | undefined {
    const normalized = path.normalize(selectedPath);
    if (isSshdRomfsPath(normalized)) {
        return normalized;
    }

    try {
        for (const entry of fs.readdirSync(normalized, { withFileTypes: true })) {
            const nested = path.join(normalized, entry.name);
            if (entry.isDirectory() && isSshdRomfsPath(nested)) {
                return nested;
            }
        }
    } catch {
        return undefined;
    }

    return undefined;
}
