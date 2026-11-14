# TKVSC - Skyward Sword HD

Skyward Sword HD support for [TKVSC](https://github.com/TKVSC-Team/totk-vscode).

So far:

- `.LZ` (LZ11) files and U8 archives (`.arc`, `.arc.LZ`) open, browse, index and save like any other archive.
- `.msbf` message flows open as text: entry points, then one line per node, with each branch's targets listed on it. Saving rebuilds the branch table, and keeps the file's header and layout.
- `.msbp` message projects open as text: the colour table (`main.msbp` has 49 colours and nothing else), plus colour labels if a file has any.
- `.msbt` uses TKVSC's built-in handler.
- Textures open in a viewer, with PNG export of one texture or all of them:
  - `.xtx` (HD, ASTC/BC1), named from the `.brres` beside it
  - `.brres`, `.brresC` and `.brtex`: their TEX0s, taking HD pixels from the `.xtx` beside them, or GX ones from the BRES
  - `.tpl` and `.bti` (GX)
- Particles (`.jpc`) open as YAML, one entry per emitter resource with every block as named fields: emitter (BEM1), fields
  (FLD1), key frames (KFA1), base shape with its colour and texture tables (BSP1), extra shape (ESP1), child shape (SSP1),
  extra texture (ETX1) and texture indices (TDB1). Resources can be edited, added, removed or copied; saving rebuilds every
  block. Bytes nothing names yet show as `unknownXX`. Textures stay as they are: open a `.jpc` with
  **Skyward Sword HD Textures** (Open With) to see them. `.jpn` tables open as `index: value` text.
- Fonts (`.brfnt`, `.brfna`) open in a viewer: type text to see it drawn with the font's glyphs and widths (scale, colour, background), and browse the glyph sheets, clicking a cell to see its character and widths.

The viewers are read-only: the libraries decode these formats but can't encode them yet. The add-on reads the file (and its sibling) and hands it to the plugin's `sshd-textures` and `sshd-font` commands, which return PNGs.

## Layout

| Path | What |
|---|---|
| `src/` | The VS Code add-on: game profile and commands |
| `plugin/src/Sshd.Plugin/` | The game plugin the TKVSC host loads: compression, archives, formats |
| `plugin/libs/` | Every library as a submodule, plus `totk-vscode` (shallow) for the plugin contract |
| `scripts/build-plugin.js` | Checks pins, then publishes the plugin to `bin/plugin` |

`TexSharp`, `BntxSharp` and `MsbtSharp` also ship with the host, which always loads its own copies. The plugin also uses the host's YamlDotNet (a NuGet reference that isn't shipped). The plugin compiles against them but doesn't ship them, and their pins in `plugin/libs` must match `host/libs` in the `totk-vscode` submodule. `npm run check:pins` checks this, and the plugin build does too.

## Building

```bash
git submodule update --init sshd-support/plugin/libs
npm install
npm run build:plugin
npm run package
```

Don't initialise submodules recursively: the libraries' own nested copies aren't used (`plugin/Directory.Build.props` points them at `plugin/libs`), and `totk-vscode` has many of its own.

## Updating a library

- **SSHD-only libraries** (LzSharp, U8Sharp, BzsSharp, …): check out the new commit in `plugin/libs/<Name>` and commit the pin.
- **Libraries the host ships**: bump them in TKVSC first, move `plugin/libs/totk-vscode` to that TKVSC commit, then check out the same commits in `plugin/libs`.
