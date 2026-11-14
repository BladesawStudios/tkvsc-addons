import * as vscode from 'vscode';
import type { TkvscApi } from '../tkvscTypes';
import { errorMessage, fileName, nonce, runPluginCommand, type PluginInput } from './pluginHost';

interface FontInfo {
    kind: string;
    lineFeed: number;
    height: number;
    width: number;
    ascent: number;
    encoding: number;
    cellWidth: number;
    cellHeight: number;
    baseline: number;
    maxCharWidth: number;
    sheetWidth: number;
    sheetHeight: number;
    sheetFormat: string;
    sheetCount: number;
    compressed: boolean;
    /** [code, sheet, x, y, left, glyphWidth, advance] */
    glyphs: number[][];
}

class FontDocument implements vscode.CustomDocument {
    readonly sheets = new Map<number, string>();
    info!: FontInfo;

    constructor(readonly uri: vscode.Uri, readonly input: PluginInput) {}

    dispose(): void {
        this.sheets.clear();
    }
}

/** Previews a BRFNT or BRFNA font: text drawn with its glyphs and widths, and its glyph sheets. */
export class FontViewerProvider implements vscode.CustomReadonlyEditorProvider<FontDocument> {
    static readonly viewType = 'tkvsc-sshd.fontViewer';

    static register(context: vscode.ExtensionContext, api: TkvscApi): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(FontViewerProvider.viewType, new FontViewerProvider(api), {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: true,
        });
    }

    private constructor(private readonly api: TkvscApi) {}

    async openCustomDocument(uri: vscode.Uri): Promise<FontDocument> {
        const document = new FontDocument(uri, { name: fileName(uri), data: await this.api.readRawBytes(uri) });
        document.info = await runPluginCommand<FontInfo>(this.api, ['sshd-font'], document.input);
        return document;
    }

    async resolveCustomEditor(document: FontDocument, panel: vscode.WebviewPanel): Promise<void> {
        panel.webview.options = { enableScripts: true };
        panel.webview.html = this.html(panel.webview, document);

        panel.webview.onDidReceiveMessage(async (message: { type: string; sheets?: number[] }) => {
            if (message.type !== 'sheets' || !message.sheets?.length) {
                return;
            }
            try {
                const missing = message.sheets.filter((sheet) => !document.sheets.has(sheet));
                if (missing.length > 0) {
                    const result = await runPluginCommand<{ sheets: Record<string, string> }>(
                        this.api, ['sshd-font', 'sheets', missing.join(',')], document.input);
                    for (const [sheet, png] of Object.entries(result.sheets)) {
                        document.sheets.set(Number(sheet), png);
                    }
                }
                const sheets: Record<number, string> = {};
                for (const sheet of message.sheets) {
                    sheets[sheet] = document.sheets.get(sheet)!;
                }
                await panel.webview.postMessage({ type: 'sheets', sheets });
            } catch (error) {
                await panel.webview.postMessage({ type: 'error', message: errorMessage(error) });
            }
        });
    }

    private html(webview: vscode.Webview, document: FontDocument): string {
        const n = nonce();
        const info = JSON.stringify(document.info).replace(/</g, '\\u003c');
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    body { margin: 0; padding: 12px 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); background: var(--vscode-editor-background); }
    h2 { font-size: 1.1em; margin: 18px 0 8px; }
    #info { display: flex; flex-wrap: wrap; gap: 4px 18px; opacity: 0.85; }
    #info b { font-weight: 600; }
    .controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
    textarea { width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical; font-family: var(--vscode-editor-font-family); color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 6px; }
    select, input[type=number] { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border); padding: 2px 4px; }
    button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 10px; cursor: pointer; border-radius: 2px; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .surface { overflow: auto; max-width: 100%; border: 1px solid var(--vscode-panel-border); }
    .dark { background: #1e1e1e; }
    .light { background: #f3f3f3; }
    .checker { background: repeating-conic-gradient(#808080 0% 25%, #b0b0b0 0% 50%) 0 0 / 16px 16px; }
    canvas { display: block; image-rendering: pixelated; }
    #missing, #glyphInfo, #status { opacity: 0.8; min-height: 1.2em; margin-top: 6px; }
    #sheetWrap { position: relative; display: inline-block; cursor: crosshair; }
</style>
</head>
<body>
<div id="info"></div>

<h2>Preview</h2>
<textarea id="text" spellcheck="false">The quick brown fox jumps over the lazy dog.
0123456789 !?.,;:'"()</textarea>
<div class="controls">
    <label>Scale <select id="scale"><option>1</option><option selected>2</option><option>3</option><option>4</option></select></label>
    <label>Color <input type="color" id="color" value="#ffffff"></label>
    <label>Background <select id="previewBg"><option value="dark">Dark</option><option value="light">Light</option><option value="checker">Checker</option></select></label>
</div>
<div id="previewSurface" class="surface dark"><canvas id="preview" width="1" height="1"></canvas></div>
<div id="missing"></div>

<h2>Glyph sheets</h2>
<div class="controls">
    <button id="prev">◀</button>
    <span>Sheet <input type="number" id="sheet" min="0" value="0" style="width: 4em"> of <span id="sheetCount"></span></span>
    <button id="next">▶</button>
    <label>Background <select id="sheetBg"><option value="dark">Dark</option><option value="light">Light</option><option value="checker">Checker</option></select></label>
</div>
<div id="sheetSurface" class="surface dark"><div id="sheetWrap"><canvas id="sheetCanvas" width="1" height="1"></canvas></div></div>
<div id="glyphInfo">Click a cell to see its character.</div>
<div id="status"></div>

<script nonce="${n}">
    const vscode = acquireVsCodeApi();
    const font = ${info};
    const byCode = new Map(font.glyphs.map(g => [g[0], g]));
    const images = new Map();      // sheet -> HTMLImageElement, once loaded
    const requested = new Set();
    const status = document.getElementById('status');
    let currentSheet = 0;

    document.getElementById('info').innerHTML = [
        ['Kind', font.kind === 'RFNA' ? 'RFNA (archived)' : 'RFNT'],
        ['Glyphs', font.glyphs.length],
        ['Sheets', font.sheetCount + ' × ' + font.sheetWidth + '×' + font.sheetHeight + ' ' + font.sheetFormat + (font.compressed ? ', compressed' : '')],
        ['Cell', font.cellWidth + '×' + font.cellHeight],
        ['Line feed', font.lineFeed],
        ['Ascent', font.ascent],
        ['Baseline', font.baseline],
        ['Height', font.height],
        ['Width', font.width],
        ['Max char width', font.maxCharWidth],
    ].map(([k, v]) => '<span><b>' + k + ':</b> ' + v + '</span>').join('');
    document.getElementById('sheetCount').textContent = font.sheetCount;
    document.getElementById('sheet').max = font.sheetCount - 1;

    function need(sheets) {
        const wanted = [...new Set(sheets)].filter(s => !requested.has(s));
        if (wanted.length === 0) return;
        wanted.forEach(s => requested.add(s));
        status.textContent = 'Loading sheets…';
        vscode.postMessage({ type: 'sheets', sheets: wanted });
    }

    window.addEventListener('message', event => {
        const m = event.data;
        if (m.type === 'error') { status.textContent = 'Error: ' + m.message; return; }
        if (m.type !== 'sheets') return;
        const entries = Object.entries(m.sheets);
        let pending = entries.length;
        for (const [sheet, png] of entries) {
            const img = new Image();
            img.onload = () => {
                images.set(Number(sheet), img);
                if (--pending === 0) { status.textContent = ''; renderPreview(); renderSheet(); }
            };
            img.src = 'data:image/png;base64,' + png;
        }
    });

    function layoutText(text) {
        const lines = text.split('\\n');
        const missing = new Set();
        const placed = [];
        let width = 0;
        lines.forEach((line, row) => {
            let x = 0;
            for (const ch of line) {
                const g = byCode.get(ch.codePointAt(0));
                if (!g) { missing.add(ch); x += Math.ceil(font.cellWidth / 2); continue; }
                placed.push({ g, x: x + g[4], y: row * font.lineFeed });
                x += g[6];
            }
            width = Math.max(width, x);
        });
        return { placed, missing, width: Math.max(width, 1), height: Math.max(lines.length * font.lineFeed, font.cellHeight) };
    }

    function renderPreview() {
        const text = document.getElementById('text').value;
        const scale = Number(document.getElementById('scale').value);
        const color = document.getElementById('color').value;
        const layout = layoutText(text);
        need(layout.placed.map(p => p.g[1]));

        const glyphs = document.createElement('canvas');
        glyphs.width = layout.width;
        glyphs.height = layout.height + font.cellHeight;
        const g = glyphs.getContext('2d');
        for (const p of layout.placed) {
            const img = images.get(p.g[1]);
            if (img && p.g[5] > 0) g.drawImage(img, p.g[2], p.g[3], p.g[5], font.cellHeight, p.x, p.y, p.g[5], font.cellHeight);
        }
        let source = glyphs;
        if (color.toLowerCase() !== '#ffffff') {
            // Tint: multiply the drawn text by the colour, then mask it with the text's own alpha in one pass.
            // (destination-in clears everything outside what it draws, so it can't run glyph by glyph.)
            source = document.createElement('canvas');
            source.width = glyphs.width;
            source.height = glyphs.height;
            const t = source.getContext('2d');
            t.drawImage(glyphs, 0, 0);
            t.globalCompositeOperation = 'multiply';
            t.fillStyle = color;
            t.fillRect(0, 0, source.width, source.height);
            t.globalCompositeOperation = 'destination-in';
            t.drawImage(glyphs, 0, 0);
        }

        const canvas = document.getElementById('preview');
        canvas.width = (glyphs.width + 16) * scale;
        canvas.height = (glyphs.height + 16) * scale;
        const c = canvas.getContext('2d');
        c.imageSmoothingEnabled = false;
        c.drawImage(source, 8 * scale, 8 * scale, glyphs.width * scale, glyphs.height * scale);

        document.getElementById('missing').textContent = layout.missing.size > 0
            ? 'Not in this font: ' + [...layout.missing].map(ch => ch === ' ' ? 'space' : ch).join(' ')
            : '';
    }

    function renderSheet() {
        const img = images.get(currentSheet);
        const canvas = document.getElementById('sheetCanvas');
        if (!img) { need([currentSheet]); return; }
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
    }

    function showSheet(sheet) {
        currentSheet = Math.max(0, Math.min(font.sheetCount - 1, sheet));
        document.getElementById('sheet').value = currentSheet;
        document.getElementById('glyphInfo').textContent = 'Click a cell to see its character.';
        renderSheet();
    }

    document.getElementById('sheetCanvas').addEventListener('click', event => {
        const rect = event.target.getBoundingClientRect();
        const col = Math.floor((event.clientX - rect.left) / (font.cellWidth + 1));
        const row = Math.floor((event.clientY - rect.top) / (font.cellHeight + 1));
        const x = col * (font.cellWidth + 1), y = row * (font.cellHeight + 1);
        const codes = font.glyphs.filter(g => g[1] === currentSheet && g[2] === x && g[3] === y);
        document.getElementById('glyphInfo').textContent = codes.length === 0
            ? 'No character uses cell ' + col + ',' + row + '.'
            : codes.map(g => '"' + String.fromCodePoint(g[0]) + '" U+' + g[0].toString(16).toUpperCase().padStart(4, '0')).join(', ')
              + ' · cell ' + col + ',' + row + ' · left ' + codes[0][4] + ', glyph width ' + codes[0][5] + ', advance ' + codes[0][6];
    });

    function bindBackground(selectId, surfaceId) {
        document.getElementById(selectId).onchange = event => {
            document.getElementById(surfaceId).className = 'surface ' + event.target.value;
        };
    }
    bindBackground('previewBg', 'previewSurface');
    bindBackground('sheetBg', 'sheetSurface');

    document.getElementById('text').addEventListener('input', renderPreview);
    document.getElementById('scale').onchange = renderPreview;
    document.getElementById('color').addEventListener('input', renderPreview);
    document.getElementById('prev').onclick = () => showSheet(currentSheet - 1);
    document.getElementById('next').onclick = () => showSheet(currentSheet + 1);
    document.getElementById('sheet').onchange = event => showSheet(Number(event.target.value) || 0);

    renderPreview();
    showSheet(0);
</script>
</body>
</html>`;
    }
}
