import * as os from 'os';
import * as vscode from 'vscode';
import type { TkvscApi } from '../tkvscTypes';
import { errorMessage, fileName, nonce, runPluginCommand, withExtension, type PluginInput } from './pluginHost';

interface TextureInfo {
    name: string;
    width: number;
    height: number;
    format: string;
    levels: number;
    problem?: string | null;
}

class TextureDocument implements vscode.CustomDocument {
    readonly pngs = new Map<number, string>();
    textures: TextureInfo[] = [];

    constructor(readonly uri: vscode.Uri, readonly input: PluginInput) {}

    dispose(): void {
        this.pngs.clear();
    }
}

/**
 * Shows the textures in an XTX, TPL, BTI or BRES file. A model's .xtx and .brres are read together: the BRES names the HD
 * textures, and the XTX holds the pixels for the BRES's TEX0 slots.
 */
export class TextureViewerProvider implements vscode.CustomReadonlyEditorProvider<TextureDocument> {
    static readonly viewType = 'tkvsc-sshd.textureViewer';

    static register(context: vscode.ExtensionContext, api: TkvscApi): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(TextureViewerProvider.viewType, new TextureViewerProvider(api), {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: true,
        });
    }

    private constructor(private readonly api: TkvscApi) {}

    async openCustomDocument(uri: vscode.Uri): Promise<TextureDocument> {
        const name = fileName(uri);
        const data = await this.api.readRawBytes(uri);
        const siblingUri = /\.xtx$/i.test(name) ? withExtension(uri, '.brres')
            : /\.(brres|brresc|brtex)$/i.test(name) ? withExtension(uri, '.xtx')
            : undefined;

        let sibling: Uint8Array | undefined;
        if (siblingUri) {
            try {
                sibling = await this.api.readRawBytes(siblingUri);
            } catch {
                // No sibling: an XTX shows unnamed textures, a BRES says which TEX0s it can't fill.
            }
        }

        const document = new TextureDocument(uri, { name, data, sibling, siblingName: siblingUri ? fileName(siblingUri) : undefined });
        const result = await runPluginCommand<{ textures: TextureInfo[] }>(this.api, ['sshd-textures'], document.input);
        document.textures = result.textures;
        return document;
    }

    async resolveCustomEditor(document: TextureDocument, panel: vscode.WebviewPanel): Promise<void> {
        panel.webview.options = { enableScripts: true };
        panel.webview.html = this.html(panel.webview, document);

        panel.webview.onDidReceiveMessage(async (message: { type: string; index?: number }) => {
            const index = message.index ?? 0;
            try {
                switch (message.type) {
                    case 'select':
                        await panel.webview.postMessage({ type: 'image', index, png: await this.png(document, index) });
                        break;
                    case 'export':
                        await this.exportOne(document, index);
                        break;
                    case 'exportAll':
                        await this.exportAll(document);
                        break;
                }
            } catch (error) {
                if (message.type === 'select') {
                    await panel.webview.postMessage({ type: 'error', index, message: errorMessage(error) });
                } else {
                    void vscode.window.showErrorMessage(`Texture export failed: ${errorMessage(error)}`);
                }
            }
        });
    }

    private async png(document: TextureDocument, index: number): Promise<string> {
        let png = document.pngs.get(index);
        if (!png) {
            png = (await runPluginCommand<{ png: string }>(this.api, ['sshd-textures', String(index)], document.input)).png;
            document.pngs.set(index, png);
        }
        return png;
    }

    private async exportOne(document: TextureDocument, index: number): Promise<void> {
        const texture = document.textures[index];
        const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(defaultExportFolder(), safeName(texture.name) + '.png'),
            filters: { 'PNG image': ['png'] },
            title: `Export ${texture.name}`,
        });
        if (!target) {
            return;
        }
        await vscode.workspace.fs.writeFile(target, Buffer.from(await this.png(document, index), 'base64'));
        void vscode.window.showInformationMessage(`Exported ${texture.name} to ${target.fsPath}`);
    }

    private async exportAll(document: TextureDocument): Promise<void> {
        const folder = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: 'Export Here',
            title: `Export the textures in ${fileName(document.uri)}`,
        });
        if (!folder?.[0]) {
            return;
        }

        const skipped: string[] = [];
        let written = 0;
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Exporting ${document.textures.length} textures`, cancellable: true },
            async (progress, token) => {
                for (let i = 0; i < document.textures.length && !token.isCancellationRequested; i++) {
                    const texture = document.textures[i];
                    progress.report({ message: texture.name, increment: 100 / document.textures.length });
                    if (texture.problem) {
                        skipped.push(texture.name);
                        continue;
                    }
                    const target = vscode.Uri.joinPath(folder[0], safeName(texture.name) + '.png');
                    await vscode.workspace.fs.writeFile(target, Buffer.from(await this.png(document, i), 'base64'));
                    written++;
                }
            },
        );

        const note = skipped.length > 0 ? ` Skipped ${skipped.length} that can't be shown: ${skipped.join(', ')}.` : '';
        void vscode.window.showInformationMessage(`Exported ${written} textures to ${folder[0].fsPath}.${note}`);
    }

    private html(webview: vscode.Webview, document: TextureDocument): string {
        const n = nonce();
        const textures = JSON.stringify(document.textures).replace(/</g, '\\u003c');
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    body { margin: 0; padding: 0; display: flex; height: 100vh; overflow: hidden; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); background: var(--vscode-editor-background); }
    #list { width: 260px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid var(--vscode-panel-border); }
    .item { padding: 6px 10px; cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border); }
    .item:hover { background: var(--vscode-list-hoverBackground); }
    .item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .item .meta { opacity: 0.7; font-size: 0.9em; }
    .item.unavailable { opacity: 0.5; }
    #main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    #toolbar { display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; }
    #title { font-weight: bold; margin-right: auto; }
    button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 10px; cursor: pointer; border-radius: 2px; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    #stage { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 16px; }
    #stage.checker { background: repeating-conic-gradient(#808080 0% 25%, #b0b0b0 0% 50%) 0 0 / 16px 16px; }
    #stage.black { background: #000; }
    #stage.white { background: #fff; }
    img { image-rendering: pixelated; flex-shrink: 0; }
    #message { padding: 16px; opacity: 0.8; }
    .empty { padding: 16px; opacity: 0.7; }
