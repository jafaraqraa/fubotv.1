const fs = require('fs');
const path = require('path');

/**
 * Converts a local image file on the server into a standard base64 data URI.
 * Handles uploads relative public paths or absolute system paths.
 *
 * @param {Object} media - Normalized message media object {localPath, mimeType}
 * @returns {string|null} Base64 data URL (e.g. "data:image/jpeg;base64,...") or null if failed.
 */
function convertImageToBase64(media) {
    if (!media || !media.localPath) {
        return null;
    }

    const absolutePath = media.localPath.startsWith('/') && !media.localPath.startsWith('/uploads')
        ? media.localPath
        : path.join(__dirname, '..', '..', 'public', media.localPath);

    try {
        if (!fs.existsSync(absolutePath)) {
            console.error(`[Base64 Conversion] Image path does not exist: ${absolutePath}`);
            return null;
        }

        const fileBuffer = fs.readFileSync(absolutePath);
        const base64Data = fileBuffer.toString('base64');
        const mimeType = media.mimeType || 'image/jpeg';

        return `data:${mimeType};base64,${base64Data}`;
    } catch (err) {
        console.error('[Base64 Conversion] Error reading image file:', err.message);
        return null;
    }
}

module.exports = {
    convertImageToBase64
};
