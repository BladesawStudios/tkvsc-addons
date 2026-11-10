/**
 * The resource size table (`System/Resource/ResourceSizeTable.Product.*.rsizetable.zs`, RESTBL version 1): how much
 * memory the game sets aside to load each file. Keys are the CRC32 of the romfs path without `.zs`.
 *
 * Sizes follow the Ocarina of Time calculator (RSTBSharp `OotSizeCalculator`, `rstb_calc.py`):
 * `align32(fileSize) + align8(typeBase + costs) + 16 KB margin` for an edited bgyml. Unchanged vanilla files keep
 * their vanilla value.
 */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(text: string): number {
    let crc = 0xffffffff;
    for (const byte of new TextEncoder().encode(text)) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

const HEADER_SIZE = 22;

interface Layout {
    view: DataView;
    nameSize: number;
    crcCount: number;
    nameCount: number;
}

function layout(table: Uint8Array): Layout {
    const magic = String.fromCharCode(...table.subarray(0, 6));
    if (magic !== 'RESTBL') {
        throw new Error('Not a resource size table (no RESTBL header).');
    }
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const version = view.getUint32(6, true);
    if (version !== 1) {
        throw new Error(`Unsupported RESTBL version ${version}.`);
    }
    return { view, nameSize: view.getUint32(10, true), crcCount: view.getUint32(14, true), nameCount: view.getUint32(18, true) };
}

function findName(table: Uint8Array, l: Layout, path: string): number {
    const start = HEADER_SIZE + 8 * l.crcCount;
    for (let i = 0; i < l.nameCount; i++) {
        const at = start + i * (l.nameSize + 4);
        const raw = table.subarray(at, at + l.nameSize);
        const end = raw.indexOf(0);
        if (new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end)) === path) {
            return at + l.nameSize;
        }
    }
    return -1;
}

function findCrc(l: Layout, crc: number): { index: number; found: boolean } {
    let lo = 0;
    let hi = l.crcCount;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const value = l.view.getUint32(HEADER_SIZE + 8 * mid, true);
        if (value === crc) {
            return { index: mid, found: true };
        }
        if (value < crc) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return { index: lo, found: false };
}

/** The table's value for a romfs path (no `.zs`), or undefined when it has none. */
export function getEntry(table: Uint8Array, path: string): number | undefined {
    const l = layout(table);
    const named = findName(table, l, path);
    if (named >= 0) {
        return l.view.getUint32(named, true);
    }
    const { index, found } = findCrc(l, crc32(path));
    return found ? l.view.getUint32(HEADER_SIZE + 8 * index + 4, true) : undefined;
}

/** A copy of the table with the path's value set, adding a CRC entry in order when it has none. */
export function setEntry(table: Uint8Array, path: string, value: number): Uint8Array {
    const l = layout(table);
    const named = findName(table, l, path);
    if (named >= 0) {
        const copy = table.slice();
        new DataView(copy.buffer).setUint32(named, value >>> 0, true);
        return copy;
    }
    const crc = crc32(path);
    const { index, found } = findCrc(l, crc);
    if (found) {
        const copy = table.slice();
        new DataView(copy.buffer).setUint32(HEADER_SIZE + 8 * index + 4, value >>> 0, true);
        return copy;
    }
    const at = HEADER_SIZE + 8 * index;
    const out = new Uint8Array(table.length + 8);
    out.set(table.subarray(0, at));
    out.set(table.subarray(at), at + 8);
    const view = new DataView(out.buffer);
    view.setUint32(14, l.crcCount + 1, true);
    view.setUint32(at, crc, true);
    view.setUint32(at + 4, value >>> 0, true);
    return out;
}

const align = (n: number, to: number) => Math.ceil(n / to) * to;

/** The fitted model for `game__ocarina__MelodyScoreBook` from the 1.1.1 table (bgyml_model.json). */
const MELODY_BOOK_BASE = 6840;
const VANILLA_SONGS = 12;
const VANILLA_NOTES = 74;
/** The model charges fields with no fitted cost the type's dearest cost, at least 64, past the vanilla count. */
const UNFITTED_COST = 64;
const BGYML_MARGIN = 16 * 1024;

/** The size an edited MelodyScoreBook should get, margin included. */
export function melodyBookSize(fileSize: number, songs: number, notes: number): number {
    const offset = MELODY_BOOK_BASE
        + UNFITTED_COST * Math.max(0, songs - VANILLA_SONGS)
        + UNFITTED_COST * Math.max(0, notes - VANILLA_NOTES);
    return align(fileSize, 32) + align(offset, 8) + BGYML_MARGIN;
}
