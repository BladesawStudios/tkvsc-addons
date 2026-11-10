# TKVSC Ocarina of Time Support

Registers **Ocarina of Time** as a TKVSC game profile, so its RomFS can be browsed and edited through core TKVSC.

## What this addon does

- Declares the `oot` game profile
- Validates dumps with the sentinel `Pack/Bootup.Nin_Ounce_NVN2.pack.zs`
- Provides the game's MSBT tags in `OoT.gcf`, so message tags show by name
- Names ocarina notes and songs in BYML text (`OoT.valuenames.txt`): a hashed value shows as `!hash B` or
  `!hash EponaSong`, and any `!hash Name` you type is saved as that name's unsigned MurmurHash3
- Opens `GameParameter/MelodyScoreBook/*.game__ocarina__MelodyScoreBook.bgyml` in the **Ocarina Song Editor**

## Ocarina Song Editor

Edits the songs the ocarina recognises. Use **Edit as text** (or *Reopen Editor With...*) for the YAML.

- Songs are written on the staff. Click a pitch past the last note to add a note there, or in a note's column to
  change it; a faint note shows what a click will do. Drag a note up or down to change its pitch, or sideways to
  move it. Right-click deletes a note, and holding Shift writes the sharp.
- The five pitches the buttons play (D, F, A, B, High D) are marked on the staff. The other 15 notes can be
  written too, and show in amber with a warning.
- Keys: 1-5 add the playable notes (or replace the selected one), arrow keys select a note, Up and Down change its
  pitch, Alt+arrows move it, # toggles its sharp, R writes a rest and Delete removes a note.
- MelodyType **(none)** leaves the field out, which the game reads as Zelda's Lullaby.
  NoteNumForNavi and RestToRepeatExample are left out when empty.
- ▶ plays the notes with the game's `Sound/Resource/Stream/Ocarina_<Note>.bwav` at the chosen tempo;
  ♫ plays the game's own recording of the song. Both need the game dump path set.
- Warnings: two songs with the same MelodyType (or two with none), a song that is the end of another or the same
  as another, notes on the Scarecrow's Song, empty songs, songs over 8 notes, and unplayable notes.
- Unrecognised note or song hashes show as hex and are kept, as are fields the editor doesn't show.
  An unedited file saves byte-identically.
- Saving updates the file's entry in the project's resource size table
  (`System/Resource/ResourceSizeTable.Product.*.rsizetable.zs`): the vanilla value while the file matches the dump,
  otherwise the size from the Ocarina of Time RSTB calculator, with its 16 KB margin. If the project has no
  size table, the editor offers to add one copied from the dump.

Everything else comes from core TKVSC, which reads the game's textures, dictionaries and particle colours from the files themselves.

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