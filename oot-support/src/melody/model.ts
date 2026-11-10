import type { BymlNode } from '../byml';

/**
 * The game's `GameParameter/MelodyScoreBook/*.game__ocarina__MelodyScoreBook.bgyml`: a list of songs, each a list of
 * notes. Notes and song types are MurmurHash3 (x86 32-bit, seed 0) hashes of their names, stored as unsigned ints.
 */

export interface NoteInfo {
    name: string;
    hash: number;
    playable: boolean;
    /** Diatonic steps above E4, the bottom line of a treble staff; null for a rest. */
    step: number | null;
    sharp: boolean;
}

const note = (name: string, hash: number, step: number | null, sharp = false, playable = false): NoteInfo =>
    ({ name, hash, playable, step, sharp });

/** Every note the game names, lowest first. Only D, F, A, B and HighD can be played with the buttons. */
export const NOTES: readonly NoteInfo[] = [
    note('Rest', 0x82aa42f2, null),
    note('LowB', 0x82ece4e5, -3),
    note('LowC', 0x395d0c8d, -2),
    note('LowCsharp', 0xbd1d9c59, -2, true),
    note('D', 0x63c05906, -1, false, true),
    note('Dsharp', 0x566a9b07, -1, true),
    note('E', 0x0f783207, 0),
    note('F', 0x982b1106, 1, false, true),
    note('Fsharp', 0xeb3bc3cd, 1, true),
    note('G', 0x7d180799, 2),
    note('Gsharp', 0x8dc74f31, 2, true),
    note('A', 0x54dcf7ce, 3, false, true),
    note('Asharp', 0x2e289bfa, 3, true),
    note('B', 0xcca66a8a, 4, false, true),
    note('C', 0xea1cfe8b, 5),
    note('Csharp', 0x59ff3c72, 5, true),
    note('HighD', 0x3132c854, 6, false, true),
    note('HighDsharp', 0x59933f7f, 6, true),
    note('HighE', 0x012169d9, 7),
    note('HighF', 0xd8419aa4, 8),
];

export interface MelodyTypeInfo {
    name: string;
    hash: number;
    label: string;
}

export const ZELDA_LULLABY = 0x9351cee3;
export const SCARECROW_SONG = 0x1eb2218d;

export const MELODY_TYPES: readonly MelodyTypeInfo[] = [
    { name: 'ZeldaLullaby', hash: ZELDA_LULLABY, label: "Zelda's Lullaby" },
    { name: 'EponaSong', hash: 0x5e112bf7, label: "Epona's Song" },
    { name: 'SariaSong', hash: 0x66333def, label: "Saria's Song" },
    { name: 'SunSong', hash: 0xf00eeadb, label: "Sun's Song" },
    { name: 'TimeSong', hash: 0x61593f33, label: 'Song of Time' },
    { name: 'StormSong', hash: 0xe8fbf2cf, label: 'Song of Storms' },
    { name: 'ForestMinuet', hash: 0xde5c2042, label: 'Minuet of Forest' },
    { name: 'FireBolero', hash: 0x88c95622, label: 'Bolero of Fire' },
    { name: 'WaterSerenade', hash: 0x9c10a724, label: 'Serenade of Water' },
    { name: 'SpiritRequiem', hash: 0xa79e6b4b, label: 'Requiem of Spirit' },
    { name: 'ShadowNocturne', hash: 0xb7c3a9a0, label: 'Nocturne of Shadow' },
    { name: 'LightPrelude', hash: 0xb55bf6c2, label: 'Prelude of Light' },
    { name: 'ScarecrowSong', hash: SCARECROW_SONG, label: "Scarecrow's Song" },
];

export const noteByHash = new Map(NOTES.map((n) => [n.hash, n]));
export const melodyTypeByHash = new Map(MELODY_TYPES.map((t) => [t.hash, t]));

/** Over this many notes a song gets a warning. */
export const LONG_SONG_NOTES = 8;

const KNOWN_SONG_KEYS = ['MelodyScore', 'MelodyType', 'NoteNumForNavi', 'RestToRepeatExample'];

/** A song as the webview edits it. Unknown fields stay in the extension, keyed by `id`. */
export interface Song {
    id: string;
    notes: number[];
    /** Null when the field is left out, which the game reads as ZeldaLullaby. */
    melodyType: number | null;
    noteNumForNavi: number | null;
    restToRepeatExample: number | null;
}