</style>
</head>
<body>
<div id="list"></div>
<div id="main">
    <div id="toolbar">
        <span id="title"></span>
        <button id="zoom" title="Fit the view, or show the texture at its size">Actual size</button>
        <button id="bg" title="Change the background">Checker</button>
        <button id="export" class="primary">Export PNG</button>
        <button id="exportAll">Export all</button>
    </div>
    <div id="stage" class="checker fit"><div id="message">Loading…</div></div>
</div>
<script nonce="${n}">
    const vscode = acquireVsCodeApi();
    const textures = ${textures};
    const list = document.getElementById('list');
    const stage = document.getElementById('stage');
    const title = document.getElementById('title');
    const backgrounds = ['checker', 'black', 'white'];
    let selected = -1;
    let background = 0;

    function escape(text) {
        return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    if (textures.length === 0) {
        list.innerHTML = '<div class="empty">No textures.</div>';
        stage.innerHTML = '<div id="message">This file has no textures.</div>';
    }

    textures.forEach((t, i) => {
        const item = document.createElement('div');
        item.className = 'item' + (t.problem ? ' unavailable' : '');
        const size = t.width ? t.width + '×' + t.height + ' ' : '';
        item.innerHTML = '<div>' + escape(t.name) + '</div><div class="meta">' + escape(size + t.format) + (t.levels > 1 ? ' · ' + t.levels + ' mips' : '') + '</div>';
        item.title = t.problem || '';
        item.onclick = () => select(i);
        list.appendChild(item);
    });

    function select(i) {
        selected = i;
        list.querySelectorAll('.item').forEach((el, j) => el.classList.toggle('selected', j === i));
        const t = textures[i];
        title.textContent = t.name + (t.width ? '  ' + t.width + '×' + t.height + ' ' + t.format : '');
        document.getElementById('export').disabled = !!t.problem;
        if (t.problem) {
            stage.innerHTML = '<div id="message">' + escape(t.problem) + '</div>';
            return;
        }
        stage.innerHTML = '<div id="message">Decoding…</div>';
        vscode.postMessage({ type: 'select', index: i });
    }

    window.addEventListener('message', event => {
        const m = event.data;
        if (m.index !== selected) return;
        if (m.type === 'image') {
            const t = textures[m.index];
            stage.innerHTML = '';
            const img = document.createElement('img');
            img.src = 'data:image/png;base64,' + m.png;
            img.alt = t.name;
            stage.appendChild(img);
            layout();
        } else if (m.type === 'error') {
            stage.innerHTML = '<div id="message">Couldn\\'t decode this texture: ' + escape(m.message) + '</div>';
        }
    });

    // Fit scales the texture to the view, up as well as down; otherwise it shows at its own size.
    function layout() {
        const img = stage.querySelector('img');
        if (!img || selected < 0) return;
        const t = textures[selected];
        const room = [stage.clientWidth - 32, stage.clientHeight - 32];
        // Before the view has a size there's nothing to fit to; the resize observer lays it out again once it does.
        const scale = stage.classList.contains('fit') && room[0] > 0 && room[1] > 0
            ? Math.min(room[0] / t.width, room[1] / t.height)
            : 1;
        img.style.width = Math.max(1, Math.floor(t.width * scale)) + 'px';
        img.style.height = Math.max(1, Math.floor(t.height * scale)) + 'px';
        // At actual size a texture bigger than the view scrolls from its top-left corner instead of being cut off.
        const overflows = t.width * scale > room[0] || t.height * scale > room[1];
        stage.style.alignItems = stage.style.justifyContent = overflows ? 'flex-start' : 'center';
    }
    new ResizeObserver(layout).observe(stage);

    document.getElementById('zoom').onclick = event => {
        const fit = stage.classList.toggle('fit');
        event.target.textContent = fit ? 'Actual size' : 'Fit';
        layout();
    };
    document.getElementById('bg').onclick = event => {
        stage.classList.remove(backgrounds[background]);
        background = (background + 1) % backgrounds.length;
        stage.classList.add(backgrounds[background]);
        event.target.textContent = backgrounds[background][0].toUpperCase() + backgrounds[background].slice(1);
    };
    document.getElementById('export').onclick = () => { if (selected >= 0) vscode.postMessage({ type: 'export', index: selected }); };
    document.getElementById('exportAll').onclick = () => vscode.postMessage({ type: 'exportAll' });

    const first = textures.findIndex(t => !t.problem);
    if (textures.length > 0) select(first >= 0 ? first : 0);
</script>
</body>
</html>`;
    }
}

function safeName(name: string): string {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'texture';
}

function defaultExportFolder(): vscode.Uri {
    return vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir());
}
