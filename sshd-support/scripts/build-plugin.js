// Publishes the host plugin to bin/plugin, after checking that the libraries the host also ships are pinned to the same
// commits as in the TKVSC submodule. A plugin built against other versions fails when the host loads its own copies.
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const libs = path.join(root, 'plugin', 'libs');
const tkvsc = path.join(libs, 'totk-vscode');
const sharedWithHost = ['TexSharp', 'BntxSharp', 'MsbtSharp'];

function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const mismatched = sharedWithHost.filter((name) => {
    const ours = git(path.join(libs, name), 'rev-parse', 'HEAD');
    const host = git(tkvsc, 'rev-parse', `HEAD:host/libs/${name}`);
    if (ours !== host) {
        console.error(`${name}: plugin/libs has ${ours.slice(0, 7)}, the TKVSC submodule's host has ${host.slice(0, 7)}`);
    }
    return ours !== host;
});
if (mismatched.length > 0) {
    console.error('Check out the host\'s commits in plugin/libs, or move the totk-vscode submodule to a TKVSC that ships these.');
    process.exit(1);
}

if (process.argv.includes('--check')) {
    console.log('Host library pins match.');
    process.exit(0);
}

execFileSync(
    'dotnet',
    ['publish', path.join('plugin', 'src', 'Sshd.Plugin', 'Sshd.Plugin.csproj'), '-c', 'Release', '-o', path.join('bin', 'plugin')],
    { cwd: root, stdio: 'inherit' },
);
