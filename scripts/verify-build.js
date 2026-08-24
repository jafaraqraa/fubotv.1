const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const roots = [
    path.join(projectRoot, 'backend', 'src'),
    path.join(projectRoot, 'frontend', 'public', 'js')
];
const requiredAssets = [
    path.join(projectRoot, 'backend', 'server.js'),
    path.join(projectRoot, 'frontend', 'node_modules', 'dompurify', 'dist', 'purify.min.js'),
    path.join(projectRoot, 'frontend', 'public', 'dashboard.html'),
    path.join(projectRoot, 'frontend', 'public', 'login.html')
];

function listJavaScriptFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return listJavaScriptFiles(target);
        return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
    });
}

for (const asset of requiredAssets) {
    if (!fs.existsSync(asset) || fs.statSync(asset).size === 0) {
        console.error(`[Build Verify] Required deployable asset is missing or empty: ${asset}`);
        process.exit(1);
    }
}

const files = [
    path.join(projectRoot, 'backend', 'server.js'),
    ...roots.flatMap(listJavaScriptFiles)
];
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        console.error(`[Build Verify] Syntax validation failed: ${file}`);
        console.error(result.stderr.trim());
        process.exit(result.status || 1);
    }
}

console.log(`[Build Verify] Validated ${files.length} JavaScript files and ${requiredAssets.length} deployable assets.`);
