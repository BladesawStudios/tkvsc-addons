// @ts-check
// The Ocarina song editor's webview. The extension owns the songs: every change is sent as an edit and the
// extension answers with the new state (and its warnings), which is all this file renders from.
// Songs are edited on the staff: click to add or change a note, drag to move it, right-click to delete it.
(function () {
    // @ts-ignore acquireVsCodeApi is injected by VS Code.
    const vscode = acquireVsCodeApi();
    const app = /** @type {HTMLElement} */ (document.getElementById('app'));

    /** @type {any} */
    let state = null;
    /** The song the keyboard acts on. */
    let activeId = /** @type {string|null} */ (null);
    /** The selected note: changed by ↑/↓ and ♯, removed by Delete. */
    let selected = /** @type {{song: string, index: number}|null} */ (null);
    let tempo = Number(sessionGet('tempo')) || 120;
    let newIds = 0;
    /** Set when a render waits for an open dropdown to close. */
    let renderDeferred = false;
    /** An element to focus after the next render, by its data-focus key. */
    let pendingFocus = /** @type {string|null} */ (null);
    let pendingScroll = /** @type {string|null} */ (null);

    /** @type {Map<number, any>} */
    let noteByHash = new Map();
    /** @type {Map<number, any>} */
    let typeByHash = new Map();
    /** @type {any[]} */
    let playable = [];
    /** Notes by staff step: `natural` and `sharp` (either may be missing). @type {Map<number, {natural?: any, sharp?: any}>} */
    let byStep = new Map();
    let restHash = 0;

    function sessionGet(key) {
        try {
            return (vscode.getState() || {})[key];
        } catch {
            return undefined;
        }
    }

    function sessionSet(key, value) {
        try {
            vscode.setState({ ...(vscode.getState() || {}), [key]: value });
        } catch {
            // State is a convenience only.
        }
    }

    // ---- helpers ----

    function esc(text) {
        return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function hex(value) {
        return '0x' + (value >>> 0).toString(16).padStart(8, '0');
    }

    function noteLabel(hash) {
        const info = noteByHash.get(hash);
        if (!info) {
            return hex(hash);
        }
        return info.name.replace(/sharp$/, '♯').replace(/^Low(?=.)/, 'Low ').replace(/^High(?=.)/, 'High ');
    }

    /** A shorter label for under the staff. */
    function shortLabel(hash) {
        const info = noteByHash.get(hash);
        if (!info) {
            return '?';
        }
        if (info.step === null) {
            return 'rest';
        }
        return noteLabel(hash);
    }

    function typeLabel(hash) {
        if (hash === null) {
            return "Zelda's Lullaby";
        }
        return typeByHash.get(hash)?.label ?? hex(hash);
    }

    function readonly() {
        return !!(state && (state.readonlyReason || state.error));
    }

    function songById(id) {
        return state.songs.find((s) => s.id === id);
    }

    function newId() {
        return `n${Date.now().toString(36)}${(newIds++).toString(36)}`;
    }

    /** The note at a staff step: the sharp one if asked for and it exists, otherwise the natural one. */
    function noteAt(step, sharp) {
        const at = byStep.get(step);
        if (!at) return undefined;
        return (sharp && at.sharp) || at.natural || at.sharp;
    }

    /** Sends a change. `mutate` gets a copy of the songs to change in place. */
    function edit(label, mutate) {
        if (readonly()) {
            return;
        }
        const songs = JSON.parse(JSON.stringify(state.songs));
        mutate(songs);
        vscode.postMessage({ type: 'edit', label, songs });
    }

    let toastTimer = 0;
    function toast(text) {
        let el = document.querySelector('.toast');
        if (!el) {
            el = document.createElement('div');
            el.className = 'toast';
            document.body.appendChild(el);
        }
        el.textContent = text;
        clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => el && el.remove(), 5000);
    }

    // ---- staff geometry ----
    // Treble staff: E4 (step 0) is the bottom line, F5 (step 8) the top. Notes go from Low B (-3) to High F (8).

    const MIN_STEP = -3;
    const MAX_STEP = 8;
    const HALF = 7;
    const TOP = 18;
    const GUTTER = 58;
    const COL = 46;
    const LABEL_GAP = 26;

    const stepY = (step) => TOP + (MAX_STEP + 1 - step) * HALF;
    const staffHeight = () => stepY(MIN_STEP - 1) + LABEL_GAP + 8;
    const colX = (i) => GUTTER + COL * i + COL / 2;

    /** Where on a song's staff a pointer is: column (0..notes, the last one adds) and snapped step. */
    function staffPoint(svg, event, count) {
        const box = svg.getBoundingClientRect();
        const scale = box.width / svg.viewBox.baseVal.width || 1;
        const x = (event.clientX - box.left) / scale;
        const y = (event.clientY - box.top) / scale;
        const column = Math.max(0, Math.min(count, Math.floor((x - GUTTER) / COL)));
        const step = Math.max(MIN_STEP, Math.min(MAX_STEP, Math.round((TOP + (MAX_STEP + 1) * HALF - y) / HALF)));
        return { column, step, inside: x >= GUTTER - 4 };
    }

    // ---- rendering ----

    function render() {
        if (!state) {
            return;
        }
        // Replacing the page closes an open dropdown, so wait until it loses focus.
        if (document.activeElement instanceof HTMLSelectElement && app.contains(document.activeElement)) {
            renderDeferred = true;
            return;
        }
        renderDeferred = false;
        const focusKey = (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focus : undefined) ?? pendingFocus;
        pendingFocus = null;
        const scroll = window.scrollY;
        const ro = readonly();
        const songs = state.songs;
        const errors = state.warnings.filter((w) => w.level === 'error').length;
        const warns = state.warnings.filter((w) => w.level === 'warning').length;

        let html = `
<header class="top">
  <h1>Ocarina Songs</h1>
  <span class="file">${esc(state.fileName)}</span>
  <span class="spacer"></span>
  <label class="tempo" title="Playback speed">Tempo
    <input type="range" min="60" max="240" step="5" value="${tempo}" data-act="tempo" data-focus="tempo">
    <output>${tempo} BPM</output>
  </label>
  <button data-act="add-song" data-focus="add-song" ${ro ? 'disabled' : ''}>Add song</button>
  <button class="secondary" data-act="open-text" data-focus="open-text" title="Reopen this file in the text editor">Edit as text</button>
</header>`;

        if (state.error) {
            html += `<div class="banner error"><strong>The file could not be read.</strong> ${esc(state.error)}</div>`;
        }
        if (state.readonlyReason) {
            html += `<div class="banner readonly">${esc(state.readonlyReason)}</div>`;
        }
        if (state.notice) {
            html += `<div class="banner">${esc(state.notice)}</div>`;
        }

        const totalNotes = songs.reduce((n, s) => n + s.notes.length, 0);
        html += `<div class="summary"><span>${songs.length} song${songs.length === 1 ? '' : 's'}</span><span>${totalNotes} notes</span>`;
        html += `<span>${errors ? `${errors} problem${errors === 1 ? '' : 's'}, ` : ''}${warns} warning${warns === 1 ? '' : 's'}</span>`;
        if (state.rootFields.length) {
            html += `<span>Also keeps: ${state.rootFields.map(esc).join(', ')}</span>`;
        }
        html += '</div>';

        if (state.warnings.length) {
            html += '<ul class="warnings">';
            for (const w of state.warnings) {
                html += `<li data-act="goto" data-song="${esc(w.songs[0] ?? '')}"><span class="badge ${w.level}">${w.level}</span><span>${esc(w.text)}</span></li>`;
            }
            html += '</ul>';
        }

        html += '<main class="songs">';
        songs.forEach((song, i) => {
            html += renderSong(song, i, ro);
        });
        html += '</main>';
        if (songs.length > 2 && !ro) {
            html += '<div class="add-song-row"><button class="secondary" data-act="add-song" data-focus="add-song-bottom">Add song</button></div>';
        }

        app.innerHTML = html;
        window.scrollTo(0, scroll);
        if (focusKey) {
            const el = app.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
            if (el instanceof HTMLElement) {
                el.focus({ preventScroll: true });
            }
        }
    }

    function renderSong(song, index, ro) {
        const mine = state.warnings.filter((w) => w.songs.includes(song.id));
        const cls = ['song'];
        if (song.id === activeId) cls.push('active');
        if (mine.some((w) => w.level === 'error')) cls.push('has-error');
        else if (mine.some((w) => w.level === 'warning')) cls.push('has-warning');

        const known = typeByHash.has(song.melodyType);
        let options = `<option value="" ${song.melodyType === null ? 'selected' : ''}>(none) Zelda's Lullaby</option>`;
        for (const t of state.melodyTypes) {
            options += `<option value="${t.hash}" ${t.hash === song.melodyType ? 'selected' : ''}>${esc(t.label)}</option>`;
        }
        if (song.melodyType !== null && !known) {
            options += `<option value="${song.melodyType}" selected>${hex(song.melodyType)} (unrecognised)</option>`;
        }

        const recName = song.melodyType === null ? 'ZeldaLullaby' : typeByHash.get(song.melodyType)?.name;
        const canRecord = recName && recName !== 'ScarecrowSong';
        const playing = player.songId === song.id;
        const sel = selected && selected.song === song.id ? selected.index : -1;
        const selInfo = sel >= 0 ? noteByHash.get(song.notes[sel]) : undefined;
        const canSharp = !!(selInfo && selInfo.step !== null && byStep.get(selInfo.step)?.sharp && byStep.get(selInfo.step)?.natural);
        const sid = esc(song.id);

        let html = `<article class="${cls.join(' ')}" data-song="${sid}">
  <div class="song-head">
    <span class="grip" draggable="${!ro}" data-drag="song" title="Drag to reorder">⠿</span>
    <span class="num">${index + 1}</span>
    <select data-act="type" data-focus="type-${sid}" ${ro ? 'disabled' : ''} title="Which song these notes play (MelodyType)">${options}</select>
    <span class="count">${song.notes.length} note${song.notes.length === 1 ? '' : 's'}</span>
    <span class="spacer"></span>
    <span class="tools">
      <button class="icon" data-act="sharp" data-focus="sharp-${sid}" title="Sharp the selected note (#)" ${ro || !canSharp ? 'disabled' : ''}>♯</button>
      <button class="icon" data-act="rest" data-focus="rest-${sid}" title="${sel >= 0 ? 'Replace the selected note with a rest' : 'Add a rest'} (R)" ${ro ? 'disabled' : ''}>Rest</button>
      <button class="icon" data-act="clear" data-focus="clear-${sid}" title="Remove all notes" ${ro || !song.notes.length ? 'disabled' : ''}>Clear</button>
    </span>
    <span class="sep"></span>
    <button class="icon" data-act="play" data-focus="play-${sid}" title="${playing ? 'Stop' : 'Play these notes'}" ${song.notes.length ? '' : 'disabled'}>${playing ? '■' : '▶'}</button>
    <button class="icon" data-act="record" data-focus="rec-${sid}" title="Play the game's recording of ${esc(typeLabel(song.melodyType))}" ${canRecord ? '' : 'disabled'}>♫</button>
    <button class="icon" data-act="up" data-focus="up-${sid}" title="Move up" ${ro || index === 0 ? 'disabled' : ''}>↑</button>
    <button class="icon" data-act="down" data-focus="down-${sid}" title="Move down" ${ro || index === state.songs.length - 1 ? 'disabled' : ''}>↓</button>
    <button class="icon" data-act="duplicate" data-focus="dup-${sid}" title="Duplicate" ${ro ? 'disabled' : ''}>⧉</button>
    <button class="icon" data-act="delete-song" data-focus="del-${sid}" title="Delete song" ${ro ? 'disabled' : ''}>✕</button>
  </div>
  <div class="staff-scroll">${renderStaff(song, ro)}</div>`;

        if (!ro && song.id === activeId) {
            html += `<div class="hint">Click the staff to add a note at the end or change a note · drag a note to move it · right-click deletes · hold Shift for ♯ · keys: 1–${playable.length} add ${playable.map((n) => noteLabel(n.hash)).join(', ')}, ←/→ select, ↑/↓ pitch, Alt+←/→ move, R rest, Delete</div>`;
        }

        html += `<div class="fields">
    <label title="Optional. Left out of the file when empty.">NoteNumForNavi
      <input type="number" step="1" data-act="field" data-field="noteNumForNavi" data-focus="navi-${sid}" placeholder="(none)" value="${song.noteNumForNavi ?? ''}" ${ro ? 'disabled' : ''}></label>
    <label title="Optional. Left out of the file when empty.">RestToRepeatExample
      <input type="number" step="1" data-act="field" data-field="restToRepeatExample" data-focus="restrep-${sid}" placeholder="(none)" value="${song.restToRepeatExample ?? ''}" ${ro ? 'disabled' : ''}></label>
  </div>`;

        if (mine.length) {
            html += '<ul class="song-warnings">';
            for (const w of mine) {
                html += `<li><span class="badge ${w.level}">${w.level}</span><span>${esc(w.text)}</span></li>`;
            }
            html += '</ul>';
        }
        const hidden = state.hidden[song.id] || [];
        if (hidden.length) {
            html += `<div class="hidden-fields">Also keeps: ${hidden.map(esc).join(', ')}</div>`;
        }
        return html + '</article>';
    }

    /** The note head (with ledger lines, stem and sharp) or rest drawn for one note. */
    function noteGlyph(hash, x, extraClass, index) {
        const info = noteByHash.get(hash);
        const at = index === undefined ? '' : ` data-index="${index}"`;
        if (!info) {
            return `<text class="head unknown ${extraClass}" x="${x}" y="${stepY(4) + 5}" text-anchor="middle"${at}>?</text>`;
        }
        if (info.step === null) {
            return `<path class="rest ${extraClass}"${at} d="M${x - 3} ${stepY(6)} l6 7 l-5 5 l6 8 c-5 -3 -8 0 -4 5 c-7 -3 -6 -10 0 -8 l-6 -7 l5 -5 z"/>`;
        }
        const y = stepY(info.step);
        const kind = `${info.playable ? 'playable' : 'unplayable'} ${extraClass}`;
        let svg = '';
        for (let s = -2; s >= info.step; s -= 2) {
            svg += `<line class="ledger" x1="${x - 11}" x2="${x + 11}" y1="${stepY(s)}" y2="${stepY(s)}"/>`;
        }
        if (info.step >= 10) {
            for (let s = 10; s <= info.step; s += 2) {
                svg += `<line class="ledger" x1="${x - 11}" x2="${x + 11}" y1="${stepY(s)}" y2="${stepY(s)}"/>`;
            }
        }
        svg += info.step < 4
            ? `<line class="stem ${kind}" x1="${x + 6.3}" x2="${x + 6.3}" y1="${y - 1}" y2="${y - 30}"/>`
            : `<line class="stem ${kind}" x1="${x - 6.3}" x2="${x - 6.3}" y1="${y + 1}" y2="${y + 30}"/>`;
        svg += `<ellipse class="head ${kind}" cx="${x}" cy="${y}" rx="7" ry="5" transform="rotate(-20 ${x} ${y})"${at}/>`;
        if (info.sharp) {
            svg += `<text class="accidental ${kind}" x="${x - 11}" y="${y + 5}" text-anchor="end">♯</text>`;
        }
        return svg;
    }

    function renderStaff(song, ro) {
        const count = song.notes.length;
        const columns = ro ? Math.max(count, 1) : count + 1;
        // Read-only staves end after the last note; editable ones leave room for the ghost note's label.
        const width = Math.max(320, GUTTER + COL * columns + (ro ? 12 : 140));
        const height = staffHeight();
        const sel = selected && selected.song === song.id ? selected.index : -1;
        let svg = `<svg class="staff${ro ? ' readonly' : ''}" data-staff width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

        // The five pitches the buttons play get a band and a label.
        playable.forEach((n, i) => {
            const y = stepY(n.step);
            svg += `<rect class="band" x="${GUTTER - 6}" y="${y - HALF / 2 - 1}" width="${width - GUTTER}" height="${HALF + 2}"/>`;
            svg += `<text class="row-label" x="${i % 2 ? GUTTER - 10 : GUTTER - 30}" y="${y + 4}" text-anchor="end">${esc(noteLabel(n.hash).replace('High ', 'Hi '))}</text>`;
        });
        for (let s = 0; s <= 8; s += 2) {
            svg += `<line class="line" x1="${GUTTER - 6}" x2="${width - 6}" y1="${stepY(s)}" y2="${stepY(s)}"/>`;
        }
        svg += `<line class="line" x1="${GUTTER - 6}" x2="${GUTTER - 6}" y1="${stepY(8)}" y2="${stepY(0)}"/>`;

        for (let i = 0; i < count; i++) {
            const x = colX(i);
            const classes = [];
            if (i === sel) classes.push('selected');
            if (player.songId === song.id && player.index === i) classes.push('playing');
            if (i === sel) {
                svg += `<rect class="sel" x="${x - COL / 2 + 3}" y="4" width="${COL - 6}" height="${height - 8}" rx="4"/>`;
            }
            svg += `<g class="note" data-index="${i}">${noteGlyph(song.notes[i], x, classes.join(' '), i)}</g>`;
            const info = noteByHash.get(song.notes[i]);
            const kind = !info ? 'unknown' : info.playable ? 'playable' : 'unplayable';
            svg += `<text class="name ${kind}" x="${x}" y="${height - 10}" text-anchor="middle">${esc(shortLabel(song.notes[i]))}</text>`;
        }
        if (!ro) {
            svg += `<rect class="add-col" x="${colX(count) - COL / 2 + 3}" y="4" width="${COL - 6}" height="${height - 8}" rx="4"/>`;
            if (!count) {
                svg += `<text class="empty-hint" x="${colX(0) + COL / 2 - 4}" y="${stepY(4) + 4}">Click the staff to add the first note</text>`;
            }
            svg += '<g class="ghost"></g>';
        }
        return svg + '</svg>';
    }

    // ---- editing actions ----

    function songOf(el) {
        const card = el.closest('[data-song]');
        return card ? card.getAttribute('data-song') : null;
    }

    function selectNote(songId, index) {
        selected = index === null ? null : { song: songId, index };
        render();
    }

    /** Puts a note at a column: replaces the note there, or adds one when the column is past the end. */
    function placeNote(songId, column, hash) {
        const song = songById(songId);
        if (!song || hash === undefined) return;
        preview(hash);
        if (column < song.notes.length) {
            if (song.notes[column] === hash) {
                selectNote(songId, selected && selected.song === songId && selected.index === column ? null : column);
                return;
            }
            edit('Change note', (songs) => {
                songs.find((s) => s.id === songId).notes[column] = hash;
            });
            selected = { song: songId, index: column };
        } else {
            edit('Add note', (songs) => {
                songs.find((s) => s.id === songId).notes.push(hash);
            });
            selected = null;
        }
    }

    function removeNote(songId, index) {
        const left = songById(songId).notes.length - 1;
        edit('Remove note', (songs) => {
            songs.find((s) => s.id === songId).notes.splice(index, 1);
        });
        if (selected && selected.song === songId) {
            if (left === 0) {
                selected = null;
            } else if (selected.index === index) {
                selected = { song: songId, index: Math.min(index, left - 1) };
            } else if (selected.index > index) {
                selected = { song: songId, index: selected.index - 1 };
            }
        }
    }

    /** Moves a note to another place, optionally changing it on the way (a drag to another pitch). */
    function moveNote(songId, from, to, hash) {
        edit('Move note', (songs) => {
            const notes = songs.find((s) => s.id === songId).notes;
            const [old] = notes.splice(from, 1);
            notes.splice(to, 0, hash === undefined ? old : hash);
        });
        selected = { song: songId, index: to };
    }

    function moveSong(id, toIndex) {
        edit('Move song', (songs) => {
            const from = songs.findIndex((s) => s.id === id);
            const [song] = songs.splice(from, 1);
            songs.splice(from < toIndex ? toIndex - 1 : toIndex, 0, song);
        });
    }

    /** The selected note moved by diatonic steps, keeping its sharp where the new pitch has one. */
    function shiftPitch(songId, index, by) {
        const song = songById(songId);
        const info = noteByHash.get(song.notes[index]);
        if (!info || info.step === null) return;
        const step = Math.max(MIN_STEP, Math.min(MAX_STEP, info.step + by));
        const next = noteAt(step, info.sharp);
        if (next && next.hash !== song.notes[index]) {
            placeNote(songId, index, next.hash);
        }
    }

    function toggleSharp(songId, index) {
        const song = songById(songId);
        const info = noteByHash.get(song.notes[index]);
        const at = info && info.step !== null ? byStep.get(info.step) : undefined;
        if (!at || !at.natural || !at.sharp) return;
        placeNote(songId, index, info.sharp ? at.natural.hash : at.sharp.hash);
    }

    function addRest(songId) {
        const sel = selected && selected.song === songId ? selected.index : -1;
        if (sel >= 0) {
            placeNote(songId, sel, restHash);
        } else {
            placeNote(songId, songById(songId).notes.length, restHash);
        }
    }

    function usedTypes() {
        return new Set(state.songs.map((s) => s.melodyType));
    }

    // ---- staff pointer handling ----

    /** @type {null | {song: string, svg: SVGSVGElement, from: number, hash: number, startX: number, startY: number, moved: boolean, pointerId: number}} */
    let press = null;

    function ghostFor(svg, songId, point, event, dragFrom) {
        const ghost = svg.querySelector('.ghost');
        if (!ghost) return;
        const song = songById(songId);
        if (!song || !point.inside) {
            ghost.innerHTML = '';
            svg.style.cursor = '';
            return;
        }
        const count = song.notes.length;
        const dragging = dragFrom !== undefined;
        const column = dragging ? Math.min(point.column, count - 1) : point.column;
        const current = dragging ? song.notes[dragFrom] : song.notes[column];
        const currentInfo = noteByHash.get(current);
        // A rest or unrecognised note keeps its value when dragged: only its place changes.
        const keepsValue = dragging && (!currentInfo || currentInfo.step === null);
        const note = keepsValue ? undefined : noteAt(point.step, event.shiftKey || (dragging && currentInfo?.sharp));
        const hash = keepsValue ? current : note?.hash;
        if (hash === undefined) {
            ghost.innerHTML = '';
            return;
        }
        const onSame = !dragging && column < count && current === hash;
        svg.style.cursor = onSame ? 'pointer' : 'crosshair';
        if (onSame) {
            ghost.innerHTML = '';
            return;
        }
        const x = colX(column);
        const verb = dragging ? 'Move' : column < count ? 'Change to' : 'Add';
        const label = `${verb} ${noteLabel(hash)}${noteByHash.get(hash)?.playable === false ? ' (unplayable)' : ''}`;
        const labelY = Math.max(12, (noteByHash.get(hash)?.step != null ? stepY(noteByHash.get(hash).step) : stepY(6)) - 16);
        ghost.innerHTML = noteGlyph(hash, x, 'ghosted') +
            `<text class="ghost-label" x="${x + 14}" y="${labelY}">${esc(label)}</text>`;
    }

    app.addEventListener('pointermove', (event) => {
        const svg = /** @type {Element} */ (event.target).closest?.('svg[data-staff]');
        if (press) {
            const p = staffPoint(press.svg, event, songById(press.song).notes.length);
            if (!press.moved && Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 4) {
                press.moved = true;
                press.svg.querySelector(`.note[data-index="${press.from}"]`)?.classList.add('lifted');
            }
            if (press.moved) {
                ghostFor(press.svg, press.song, p, event, press.from);
            }
            return;
        }
        if (!(svg instanceof SVGSVGElement) || readonly()) return;
        const songId = songOf(svg);
        if (!songId) return;
        ghostFor(svg, songId, staffPoint(svg, event, songById(songId).notes.length), event);
    });

    app.addEventListener('pointerleave', (event) => {
        if (event.target instanceof SVGSVGElement) {
            const ghost = event.target.querySelector('.ghost');
            if (ghost && !press) ghost.innerHTML = '';
        }
    }, true);

    app.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || readonly()) return;
        const svg = /** @type {Element} */ (event.target).closest?.('svg[data-staff]');
        if (!(svg instanceof SVGSVGElement)) return;
        const songId = songOf(svg);
        if (!songId) return;
        const song = songById(songId);
        const p = staffPoint(svg, event, song.notes.length);
        if (!p.inside) return;
        event.preventDefault();
        // So the keyboard shortcuts reach the staff rather than a field that had focus.
        if (document.activeElement instanceof HTMLElement && app.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        activeId = songId;
        const onNote = /** @type {Element} */ (event.target).closest('.note');
        if (onNote) {
            const from = Number(onNote.getAttribute('data-index'));
            press = { song: songId, svg, from, hash: song.notes[from], startX: event.clientX, startY: event.clientY, moved: false, pointerId: event.pointerId };
            svg.setPointerCapture(event.pointerId);
            return;
        }
        const hash = noteAt(p.step, event.shiftKey)?.hash;
        placeNote(songId, p.column, hash);
    });

    app.addEventListener('pointerup', (event) => {
        if (!press) return;
        const { song: songId, svg, from, moved } = press;
        press = null;
        try {
            svg.releasePointerCapture(event.pointerId);
        } catch {
            // Already released.
        }
        const song = songById(songId);
        if (!moved) {
            preview(song.notes[from]);
            selectNote(songId, selected && selected.song === songId && selected.index === from ? null : from);
            return;
        }
        const p = staffPoint(svg, event, song.notes.length);
        const to = Math.min(p.column, song.notes.length - 1);
        const info = noteByHash.get(song.notes[from]);
        const keepsValue = !info || info.step === null;
        const hash = keepsValue ? song.notes[from] : noteAt(p.step, event.shiftKey || info.sharp)?.hash;
        if (hash === undefined || (to === from && hash === song.notes[from])) {
            render();
            return;
        }
        if (hash !== song.notes[from]) preview(hash);
        moveNote(songId, from, to, hash);
    });

    app.addEventListener('pointercancel', () => {
        if (press) {
            press = null;
            render();
        }
    });

    app.addEventListener('contextmenu', (event) => {
        const note = /** @type {Element} */ (event.target).closest?.('svg[data-staff] .note');
        if (!note || readonly()) return;
        event.preventDefault();
        const songId = songOf(note);
        if (songId) {
            activeId = songId;
            removeNote(songId, Number(note.getAttribute('data-index')));
        }
    });

    // ---- clicks ----

    app.addEventListener('click', (event) => {
        const target = /** @type {HTMLElement} */ (event.target);
        if (target.closest('svg[data-staff]')) {
            return;
        }
        const actEl = /** @type {HTMLElement|null} */ (target.closest('[data-act]'));
        const songId = songOf(target);
        if (songId && songId !== activeId && !readonly() && !(actEl && ['delete-song', 'up', 'down'].includes(actEl.dataset.act || ''))) {
            activeId = songId;
        }
        if (!actEl) {
            if (songId) render();
            return;
        }
        const act = actEl.dataset.act;
        switch (act) {
            case 'add-song': {
                const id = newId();
                const used = usedTypes();
                const free = state.melodyTypes.find((t) => !used.has(t.hash) && t.name !== 'ScarecrowSong' && t.name !== 'ZeldaLullaby');
                edit('Add song', (songs) => {
                    songs.push({ id, notes: [], melodyType: free ? free.hash : null, noteNumForNavi: null, restToRepeatExample: null });
                });
                activeId = id;
                selected = null;
                pendingScroll = id;
                break;
            }
            case 'open-text':
                vscode.postMessage({ type: 'open-text' });
                break;
            case 'goto':
                if (actEl.dataset.song) {
                    scrollToSong(actEl.dataset.song);
                }
                break;
            case 'play':
                if (songId) togglePlay(songId);
                break;
            case 'record':
                if (songId) playRecording(songId);
                break;
            case 'sharp':
                if (songId && selected && selected.song === songId) toggleSharp(songId, selected.index);
                break;
            case 'rest':
                if (songId) addRest(songId);
                break;
            case 'clear':
                if (songId) {
                    edit('Clear notes', (songs) => {
                        songs.find((s) => s.id === songId).notes = [];
                    });
                    selected = null;
                }
                break;
            case 'up':
            case 'down': {
                const index = state.songs.findIndex((s) => s.id === songId);
                moveSong(songId, act === 'up' ? index - 1 : index + 2);
                break;
            }
            case 'duplicate': {
                const id = newId();
                edit('Duplicate song', (songs) => {
                    const at = songs.findIndex((s) => s.id === songId);
                    songs.splice(at + 1, 0, { ...songs[at], id, copyOf: songId });
                });
                activeId = id;
                pendingScroll = id;
                break;
            }
            case 'delete-song': {
                const song = songById(songId);
                edit(`Delete song ${typeLabel(song.melodyType)}`, (songs) => {
                    songs.splice(songs.findIndex((s) => s.id === songId), 1);
                });
                if (activeId === songId) activeId = null;
                if (selected && selected.song === songId) selected = null;
                break;
            }
            default:
                // Form controls handle their own change; rebuilding the page now would undo the click.
                if (songId && !actEl.matches('select, input')) render();
        }
    });

    app.addEventListener('focusout', (event) => {
        if (event.target instanceof HTMLSelectElement && renderDeferred) {
            setTimeout(render, 0);
        }
    });

    app.addEventListener('change', (event) => {
        const el = /** @type {HTMLInputElement|HTMLSelectElement} */ (event.target);
        const songId = songOf(el);
        if (el.dataset.act === 'type' && songId) {
            const value = el.value === '' ? null : Number(el.value) >>> 0;
            // Lets the new state render straight away; render() puts focus back on it.
            pendingFocus = el.dataset.focus || null;
            el.blur();
            edit('Change MelodyType', (songs) => {
                songs.find((s) => s.id === songId).melodyType = value;
            });
        } else if (el.dataset.act === 'field' && songId) {
            const field = el.dataset.field;
            const text = el.value.trim();
            const value = text === '' ? null : Number(text);
            if (value !== null && !Number.isInteger(value)) {
                toast('Enter a whole number, or leave it empty to leave the field out.');
                render();
                return;
            }
            edit(`Change ${field}`, (songs) => {
                songs.find((s) => s.id === songId)[field] = value;
            });
        }
    });

    app.addEventListener('input', (event) => {
        const el = /** @type {HTMLInputElement} */ (event.target);
        if (el.dataset.act === 'tempo') {
            tempo = Number(el.value);
            sessionSet('tempo', tempo);
            const out = el.parentElement && el.parentElement.querySelector('output');
            if (out) out.textContent = `${tempo} BPM`;
        }
    });

    document.addEventListener('keydown', (event) => {
        const target = /** @type {HTMLElement} */ (event.target);
        if (!state || readonly() || !activeId || target.matches('input, select, textarea')) {
            return;
        }
        const song = songById(activeId);
        if (!song) return;
        const n = song.notes.length;
        const sel = selected && selected.song === activeId ? selected.index : -1;
        const plain = !event.ctrlKey && !event.metaKey;
        if (/^[1-9]$/.test(event.key) && plain && !event.altKey) {
            const note = playable[Number(event.key) - 1];
            if (note) {
                event.preventDefault();
                placeNote(activeId, sel >= 0 ? sel : n, note.hash);
            }
        } else if ((event.key === 'r' || event.key === 'R') && plain && !event.altKey) {
            event.preventDefault();
            addRest(activeId);
        } else if (event.key === '#' && plain && sel >= 0) {
            event.preventDefault();
            toggleSharp(activeId, sel);
        } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && plain && sel >= 0) {
            event.preventDefault();
            shiftPitch(activeId, sel, event.key === 'ArrowUp' ? 1 : -1);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
            if (n === 0) return;
            event.preventDefault();
            removeNote(activeId, sel >= 0 ? sel : n - 1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            if (n === 0) return;
            event.preventDefault();
            const dir = event.key === 'ArrowLeft' ? -1 : 1;
            const cur = sel >= 0 ? sel : (dir < 0 ? n : -1);
            const next = Math.max(0, Math.min(n - 1, cur + dir));
            if (event.altKey && sel >= 0 && next !== cur) {
                moveNote(activeId, cur, next);
            } else {
                selected = { song: activeId, index: next };
                preview(song.notes[next]);
                render();
            }
        } else if (event.key === 'Escape') {
            selected = null;
            render();
        }
    });

    // ---- dragging songs by their grip ----

    let draggingSong = /** @type {string|null} */ (null);

    function clearDropMarks() {
        app.querySelectorAll('.drop-before').forEach((el) => el.classList.remove('drop-before'));
    }

    app.addEventListener('dragstart', (event) => {
        const el = /** @type {HTMLElement} */ (event.target);
        const songId = songOf(el);
        if (!songId || readonly() || el.dataset.drag !== 'song') return;
        draggingSong = songId;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', '');
        }
    });

    app.addEventListener('dragover', (event) => {
        if (!draggingSong) return;
        const card = /** @type {HTMLElement} */ (event.target).closest('.song');
        clearDropMarks();
        if (!card) return;
        card.classList.add('drop-before');
        event.preventDefault();
    });

    app.addEventListener('drop', (event) => {
        if (!draggingSong) return;
        event.preventDefault();
        const songId = songOf(/** @type {HTMLElement} */ (event.target));
        const from = state.songs.findIndex((s) => s.id === draggingSong);
        const id = draggingSong;
        draggingSong = null;
        clearDropMarks();
        if (!songId) return;
        const to = state.songs.findIndex((s) => s.id === songId);
        if (to !== from && to !== from + 1) moveSong(id, to);
    });

    app.addEventListener('dragend', () => {
        draggingSong = null;
        clearDropMarks();
    });

    // ---- audio ----

    /** @type {AudioContext|null} */
    let audio = null;
    /** @type {Map<string, Promise<AudioBuffer>>} */
    const buffers = new Map();
    /** @type {Map<string, {resolve: (b: ArrayBuffer) => void, reject: (e: Error) => void}>} */
    const waiting = new Map();
    const player = { songId: /** @type {string|null} */ (null), index: -1, sources: /** @type {AudioScheduledSourceNode[]} */ ([]), timers: /** @type {number[]} */ ([]) };

    function context() {
        if (!audio) {
            audio = new AudioContext();
        }
        if (audio.state === 'suspended') {
            void audio.resume();
        }
        return audio;
    }

    function load(name) {
        let buffer = buffers.get(name);
        if (!buffer) {
            buffer = new Promise((resolve, reject) => {
                waiting.set(name, { resolve, reject });
                vscode.postMessage({ type: 'need-audio', names: [name] });
            }).then((bytes) => context().decodeAudioData(/** @type {ArrayBuffer} */ (bytes)));
            buffer.catch(() => buffers.delete(name));
            buffers.set(name, buffer);
        }
        return buffer;
    }

    function onAudio(message) {
        const wait = waiting.get(message.name);
        if (!wait) return;
        waiting.delete(message.name);
        if (message.error || !message.data) {
            wait.reject(new Error(message.error || 'No audio.'));
            return;
        }
        const raw = atob(message.data);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        wait.resolve(bytes.buffer);
    }

    /** Moves the playing highlight without rebuilding the page. */
    function markPlaying() {
        app.querySelectorAll('.playing').forEach((el) => el.classList.remove('playing'));
        if (!player.songId || player.index < 0) return;
        const card = app.querySelector(`.song[data-song="${CSS.escape(player.songId)}"]`);
        card?.querySelectorAll(`.staff [data-index="${player.index}"]`).forEach((el) => el.classList.add('playing'));
    }

    function stop() {
        for (const s of player.sources) {
            try {
                s.stop();
            } catch {
                // Already stopped.
            }
        }
        player.timers.forEach((t) => clearTimeout(t));
        player.sources = [];
        player.timers = [];
        const was = player.songId;
        player.songId = null;
        player.index = -1;
        if (was) render();
    }

    /** One note, for `length` seconds from `when`, with a short fade so a cut tone doesn't click. */
    function scheduleNote(buffer, when, length) {
        const ctx = context();
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer = buffer;
        src.connect(gain).connect(ctx.destination);
        const fade = Math.min(0.08, length / 4);
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(1, when + 0.012);
        gain.gain.setValueAtTime(1, when + length - fade);
        gain.gain.linearRampToValueAtTime(0, when + length);
        src.start(when);
        src.stop(when + length + 0.01);
        return src;
    }

    async function preview(hash) {
        const info = noteByHash.get(hash);
        if (!info || info.step === null || player.songId) return;
        try {
            const buffer = await load(info.name);
            scheduleNote(buffer, context().currentTime + 0.01, 60 / tempo);
        } catch (e) {
            toast(String(e instanceof Error ? e.message : e));
        }
    }

    async function togglePlay(songId) {
        if (player.songId === songId) {
            stop();
            return;
        }
        stop();
        const song = songById(songId);
        if (!song || !song.notes.length) return;
        const names = [...new Set(song.notes.map((h) => noteByHash.get(h)).filter((n) => n && n.step !== null).map((n) => n.name))];
        player.songId = songId;
        render();
        try {
            const loaded = new Map(await Promise.all(names.map(async (n) => [n, await load(n)])));
            if (player.songId !== songId) return;
            const ctx = context();
            const beat = 60 / tempo;
            const start = ctx.currentTime + 0.05;
            song.notes.forEach((hash, i) => {
                const info = noteByHash.get(hash);
                const buffer = info && loaded.get(info.name);
                if (buffer) {
                    player.sources.push(scheduleNote(buffer, start + i * beat, beat * 0.95));
                }
                player.timers.push(window.setTimeout(() => {
                    player.index = i;
                    markPlaying();
                }, (start - ctx.currentTime + i * beat) * 1000));
            });
            player.timers.push(window.setTimeout(stop, (start - ctx.currentTime + song.notes.length * beat) * 1000 + 50));
        } catch (e) {
            stop();
            toast(String(e instanceof Error ? e.message : e));
        }
    }

    async function playRecording(songId) {
        stop();
        const song = songById(songId);
        const name = song.melodyType === null ? 'ZeldaLullaby' : typeByHash.get(song.melodyType)?.name;
        if (!name) return;
        player.songId = songId;
        player.index = -1;
        render();
        try {
            const buffer = await load(name);
            if (player.songId !== songId) return;
            const ctx = context();
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(ctx.destination);
            src.onended = () => {
                if (player.sources.includes(src)) stop();
            };
            src.start();
            player.sources.push(src);
        } catch (e) {
            stop();
            toast(String(e instanceof Error ? e.message : e));
        }
    }

    // ---- messages ----

    function scrollToSong(id) {
        const card = app.querySelector(`.song[data-song="${CSS.escape(id)}"]`);
        if (card) {
            card.scrollIntoView({ block: 'center', behavior: 'smooth' });
            card.classList.remove('flash');
            void (/** @type {HTMLElement} */ (card)).offsetWidth;
            card.classList.add('flash');
        }
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'audio') {
            onAudio(message);
            return;
        }
        if (message.type !== 'state') return;
        state = message;
        noteByHash = new Map(state.notes.map((n) => [n.hash, n]));
        typeByHash = new Map(state.melodyTypes.map((t) => [t.hash, t]));
        playable = state.notes.filter((n) => n.playable);
        byStep = new Map();
        for (const n of state.notes) {
            if (n.step === null) {
                restHash = n.hash;
                continue;
            }
            const at = byStep.get(n.step) ?? {};
            at[n.sharp ? 'sharp' : 'natural'] = n;
            byStep.set(n.step, at);
        }
        if (activeId && !songById(activeId)) activeId = null;
        if (selected) {
            const song = songById(selected.song);
            if (!song || selected.index >= song.notes.length) selected = null;
        }
        if (player.songId && !songById(player.songId)) stop();
        if (press) return;
        render();
        if (pendingScroll) {
            scrollToSong(pendingScroll);
            pendingScroll = null;
        }
    });

    vscode.postMessage({ type: 'ready' });
})();
