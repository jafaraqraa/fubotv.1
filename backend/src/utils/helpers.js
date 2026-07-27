const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');

function getChromePath() {
    const paths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium'
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return undefined;
}

function updateEnvFile(key, value) {
    const envPath = path.join(__dirname, '..', '..', '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
    }

    const lineToReplace = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*`, 'm');

    if (envContent.match(regex)) {
        envContent = envContent.replace(regex, lineToReplace);
    } else {
        envContent += `\n${lineToReplace}`;
    }

    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
    process.env[key] = value; // مزامنة فورية في ذاكرة السيرفر
}

async function downloadRemoteFile(url, fileName) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    const buffer = await response.arrayBuffer();
    const destPath = path.join(uploadsDir, fileName);
    fs.writeFileSync(destPath, Buffer.from(buffer));
    return `/uploads/${fileName}`;
}

function getExtensionFromMime(mimetype) {
    const map = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'audio/ogg': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/amr': 'amr',
        'application/pdf': 'pdf'
    };
    return map[mimetype] || 'bin';
}

module.exports = {
    getChromePath,
    updateEnvFile,
    downloadRemoteFile,
    getExtensionFromMime
};
