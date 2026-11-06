import * as fs from 'fs';
import * as path from 'path';
import type { GameProfileRegistration } from './tkvscTypes';

export const OOT_GAME_ID = 'oot';

export const OOT_ROMFS_SENTINEL_POSIX = 'Pack/Bootup.Nin_Ounce_NVN2.pack.zs';

const OOT_ROMFS_SENTINEL = path.join(...OOT_ROMFS_SENTINEL_POSIX.split('/'));

const ARCHIVE_EXTENSIONS = ['.pack', '.sarc', '.genvb', '.blarc', '.bfarc', '.bkres', '.bntx'];

export const OOT_GAME_PROFILE: GameProfileRegistration = {
    id: OOT_GAME_ID,
    displayName: 'Ocarina of Time',
    romfsSentinel: OOT_ROMFS_SENTINEL_POSIX,
    compressionBackend: 'totk-zstd',
    romfsSettingsKey: 'oot.romfsPath',
    indexing: {
        enableRomfsSearch: true,
        enableCanonicalPaths: true,
        archiveExtensions: [...ARCHIVE_EXTENSIONS, ...ARCHIVE_EXTENSIONS.map((extension) => `${extension}.zs`)],
    },
    archivePatterns: ['\\.(pack|sarc|genvb|blarc|bfarc|bkres|bntx)(\\.zs)?$'],
    msbtConfigPath: 'OoT.gcf',
    hashNamesPath: 'OoT.hashes.csv',
    aampHashNamesPath: 'OoT.aampnames.json',
    xlinkVersions: { elink: 36, slink: 34 },
};

function isOotRomfsPath(romfsRoot: string): boolean {
    return romfsRoot.length > 0 && fs.existsSync(path.join(romfsRoot, OOT_ROMFS_SENTINEL));
}

/**
 * Accepts the RomFS folder itself or a parent holding it, such as a dump's version folder.
 */
export function resolveOotRomfsRoot(selectedPath: string): string | undefined {
    const normalized = path.normalize(selectedPath);
    if (isOotRomfsPath(normalized)) {
        return normalized;
    }

    try {
        for (const entry of fs.readdirSync(normalized, { withFileTypes: true })) {
            const nested = path.join(normalized, entry.name);
            if (entry.isDirectory() && isOotRomfsPath(nested)) {
                return nested;
            }
        }
    } catch {
        return undefined;
    }

    return undefined;
}
