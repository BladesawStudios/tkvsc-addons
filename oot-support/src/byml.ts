/**
 * A small BYML reader and writer, enough for game parameter files (`.bgyml`) made of maps, arrays, strings and 32-bit
 * scalars. It writes the layout Nintendo's files use: header, key table, string table, then containers in pre-order,
 * each followed by its own child containers. Other node types (64-bit values, binary data, hash maps) are read as
 * opaque and can't be written; callers should check `canWrite` or catch `BymlWriteError`.
 */

export type BymlNode =
    | { type: 'dict'; entries: Map<string, BymlNode> }
    | { type: 'array'; items: BymlNode[] }
    | { type: 'string'; value: string }
    | { type: 'bool'; value: boolean }
    | { type: 'int'; value: number }
    | { type: 'uint'; value: number }
    | { type: 'float'; bits: number }
    | { type: 'null' }
    | { type: 'opaque'; tag: number };

export interface BymlFile {
    root: BymlNode | null;
    version: number;
    bigEndian: boolean;
}

export class BymlWriteError extends Error {}

const T = {
    string: 0xa0,
    array: 0xc0,
    dict: 0xc1,
    stringTable: 0xc2,
    bool: 0xd0,
    int: 0xd1,
    float: 0xd2,
    uint: 0xd3,
    null: 0xff,
} as const;

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

export function readByml(data: Uint8Array): BymlFile {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = String.fromCharCode(data[0] ?? 0, data[1] ?? 0);
    if (magic !== 'YB' && magic !== 'BY') {
        throw new Error('Not a BYML file (it does not start with YB or BY).');
    }
    const le = magic === 'YB';
    const u16 = (o: number) => view.getUint16(o, le);
    const u32 = (o: number) => view.getUint32(o, le);
    const u24 = (o: number) => (le
        ? data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)
        : (data[o] << 16) | (data[o + 1] << 8) | data[o + 2]);

    const readTable = (offset: number): string[] => {
        if (offset === 0) {
            return [];
        }
        if (data[offset] !== T.stringTable) {
            throw new Error(`Expected a string table at 0x${offset.toString(16)}.`);
        }
        const count = u24(offset + 1);
        const out: string[] = [];
        for (let i = 0; i < count; i++) {
            const start = offset + u32(offset + 4 + 4 * i);
            let end = start;
            while (end < data.length && data[end] !== 0) {
                end++;
            }
            out.push(textDecoder.decode(data.subarray(start, end)));
        }
        return out;
    };

    const version = u16(2);
    const keys = readTable(u32(4));
    const strings = readTable(u32(8));
    const rootOffset = u32(12);

    const readValue = (tag: number, slot: number, depth: number): BymlNode => {
        const raw = u32(slot);
        switch (tag) {
            case T.string:
                return { type: 'string', value: strings[raw] ?? '' };
            case T.array:
            case T.dict:
                return readContainer(raw, depth + 1);
            case T.bool:
                return { type: 'bool', value: raw !== 0 };
            case T.int:
                return { type: 'int', value: view.getInt32(slot, le) };
            case T.float:
                return { type: 'float', bits: raw };
            case T.uint:
                return { type: 'uint', value: raw };
            case T.null:
                return { type: 'null' };
            default:
                return { type: 'opaque', tag };
        }
    };

    const readContainer = (offset: number, depth: number): BymlNode => {
        if (depth > 64) {
            throw new Error('BYML nesting is too deep.');
        }
        const tag = data[offset];
        const count = u24(offset + 1);
        if (tag === T.array) {
            const valuesAt = offset + 4 + ((count + 3) & ~3);
            const items: BymlNode[] = [];
            for (let i = 0; i < count; i++) {
                items.push(readValue(data[offset + 4 + i], valuesAt + 4 * i, depth));
            }
            return { type: 'array', items };
        }
        if (tag === T.dict) {
            const entries = new Map<string, BymlNode>();
            for (let i = 0; i < count; i++) {
                const at = offset + 4 + 8 * i;
                const key = keys[u24(at)];
                if (key === undefined) {
                    throw new Error(`Key index out of range at 0x${at.toString(16)}.`);
                }
                entries.set(key, readValue(data[at + 3], at + 4, depth));
            }
            return { type: 'dict', entries };
        }
        return { type: 'opaque', tag };
    };

    return { root: rootOffset === 0 ? null : readContainer(rootOffset, 0), version, bigEndian: !le };
}

/** Whether `writeByml` can write every node in the tree. */
export function canWrite(node: BymlNode | null): boolean {
    if (!node) {
        return true;
    }
    switch (node.type) {
        case 'opaque':
            return false;
        case 'array':
            return node.items.every(canWrite);
        case 'dict':
            return [...node.entries.values()].every(canWrite);
        default:
            return true;
    }
}

function compareBytes(a: string, b: string): number {
    const x = textEncoder.encode(a);
    const y = textEncoder.encode(b);
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) {
        if (x[i] !== y[i]) {
            return x[i] - y[i];
        }
    }
    return x.length - y.length;
}

const align4 = (n: number) => (n + 3) & ~3;

const isContainer = (node: BymlNode): node is Extract<BymlNode, { type: 'dict' | 'array' }> =>
    node.type === 'dict' || node.type === 'array';

const sortedEntries = (node: Extract<BymlNode, { type: 'dict' }>) =>
    [...node.entries].sort(([a], [b]) => compareBytes(a, b));

