import * as vscode from 'vscode';
import {
    OOT_GAME_ID,
    OOT_GAME_PROFILE,
    OOT_ROMFS_SENTINEL_POSIX,
    resolveOotRomfsRoot,
} from './gameProfile';
import { getTkvscApi } from './getTkvscApi';

const ROMFS_SETTINGS_KEY = 'oot.romfsPath';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const api = await getTkvscApi();
    if (!api) {
        return;
    }

    // Register through the API as well as the manifest, so the profile exists even when core's
    // first manifest scan ran before this extension was visible.
    context.subscriptions.push(
        api.registerGameProfile(OOT_GAME_PROFILE, {
            extensionRoot: context.extensionPath,
        }),
    );

    if (!api.getGameProfile(OOT_GAME_ID)) {
        void vscode.window.showErrorMessage('TKVSC Ocarina of Time: failed to register the game profile.');
        return;
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('tkvsc-oot.setGameDump', setGameDump),
    );
}

async function setGameDump(): Promise<void> {
    const folder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Ocarina of Time RomFS Folder',
        title: 'Select Ocarina of Time game dump',
    });
    if (!folder?.[0]) {
        return;
    }

    const resolved = resolveOotRomfsRoot(folder[0].fsPath);
    if (!resolved) {
        void vscode.window.showWarningMessage(
            `The selected folder must contain "${OOT_ROMFS_SENTINEL_POSIX}".`,
            { modal: true },
        );
        return;
    }

    const config = vscode.workspace.getConfiguration('TKVSC');
    await config.update(ROMFS_SETTINGS_KEY, resolved, vscode.ConfigurationTarget.Global);
    await config.update('activeGameId', OOT_GAME_ID, vscode.ConfigurationTarget.Global);

    void vscode.window.showInformationMessage(`Ocarina of Time game dump set to ${resolved}`);
}

export function deactivate(): void {
    // no-op
}
