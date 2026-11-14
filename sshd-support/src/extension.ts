import * as vscode from 'vscode';
import {
    SSHD_GAME_ID,
    SSHD_GAME_PROFILE,
    SSHD_ROMFS_SENTINEL_POSIX,
    resolveSshdRomfsRoot,
} from './gameProfile';
import { getTkvscApi } from './getTkvscApi';

const ROMFS_SETTINGS_KEY = 'sshd.romfsPath';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const api = await getTkvscApi();
    if (!api) {
        return;
    }

    // Register through the API as well as the manifest, so the profile exists even when core's first manifest scan ran
    // before this extension was visible. extensionRoot lets core find the relative hostPlugin path.
    context.subscriptions.push(
        api.registerGameProfile(SSHD_GAME_PROFILE, {
            extensionRoot: context.extensionPath,
        }),
    );

    if (!api.getGameProfile(SSHD_GAME_ID)) {
        void vscode.window.showErrorMessage('TKVSC Skyward Sword HD: failed to register the game profile.');
        return;
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('tkvsc-sshd.setGameDump', setGameDump),
    );
}

async function setGameDump(): Promise<void> {
    const folder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Skyward Sword HD RomFS Folder',
        title: 'Select Skyward Sword HD game dump',
    });
    if (!folder?.[0]) {
        return;
    }

    const resolved = resolveSshdRomfsRoot(folder[0].fsPath);
    if (!resolved) {
        void vscode.window.showWarningMessage(
            `The selected folder must contain "${SSHD_ROMFS_SENTINEL_POSIX}".`,
            { modal: true },
        );
        return;
    }

    const config = vscode.workspace.getConfiguration('TKVSC');
    await config.update(ROMFS_SETTINGS_KEY, resolved, vscode.ConfigurationTarget.Global);
    await config.update('activeGameId', SSHD_GAME_ID, vscode.ConfigurationTarget.Global);

    void vscode.window.showInformationMessage(`Skyward Sword HD game dump set to ${resolved}`);
}

export function deactivate(): void {
    // no-op
}