/** What a song's dict held besides the known fields, plus the original nodes of the known number fields. */
interface SongExtras {
    other: Map<string, BymlNode>;
    noteNumForNavi?: BymlNode;
    restToRepeatExample?: BymlNode;
}

export class MelodyBookError extends Error {}

/** The parts of the file this editor doesn't show, kept so a save writes them back unchanged. */
export class MelodyBookShape {
    private readonly extras = new Map<string, SongExtras>();
    private rootOther = new Map<string, BymlNode>();
    private nextId = 0;

    newId(): string {
        return `s${this.nextId++}`;
    }

    /** Reads the songs out of a parsed file, remembering everything else. */
    read(root: BymlNode | null): Song[] {
        this.extras.clear();
        this.rootOther = new Map();
        if (!root) {
            return [];
        }
        if (root.type !== 'dict') {
            throw new MelodyBookError('The root of the file is not a map.');
        }
        for (const [key, value] of root.entries) {
            if (key !== 'MelodyScores') {
                this.rootOther.set(key, value);
            }
        }
        const scores = root.entries.get('MelodyScores');
        if (!scores) {
            return [];
        }
        if (scores.type !== 'array') {
            throw new MelodyBookError('MelodyScores is not a list.');
        }
        return scores.items.map((item, index) => {
            if (item.type !== 'dict') {
                throw new MelodyBookError(`Song ${index + 1} is not a map.`);
            }
            const id = this.newId();
            const extras: SongExtras = { other: new Map() };
            const song: Song = { id, notes: [], melodyType: null, noteNumForNavi: null, restToRepeatExample: null };
            for (const [key, value] of item.entries) {
                if (!KNOWN_SONG_KEYS.includes(key)) {
                    extras.other.set(key, value);
                }
            }
            const score = item.entries.get('MelodyScore');
            if (score) {
                if (score.type !== 'array') {
                    throw new MelodyBookError(`Song ${index + 1}: MelodyScore is not a list.`);
                }
                song.notes = score.items.map((n, i) => {
                    const value = integerOf(n);
                    if (value === null) {
                        throw new MelodyBookError(`Song ${index + 1}, note ${i + 1} is not a number.`);
                    }
                    return value >>> 0;
                });
            }
            const type = item.entries.get('MelodyType');
            if (type) {
                const value = integerOf(type);
                if (value === null) {
                    throw new MelodyBookError(`Song ${index + 1}: MelodyType is not a number.`);
                }
                song.melodyType = value >>> 0;
            }
            for (const field of ['NoteNumForNavi', 'RestToRepeatExample'] as const) {
                const node = item.entries.get(field);
                if (!node) {
                    continue;
                }
                const value = integerOf(node);
                if (value === null) {
                    // Not a whole number: keep it as it is and don't offer it for editing.
                    extras.other.set(field, node);
                    continue;
                }
                if (field === 'NoteNumForNavi') {
                    song.noteNumForNavi = value;
                    extras.noteNumForNavi = node;
                } else {
                    song.restToRepeatExample = value;
                    extras.restToRepeatExample = node;
                }
            }
            this.extras.set(id, extras);
            return song;
        });
    }

    /** Builds the file's root from edited songs, putting back what each song held that the editor doesn't show. */
    build(songs: readonly Song[]): BymlNode {
        const entries = new Map(this.rootOther);
        entries.set('MelodyScores', {
            type: 'array',
            items: songs.map((song) => {
                const extras = this.extras.get(song.id);
                const dict = new Map<string, BymlNode>(extras?.other ?? []);
                dict.set('MelodyScore', {
                    type: 'array',
                    items: song.notes.map((value) => ({ type: 'uint', value: value >>> 0 })),
                });
                if (song.melodyType !== null) {
                    dict.set('MelodyType', { type: 'uint', value: song.melodyType >>> 0 });
                }
                if (song.noteNumForNavi !== null) {
                    dict.set('NoteNumForNavi', sameKind(extras?.noteNumForNavi, song.noteNumForNavi));
                }
                if (song.restToRepeatExample !== null) {
                    dict.set('RestToRepeatExample', sameKind(extras?.restToRepeatExample, song.restToRepeatExample));
                }
                return { type: 'dict', entries: dict } as BymlNode;
            }),
        });
        return { type: 'dict', entries };
    }

    /** Fields of a song this editor keeps but doesn't show. */
    hiddenFields(id: string): string[] {
        return [...(this.extras.get(id)?.other.keys() ?? [])];
    }

