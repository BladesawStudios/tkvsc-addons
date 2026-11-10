import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BymlWriteError, bytesEqual, canWrite, readByml, writeByml, type BymlFile } from '../byml';
import type { TkvscApi } from '../tkvscTypes';
import {
    MELODY_TYPES,
    MelodyBookShape,
    NOTES,
    validate,
    type Song,
} from './model';
import { getEntry, melodyBookSize, setEntry } from './rstb';

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const MELODY_BOOK_DIR = 'GameParameter/MelodyScoreBook';
const SIZE_TABLE_DIR = 'System/Resource';

class MelodyDocument implements vscode.CustomDocument {
    songs: Song[] = [];
    shape = new MelodyBookShape();
    file!: BymlFile;
    original!: Uint8Array;
    compressed = false;
    /** Why the file can't be saved, or undefined when it can. */
    readonlyReason?: string;
    /** Shown above the editor: something the user should know about this file. */
    notice?: string;
    error?: string;
    askedAboutSizeTable = false;

    constructor(readonly uri: vscode.Uri) {}

    dispose(): void {}
}

interface EditMessage {
    type: 'edit';
    label: string;
    songs: (Song & { copyOf?: string })[];
}

type WebviewMessage =
    | { type: 'ready' }
    | EditMessage
    | { type: 'need-audio'; names: string[] }
    | { type: 'open-text' };

export class MelodyEditorProvider implements vscode.CustomEditorProvider<MelodyDocument> {
    static readonly viewType = 'tkvsc-oot.melodyScoreBook';

    private readonly changes = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<MelodyDocument>>();
    readonly onDidChangeCustomDocument = this.changes.event;
    private readonly webviews = new Map<MelodyDocument, Set<vscode.WebviewPanel>>();

