const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadTextDocument(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`ملف المعرفة غير موجود في المسار: ${filePath}`);
    }

    const originalText = fs.readFileSync(filePath, 'utf8');
    const trimmed = originalText.trim();

    if (trimmed === '') {
        throw new Error('ملف المعرفة فارغ أو يحتوي على مسافات فارغة فقط.');
    }

    // Normalize line endings
    const normalizedText = originalText.replace(/\r\n/g, '\n');

    // Stats
    const stats = fs.statSync(filePath);
    const sizeBytes = stats.size;
    const modifiedAt = stats.mtime.toISOString();

    // Stable document ID and hash
    const documentHash = crypto.createHash('sha256').update(normalizedText, 'utf8').digest('hex');
    const filename = path.basename(filePath);
    const documentId = filename; // stable identifier based on filename

    return {
        documentId,
        source: filename,
        sourceType: 'text',
        originalText: normalizedText,
        documentHash,
        modifiedAt,
        sizeBytes
    };
}

module.exports = {
    loadTextDocument
};
