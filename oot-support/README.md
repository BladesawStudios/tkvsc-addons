# TKVSC Ocarina of Time Support

Registers **Ocarina of Time** as a TKVSC game profile, so its RomFS can be browsed and edited through core TKVSC.

## Setup

1. Install [TKVSC](https://github.com/BladesawStudios/totk-vscode) and this extension
2. Command Palette → **Ocarina of Time: Set Game Dump Path**
3. Select your extracted RomFS folder, or a parent folder containing it

## Settings

| Setting | Description |
|---------|-------------|
| `TKVSC.oot.romfsPath` | Path to the Ocarina of Time RomFS dump |
| `TKVSC.activeGameId` | Set to `oot` automatically by the setup command |

## Development

```bash
npm install
npm run compile
```

Open this folder in VS Code and press **F5** (loads this addon and the sibling `../../totk-vscode`).