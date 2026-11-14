# TKVSC - Skyward Sword HD

Skyward Sword HD support for [TKVSC](https://github.com/TKVSC-Team/totk-vscode).

So far:

- `.LZ` (LZ11) files and U8 archives (`.arc`, `.arc.LZ`) open, browse, index and save like any other archive.
- `.msbf` message flows open as text: entry points, then one line per node, with each branch's targets listed on it. Saving rebuilds the branch table, and keeps the file's header and layout.

## Layout

| Path | What |
|---|---|
| `src/` | The VS Code add-on: game profile and commands |
| `plugin/src/Sshd.Plugin/` | The game plugin the TKVSC host loads: compression, archives, formats |
| `plugin/libs/` | Every library as a submodule, plus `totk-vscode` (shallow) for the plugin contract |
| `scripts/build-plugin.js` | Checks pins, then publishes the plugin to `bin/plugin` |

`TexSharp`, `BntxSharp` and `MsbtSharp` also ship with the host, which always loads its own copies. The plugin compiles against them but doesn't ship them, and their pins in `plugin/libs` must match `host/libs` in the `totk-vscode` submodule. `npm run check:pins` checks this, and the plugin build does too.

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