    /** A copy of another song's hidden fields for a duplicate. */
    copyExtras(fromId: string, toId: string): void {
        const from = this.extras.get(fromId);
        if (from) {
            this.extras.set(toId, { ...from, other: new Map(from.other) });
        }
    }

    rootFields(): string[] {
        return [...this.rootOther.keys()];
    }
}

function integerOf(node: BymlNode): number | null {
    return node.type === 'int' || node.type === 'uint' ? node.value : null;
}

/** A number written with the type the file had for it, or a signed int for a new field. */
function sameKind(original: BymlNode | undefined, value: number): BymlNode {
    return original?.type === 'uint' ? { type: 'uint', value: value >>> 0 } : { type: 'int', value: value | 0 };
}

export function noteName(hash: number): string {
    return noteByHash.get(hash)?.name ?? hex(hash);
}

export function melodyTypeName(hash: number | null): string {
    if (hash === null) {
        return "Zelda's Lullaby, by default";
    }
    return melodyTypeByHash.get(hash)?.label ?? hex(hash);
}

export function hex(value: number): string {
    return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

export interface Warning {
    /** The songs a warning is about; empty for the whole book. */
    songs: string[];
    level: 'error' | 'warning' | 'info';
    text: string;
}

export function validate(songs: readonly Song[]): Warning[] {
    const warnings: Warning[] = [];
    const label = (song: Song) => `Song ${songs.indexOf(song) + 1} (${melodyTypeName(song.melodyType)})`;

    const byType = new Map<number | null, Song[]>();
    for (const song of songs) {
        byType.set(song.melodyType, [...(byType.get(song.melodyType) ?? []), song]);
    }
    for (const [type, group] of byType) {
        if (group.length > 1) {
            warnings.push({
                songs: group.map((s) => s.id),
                level: 'warning',
                text: type === null
                    ? `${group.length} songs have no MelodyType; the game reads each as Zelda's Lullaby.`
                    : `${group.length} songs share the MelodyType ${melodyTypeName(type)}.`,
            });
        }
    }

    for (const a of songs) {
        for (const b of songs) {
            if (a === b || a.notes.length === 0 || b.notes.length === 0 || a.notes.length > b.notes.length) {
                continue;
            }
            const tail = b.notes.slice(b.notes.length - a.notes.length);
            if (!tail.every((n, i) => n === a.notes[i])) {
                continue;
            }
            if (a.notes.length === b.notes.length) {
                if (songs.indexOf(a) < songs.indexOf(b)) {
                    warnings.push({ songs: [a.id, b.id], level: 'error', text: `${label(a)} and ${label(b)} have the same notes.` });
                }
            } else {
                warnings.push({
                    songs: [a.id, b.id],
                    level: 'error',
                    text: `${label(a)} is the end of ${label(b)}, so playing ${label(b)} may play ${label(a)} first.`,
                });
            }
        }
    }

    for (const song of songs) {
        if (song.melodyType === SCARECROW_SONG && song.notes.length > 0) {
            warnings.push({ songs: [song.id], level: 'warning', text: `${label(song)} has notes, but the player composes the Scarecrow's Song.` });
        }
        if (song.notes.length === 0 && song.melodyType !== SCARECROW_SONG) {
            warnings.push({ songs: [song.id], level: 'warning', text: `${label(song)} has no notes.` });
        }
        if (song.notes.length > LONG_SONG_NOTES) {
            warnings.push({
                songs: [song.id],
                level: 'warning',
                text: `${label(song)} has ${song.notes.length} notes; the longest vanilla song has ${LONG_SONG_NOTES}. The game's note buffer may hold 18 (unconfirmed).`,
            });
        }
        const unplayable = [...new Set(song.notes.filter((n) => noteByHash.has(n) && !noteByHash.get(n)!.playable))];
        if (unplayable.length) {
            warnings.push({
                songs: [song.id],
                level: 'warning',
                text: `${label(song)} uses ${unplayable.map(noteName).join(', ')}, which can't be played with the buttons (pitch bending may reach some; unconfirmed).`,
            });
        }
        if (song.notes.some((n) => !noteByHash.has(n))) {
            warnings.push({ songs: [song.id], level: 'info', text: `${label(song)} has notes with unrecognised hashes; they are kept as they are.` });
        }
        if (song.melodyType !== null && !melodyTypeByHash.has(song.melodyType)) {
            warnings.push({ songs: [song.id], level: 'info', text: `${label(song)} has an unrecognised MelodyType; it is kept as it is.` });
        }
    }
    return warnings;
}