    static register(context: vscode.ExtensionContext, api: TkvscApi): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            MelodyEditorProvider.viewType,
            new MelodyEditorProvider(context, api),
            { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true },
        );
    }

    constructor(private readonly context: vscode.ExtensionContext, private readonly api: TkvscApi) {}

    // ---- documents ----

    async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<MelodyDocument> {
        const doc = new MelodyDocument(uri);
        await this.load(doc);
        if (openContext.backupId && !doc.error) {
            try {
                const backup = JSON.parse(await fs.promises.readFile(vscode.Uri.parse(openContext.backupId).fsPath, 'utf8')) as { songs: Song[] };
                doc.songs = backup.songs;
            } catch {
                // A missing or broken backup leaves the file as it is on disk.
            }
        }
        return doc;
    }

    private async load(doc: MelodyDocument): Promise<void> {
        doc.error = undefined;
        doc.notice = undefined;
        doc.readonlyReason = this.readonlyReason(doc.uri);
        try {
            let bytes = await this.api.readRawBytes(doc.uri);
            doc.compressed = ZSTD_MAGIC.every((b, i) => bytes[i] === b);
            if (doc.compressed) {
                bytes = await this.decompress(doc.uri.fsPath);
            }
            doc.original = bytes;
            doc.file = readByml(bytes);
            doc.shape = new MelodyBookShape();
            doc.songs = doc.shape.read(doc.file.root);

            if (!canWrite(doc.file.root)) {
                doc.readonlyReason ??= 'This file holds BYML data the melody editor can\'t write (64-bit values, binary data or hash maps). Use the text editor to change it.';
            } else if (!bytesEqual(writeByml(doc.file), bytes)) {
                doc.notice = 'The editor lays this file out differently from how it was written. Saving keeps its contents but not its byte layout.';
            }
        } catch (e) {
            doc.error = e instanceof Error ? e.message : String(e);
            doc.songs = [];
        }
    }

    private readonlyReason(uri: vscode.Uri): string | undefined {
        if (uri.scheme === 'totk-dump' || uri.scheme === 'sarc-dump') {
            return 'This is the game dump, which is read-only. Copy the file into a project to edit it.';
        }
        const dump = this.dumpRomfs();
        if (dump && isInside(uri.fsPath, dump)) {
            return 'This file is in the game dump, which is read-only. Copy it into a project to edit it.';
        }
        return undefined;
    }

    async saveCustomDocument(doc: MelodyDocument): Promise<void> {
        await this.write(doc, doc.uri);
    }

    async saveCustomDocumentAs(doc: MelodyDocument, destination: vscode.Uri): Promise<void> {
        await this.write(doc, destination);
    }

    private async write(doc: MelodyDocument, target: vscode.Uri): Promise<void> {
        if (doc.error) {
            throw new Error(`The file could not be read, so it can't be saved: ${doc.error}`);
        }
        if (doc.readonlyReason && target.toString() === doc.uri.toString()) {
            throw new Error(doc.readonlyReason);
        }
        let bytes: Uint8Array;
        try {
            bytes = writeByml({ ...doc.file, root: doc.shape.build(doc.songs) });
        } catch (e) {
            throw new Error(e instanceof BymlWriteError ? e.message : `Could not build the file: ${String(e)}`);
        }
        if (doc.compressed) {
            await fs.promises.writeFile(target.fsPath, await this.compress(bytes, target.fsPath));
        } else {
            await this.api.writeRawBytes(target, bytes);
        }
        if (target.toString() === doc.uri.toString()) {
            doc.original = bytes;
        }
        // Not awaited: it may ask a question, and the save itself is already done.
        void this.updateSizeTable(doc, target, bytes).catch((e) => {
            void vscode.window.showWarningMessage(`MelodyScoreBook saved, but its RSTB entry was not updated: ${e instanceof Error ? e.message : String(e)}`);
        });
    }

    async revertCustomDocument(doc: MelodyDocument): Promise<void> {
        await this.load(doc);
        this.refresh(doc);
    }

    async backupCustomDocument(doc: MelodyDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
        await fs.promises.mkdir(path.dirname(context.destination.fsPath), { recursive: true });
        await fs.promises.writeFile(context.destination.fsPath, JSON.stringify({ songs: doc.songs }), 'utf8');
        return {
            id: context.destination.toString(),
            delete: () => fs.promises.unlink(context.destination.fsPath).catch(() => undefined),
        };
    }

    // ---- webview ----

    async resolveCustomEditor(doc: MelodyDocument, panel: vscode.WebviewPanel): Promise<void> {
        const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
        panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
        panel.webview.html = this.html(panel.webview, media);

        const panels = this.webviews.get(doc) ?? new Set();
        panels.add(panel);
        this.webviews.set(doc, panels);
        panel.onDidDispose(() => panels.delete(panel));

        panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            switch (message.type) {
                case 'ready':
                    void panel.webview.postMessage(this.state(doc));
                    break;
                case 'edit':
                    this.applyEdit(doc, message);
                    break;
                case 'need-audio':
                    for (const name of message.names) {
                        void this.sendAudio(doc, panel, name);
                    }
                    break;
                case 'open-text':
                    await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default');
                    break;
            }
        });
    }

    private applyEdit(doc: MelodyDocument, message: EditMessage): void {
        if (doc.readonlyReason || doc.error) {
            this.refresh(doc);
            return;
        }
        const before = doc.songs;
        const after: Song[] = message.songs.map(({ copyOf, ...song }) => {
            if (copyOf) {
                doc.shape.copyExtras(copyOf, song.id);
            }
            return {
                id: String(song.id),
                notes: song.notes.map((n) => n >>> 0),
                melodyType: song.melodyType === null ? null : song.melodyType >>> 0,
                noteNumForNavi: wholeOrNull(song.noteNumForNavi),
                restToRepeatExample: wholeOrNull(song.restToRepeatExample),
            };
        });
        doc.songs = after;
        this.refresh(doc);
        this.changes.fire({
            document: doc,
            label: message.label,
            undo: () => {
                doc.songs = before;
                this.refresh(doc);
            },
            redo: () => {
                doc.songs = after;
                this.refresh(doc);
            },
        });
    }

    private refresh(doc: MelodyDocument): void {
        const state = this.state(doc);
        for (const panel of this.webviews.get(doc) ?? []) {
            void panel.webview.postMessage(state);
        }
    }

    private state(doc: MelodyDocument) {
        return {
            type: 'state',
            fileName: path.basename(doc.uri.fsPath),
            songs: doc.songs,
            warnings: validate(doc.songs),
            hidden: Object.fromEntries(doc.songs.map((s) => [s.id, doc.shape.hiddenFields(s.id)])),
            rootFields: doc.shape.rootFields(),
            readonlyReason: doc.readonlyReason,
            notice: doc.notice,
            error: doc.error,
            notes: NOTES,
            melodyTypes: MELODY_TYPES,
        };
    }

    private html(webview: vscode.Webview, media: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('base64');
        const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'melodyEditor.css'));
        const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'melodyEditor.js'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>Ocarina Songs</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
    }

    // ---- audio ----

    /** Decodes `Sound/Resource/Stream/Ocarina_<name>.bwav`, from the file's own project first, and sends it as WAV. */
    private async sendAudio(doc: MelodyDocument, panel: vscode.WebviewPanel, name: string): Promise<void> {
        const reply = (data?: string, error?: string) => void panel.webview.postMessage({ type: 'audio', name, data, error });
        if (!/^[A-Za-z]+$/.test(name)) {
            reply(undefined, 'Bad name');
            return;
        }
        const relative = path.join('Sound', 'Resource', 'Stream', `Ocarina_${name}.bwav`);
        const roots = [romfsRootOf(doc.uri.fsPath), this.dumpRomfs()].filter((r): r is string => !!r);
        const file = roots.map((r) => path.join(r, relative)).find((p) => fs.existsSync(p));
        if (!file) {
            reply(undefined, `Ocarina_${name}.bwav was not found. Set the Ocarina of Time game dump path to hear notes.`);
            return;
        }
        try {
            const bridge = this.api.getBridge();
            const host = requireHost(bridge.getHost());
            const result = await bridge.runBridgeJsonAsync<{ wavPath?: string; error?: string }>(
                host, '', ['read-bwav-audio', file, ''], undefined, bridge.getBridgeEnv(),
            );
            if (!result.wavPath) {
                throw new Error(result.error ?? 'The host returned no audio.');
            }
            const wav = await fs.promises.readFile(result.wavPath);
            void fs.promises.unlink(result.wavPath).catch(() => undefined);
            reply(wav.toString('base64'));
        } catch (e) {
            reply(undefined, e instanceof Error ? e.message : String(e));
        }
    }

    // ---- compression and the size table ----

    private dumpRomfs(): string | undefined {
        const configured = vscode.workspace.getConfiguration('TKVSC').get<string>('oot.romfsPath', '').trim();
        return configured || undefined;
    }

    private async decompress(file: string): Promise<Uint8Array> {
        const bridge = this.api.getBridge();
        const host = requireHost(bridge.getHost());
        const result = await bridge.runBridgeJsonAsync<{ path: string }>(host, '', ['decompress-file', file], undefined, bridge.getBridgeEnv());
        const bytes = await fs.promises.readFile(result.path);
        void fs.promises.unlink(result.path).catch(() => undefined);
        return bytes;
    }

    /** Compresses as the game does for this name; `plain` forces zstd without a dictionary (the size table's form). */
    private async compress(data: Uint8Array, logicalPath: string, plain = false): Promise<Uint8Array> {
        const bridge = this.api.getBridge();
        const host = requireHost(bridge.getHost());
        const input = path.join(os.tmpdir(), `tkvsc-oot-${crypto.randomBytes(4).toString('hex')}.bin`);
        await fs.promises.writeFile(input, data);
        try {
            const env = plain ? { ...bridge.getBridgeEnv(), TKVSC_COMPRESSION_BACKEND: 'plain-zstd-yaz0' } : bridge.getBridgeEnv();
            const result = await bridge.runBridgeJsonAsync<{ path: string }>(host, '', ['compress-file', input, logicalPath], undefined, env);
            const bytes = await fs.promises.readFile(result.path);
            void fs.promises.unlink(result.path).catch(() => undefined);
            return bytes;
        } finally {
            void fs.promises.unlink(input).catch(() => undefined);
        }
    }

    /**
     * Keeps the file's RSTB entry right: the vanilla value while the file matches the dump, otherwise the calculated
     * size. Writes the project's own size table, and offers to add one (copied from the dump) when it has none.
     */
    private async updateSizeTable(doc: MelodyDocument, target: vscode.Uri, bytes: Uint8Array): Promise<void> {
        const romfs = romfsRootOf(target.fsPath);
        const dump = this.dumpRomfs();
        if (!romfs || !dump || isInside(target.fsPath, dump)) {
            return;
        }
        const tableName = findSizeTable(dump);
        if (!tableName) {
            return;
        }
        const entryPath = `${MELODY_BOOK_DIR}/${path.basename(target.fsPath).replace(/\.zs$/i, '')}`;
        const dumpTable = await this.decompress(path.join(dump, SIZE_TABLE_DIR, tableName));
        const vanillaValue = getEntry(dumpTable, entryPath);
        const vanillaFile = path.join(dump, ...entryPath.split('/'));

        let vanillaBytes: Uint8Array | undefined;
        if (fs.existsSync(vanillaFile)) {
            vanillaBytes = await fs.promises.readFile(vanillaFile);
        } else if (fs.existsSync(`${vanillaFile}.zs`)) {
            vanillaBytes = await this.decompress(`${vanillaFile}.zs`);
        }
        const required = vanillaValue !== undefined && vanillaBytes && bytesEqual(vanillaBytes, bytes)
            ? vanillaValue
            : melodyBookSize(bytes.length, doc.songs.length, doc.songs.reduce((n, s) => n + s.notes.length, 0));

        const projectTable = path.join(romfs, ...SIZE_TABLE_DIR.split('/'), tableName);
        let table: Uint8Array;
        if (fs.existsSync(projectTable)) {
            table = await this.decompress(projectTable);
            if (getEntry(table, entryPath) === required) {
                return;
            }
        } else {
            if (required === vanillaValue || doc.askedAboutSizeTable) {
                return;
            }
            doc.askedAboutSizeTable = true;
            const add = 'Add size table';
            const choice = await vscode.window.showInformationMessage(
                `The edited MelodyScoreBook needs an RSTB entry of ${required} bytes (vanilla ${vanillaValue ?? 'none'}). `
                + `This project has no ${tableName}. Add one, copied from the game dump with the new entry?`,
                add,
                'Not now',
            );
            if (choice !== add) {
                return;
            }
            table = dumpTable;
        }

        const updated = setEntry(table, entryPath, required);
        await fs.promises.mkdir(path.dirname(projectTable), { recursive: true });
        await fs.promises.writeFile(projectTable, await this.compress(updated, tableName.replace(/\.zs$/i, ''), true));
        vscode.window.setStatusBarMessage(`RSTB: ${entryPath} set to ${required}`, 5000);
    }
}

function requireHost(host: string): string {
    if (!host) {
        throw new Error('The TKVSC host is not available for this platform.');
    }
    return host;
}

function wholeOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function isInside(file: string, folder: string): boolean {
    const relative = path.relative(path.resolve(folder), path.resolve(file));
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The romfs folder a MelodyScoreBook sits in: the folder above `GameParameter/MelodyScoreBook`. */
function romfsRootOf(file: string): string | undefined {
    const parts = path.resolve(file).split(/[\\/]/);
    for (let i = parts.length - 3; i >= 0; i--) {
        if (parts[i].toLowerCase() === 'gameparameter' && parts[i + 1]?.toLowerCase() === 'melodyscorebook') {
            return i > 0 ? parts.slice(0, i).join(path.sep) || path.sep : undefined;
        }
    }
    return undefined;
}

function findSizeTable(romfs: string): string | undefined {
    try {
        return fs.readdirSync(path.join(romfs, ...SIZE_TABLE_DIR.split('/')))
            .filter((name) => /^ResourceSizeTable\.Product\.\d+\..*rsizetable\.zs$/i.test(name))
            .sort()
            .pop();
    } catch {
        return undefined;
    }
}
