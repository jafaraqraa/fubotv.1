const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { normalizeArabic } = require('../processing/arabicNormalizer');
const { cleanText } = require('../processing/textCleaner');

const docsDir = path.join(__dirname, '..', '..', '..', 'data', 'knowledge-documents');

// Ensure storage directory exists
if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
}

/**
 * Computes a SHA-256 hash of a Buffer or String.
 */
function computeSHA256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Checks a file name for path traversal, null bytes, executable or unsafe double extensions.
 */
function validateFilenameSecurity(filename) {
    if (!filename || typeof filename !== 'string') {
        throw new Error('اسم الملف غير صالح.');
    }

    // Reject path traversal / absolute paths
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        throw new Error('اسم الملف يحتوي على مسارات غير مصرح بها.');
    }

    // Reject null bytes
    if (filename.includes('\0')) {
        throw new Error('اسم الملف يحتوي على محارف غير آمنة.');
    }

    const lower = filename.toLowerCase();

    // Reject executable extensions anywhere in the name (prevents double extension attack like file.php.txt)
    const unsafePatterns = [
        '.php', '.phtml', '.exe', '.sh', '.bash', '.bat', '.cmd', '.js', '.jse',
        '.vbs', '.vbe', '.ws', '.wsf', '.pl', '.py', '.rb', '.cgi', '.msi', '.msp', '.com'
    ];

    for (const pattern of unsafePatterns) {
        if (lower.includes(pattern)) {
            throw new Error('نوع الملف المرفوع غير آمن ومرفوض تماماً.');
        }
    }

    // Extract extension cleanly
    const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
    if (!extMatch) {
        throw new Error('الملف لا يحتوي على امتداد صالح.');
    }

    const ext = extMatch[1].toLowerCase();
    const allowed = ['txt', 'md', 'markdown', 'pdf', 'docx'];
    if (!allowed.includes(ext)) {
        throw new Error('امتداد الملف غير مدعوم. الامتدادات المدعومة: PDF, TXT, MD, DOCX.');
    }

    return ext;
}

/**
 * Validates declared MIME type and checks PDF magic bytes if appropriate.
 */
function validateMimeAndMagicBytes(ext, mimeType, buffer) {
    const mimeLower = String(mimeType || '').toLowerCase();

    // Extension & MIME compatibility mapping
    if (ext === 'pdf') {
        const validMimes = ['application/pdf', 'application/x-pdf', 'application/acrobat', 'applications/vnd.pdf', 'text/pdf'];
        if (!validMimes.includes(mimeLower)) {
            throw new Error('نوع MIME للملف غير متوافق مع امتداد PDF.');
        }
        // Inspect PDF magic bytes %PDF (hex: 25 50 44 46)
        if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
            throw new Error('بنية ملف PDF غير صالحة أو تالفة (مخالف للمواصفات).');
        }
    } else if (ext === 'txt') {
        const validMimes = ['text/plain', 'application/octet-stream', 'application/txt', 'text/comma-separated-values'];
        if (!validMimes.includes(mimeLower)) {
            throw new Error('نوع MIME للملف غير متوافق مع امتداد TXT.');
        }
    } else if (ext === 'md' || ext === 'markdown') {
        const validMimes = ['text/markdown', 'text/plain', 'application/octet-stream', 'text/x-markdown'];
        if (!validMimes.includes(mimeLower)) {
            throw new Error('نوع MIME للملف غير متوافق مع امتداد Markdown.');
        }
    } else if (ext === 'docx') {
        const validMimes = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/octet-stream'
        ];
        if (!validMimes.includes(mimeLower)) {
            throw new Error('نوع MIME للملف غير متوافق مع امتداد DOCX.');
        }
        // Inspect DOCX magic bytes: 50 4b 03 04 (PK\x03\x04)
        if (buffer.length < 4 || buffer.toString('hex', 0, 4) !== '504b0304') {
            throw new Error('بنية ملف DOCX غير صالحة أو تالفة.');
        }
    }
}

/**
 * Extracts plain text from document buffers based on extension.
 */
async function extractTextFromBuffer(ext, buffer) {
    if (!buffer || buffer.length === 0) {
        throw new Error('محتوى الملف فارغ.');
    }

    let extractedText = '';

    if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
        extractedText = buffer.toString('utf8');
    } else if (ext === 'pdf') {
        try {
            const data = await pdfParse(buffer);
            extractedText = data.text || '';
        } catch (err) {
            throw new Error(`فشل استخراج النصوص من ملف PDF: ${err.message}`);
        }
    } else if (ext === 'docx') {
        try {
            const result = await mammoth.extractRawText({ buffer });
            extractedText = result.value || '';
        } catch (err) {
            throw new Error(`فشل استخراج النصوص من ملف DOCX: ${err.message}`);
        }
    }

    // Clean up extraction
    const cleaned = cleanText(extractedText);
    if (!cleaned || cleaned.trim() === '') {
        throw new Error('تعذر استخراج أي نصوص صالحة أو مقروءة من الملف.');
    }

    return cleaned;
}

/**
 * Normalizes and hashes extracted text for duplicate content validation.
 */
function computeNormalizedTextHash(text) {
    const normalized = normalizeArabic(text).toLowerCase().replace(/\s+/g, '');
    return computeSHA256(normalized);
}

module.exports = {
    docsDir,
    computeSHA256,
    validateFilenameSecurity,
    validateMimeAndMagicBytes,
    extractTextFromBuffer,
    computeNormalizedTextHash
};
