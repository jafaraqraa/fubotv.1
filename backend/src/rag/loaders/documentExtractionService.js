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
    const allowed = [
        'txt', 'md', 'markdown', 'pdf', 'docx',
        'jpg', 'jpeg', 'png', 'webp',
        'mp3', 'ogg', 'wav', 'm4a'
    ];
    if (!allowed.includes(ext)) {
        throw new Error('امتداد الملف غير مدعوم. الامتدادات المدعومة: PDF, TXT, MD, DOCX, JPG, PNG, WEBP, MP3, OGG, WAV, M4A.');
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
    } else if (ext === 'jpg' || ext === 'jpeg') {
        if (!['image/jpeg', 'image/jpg'].includes(mimeLower)
            || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8
            || buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
            throw new Error('صورة JPEG غير صالحة أو نوع MIME غير متوافق.');
        }
    } else if (ext === 'png') {
        if (mimeLower !== 'image/png' || buffer.length < 24
            || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
            throw new Error('صورة PNG غير صالحة أو نوع MIME غير متوافق.');
        }
    } else if (ext === 'webp') {
        if (mimeLower !== 'image/webp' || buffer.length < 12
            || buffer.toString('ascii', 0, 4) !== 'RIFF'
            || buffer.toString('ascii', 8, 12) !== 'WEBP') {
            throw new Error('صورة WEBP غير صالحة أو نوع MIME غير متوافق.');
        }
    } else if (ext === 'mp3') {
        const hasMp3Signature = buffer.length >= 3 && (
            buffer.toString('ascii', 0, 3) === 'ID3'
            || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
        );
        if (mimeLower !== 'audio/mpeg' || !hasMp3Signature) {
            throw new Error('ملف MP3 غير صالح أو نوع MIME غير متوافق.');
        }
    } else if (ext === 'ogg') {
        if (!['audio/ogg', 'application/ogg'].includes(mimeLower)
            || buffer.length < 4 || buffer.toString('ascii', 0, 4) !== 'OggS') {
            throw new Error('ملف OGG غير صالح أو نوع MIME غير متوافق.');
        }
    } else if (ext === 'wav') {
        if (!['audio/wav', 'audio/x-wav'].includes(mimeLower) || buffer.length < 12
            || buffer.toString('ascii', 0, 4) !== 'RIFF'
            || buffer.toString('ascii', 8, 12) !== 'WAVE') {
            throw new Error('ملف WAV غير صالح أو نوع MIME غير متوافق.');
        }
    } else if (ext === 'm4a') {
        if (!['audio/mp4', 'audio/x-m4a'].includes(mimeLower) || buffer.length < 12
            || buffer.toString('ascii', 4, 8) !== 'ftyp') {
            throw new Error('ملف M4A غير صالح أو نوع MIME غير متوافق.');
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