const children = (node: BymlNode): BymlNode[] => {
    if (node.type === 'array') {
        return node.items;
    }
    if (node.type === 'dict') {
        return sortedEntries(node).map(([, value]) => value);
    }
    return [];
};

export function writeByml(file: BymlFile): Uint8Array {
    const keySet = new Set<string>();
    const stringSet = new Set<string>();
    const collect = (node: BymlNode) => {
        if (node.type === 'opaque') {
            throw new BymlWriteError(`This file holds a BYML node of type 0x${node.tag.toString(16)}, which this editor can't write.`);
        }
        if (node.type === 'string') {
            stringSet.add(node.value);
        }
        if (node.type === 'dict') {
            for (const key of node.entries.keys()) {
                keySet.add(key);
            }
        }
        children(node).forEach(collect);
    };
    if (file.root) {
        if (!isContainer(file.root)) {
            throw new BymlWriteError('The root of a BYML file must be a map or an array.');
        }
        collect(file.root);
    }
    const keys = [...keySet].sort(compareBytes);
    const strings = [...stringSet].sort(compareBytes);
    const keyIndex = new Map(keys.map((k, i) => [k, i]));
    const stringIndex = new Map(strings.map((s, i) => [s, i]));

    const tableSize = (list: string[]) => {
        if (list.length === 0) {
            return 0;
        }
        const bytes = list.reduce((sum, s) => sum + textEncoder.encode(s).length + 1, 0);
        return align4(4 + 4 * (list.length + 1) + bytes);
    };

    const keyTableAt = keys.length ? 16 : 0;
    const stringTableAt = strings.length ? 16 + tableSize(keys) : 0;
    let cursor = 16 + tableSize(keys) + tableSize(strings);

    // Offsets in pre-order: a container, then each of its child containers with all of theirs.
    const offsets = new Map<BymlNode, number>();
    const place = (node: BymlNode) => {
        offsets.set(node, cursor);
        cursor += node.type === 'array' ? 4 + align4(node.items.length) + 4 * node.items.length : 4 + 8 * children(node).length;
        children(node).filter(isContainer).forEach(place);
    };
    if (file.root) {
        place(file.root);
    }

    const out = new Uint8Array(cursor);
    const view = new DataView(out.buffer);
    const le = !file.bigEndian;
    const u32 = (o: number, v: number) => view.setUint32(o, v >>> 0, le);
    const u24 = (o: number, v: number) => {
        if (le) {
            out[o] = v & 0xff;
            out[o + 1] = (v >> 8) & 0xff;
            out[o + 2] = (v >> 16) & 0xff;
        } else {
            out[o] = (v >> 16) & 0xff;
            out[o + 1] = (v >> 8) & 0xff;
            out[o + 2] = v & 0xff;
        }
    };

    out[0] = le ? 0x59 : 0x42;
    out[1] = le ? 0x42 : 0x59;
    view.setUint16(2, file.version, le);
    u32(4, keyTableAt);
    u32(8, stringTableAt);
    u32(12, file.root ? offsets.get(file.root)! : 0);

    const writeTable = (at: number, list: string[]) => {
        out[at] = T.stringTable;
        u24(at + 1, list.length);
        let pos = 4 + 4 * (list.length + 1);
        list.forEach((s, i) => {
            u32(at + 4 + 4 * i, pos);
            const bytes = textEncoder.encode(s);
            out.set(bytes, at + pos);
            pos += bytes.length + 1;
        });
        u32(at + 4 + 4 * list.length, pos);
    };
    if (keyTableAt) {
        writeTable(keyTableAt, keys);
    }
    if (stringTableAt) {
        writeTable(stringTableAt, strings);
    }

    const tagOf = (node: BymlNode): number => {
        switch (node.type) {
            case 'string': return T.string;
            case 'array': return T.array;
            case 'dict': return T.dict;
            case 'bool': return T.bool;
            case 'int': return T.int;
            case 'float': return T.float;
            case 'uint': return T.uint;
            case 'null': return T.null;
            default: throw new BymlWriteError('Opaque nodes cannot be written.');
        }
    };
    const writeSlot = (at: number, node: BymlNode) => {
        switch (node.type) {
            case 'string': u32(at, stringIndex.get(node.value)!); break;
            case 'array':
            case 'dict': u32(at, offsets.get(node)!); break;
            case 'bool': u32(at, node.value ? 1 : 0); break;
            case 'int': view.setInt32(at, node.value | 0, le); break;
            case 'float':
            case 'uint': u32(at, node.type === 'float' ? node.bits : node.value); break;
            case 'null': u32(at, 0); break;
            default: throw new BymlWriteError('Opaque nodes cannot be written.');
        }
    };

    for (const [node, at] of offsets) {
        if (node.type === 'array') {
            out[at] = T.array;
            u24(at + 1, node.items.length);
            const valuesAt = at + 4 + align4(node.items.length);
            node.items.forEach((item, i) => {
                out[at + 4 + i] = tagOf(item);
                writeSlot(valuesAt + 4 * i, item);
            });
        } else if (node.type === 'dict') {
            const entries = sortedEntries(node);
            out[at] = T.dict;
            u24(at + 1, entries.length);
            entries.forEach(([key, value], i) => {
                const entryAt = at + 4 + 8 * i;
                u24(entryAt, keyIndex.get(key)!);
                out[entryAt + 3] = tagOf(value);
                writeSlot(entryAt + 4, value);
            });
        }
    }

    return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}
