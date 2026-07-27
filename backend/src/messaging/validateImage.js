const fs = require('fs');
const path = require('path');
const { getSetting } = require('../database/repositories/settingsRepository');

/**
 * Validates incoming image attachments based on supported file formats and maximum file size configurations.
 *
 * Supports: PNG, JPEG, WEBP
 * Configurable Limit: read from database/env setting (defaults to 10MB).
 *
 * @param {Object} media - Normalized message media object {localPath, mimeType, fileName}
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateIncomingImage(media) {
    if (!media || !media.localPath) {
        return { valid: false, error: 'ملف الصورة المرفق مفقود أو تالف.' };
    }

    const absolutePath = media.localPath.startsWith('/') && !media.localPath.startsWith('/uploads')
        ? media.localPath
        : path.join(__dirname, '..', '..', 'public', media.localPath);

    if (!fs.existsSync(absolutePath)) {
        return { valid: false, error: 'تعذر العثور على ملف الصورة على السيرفر.' };
    }

    // 1. Format validation
    const supportedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const mimeType = (media.mimeType || '').toLowerCase();

    // Check extension if mimetype is ambiguous
    const ext = path.extname(media.localPath).toLowerCase();
    const isSupportedExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);

    if (!supportedMimeTypes.includes(mimeType) && !isSupportedExt) {
        return {
            valid: false,
            error: `نوع الملف غير مدعوم. الأنواع المدعومة حالياً هي JPEG و PNG و WEBP فقط.`
        };
    }

    // 2. Size validation
    try {
        const stats = fs.statSync(absolutePath);
        const fileSizeInBytes = stats.size;

        // Retrieve max size limit (in MB) from database settings or env
        let maxSizeMbSetting = getSetting('VISION_MAX_SIZE_MB') || process.env.VISION_MAX_SIZE_MB;
        let maxSizeMb = 10; // Default fallback to 10MB
        if (maxSizeMbSetting) {
            const parsed = parseFloat(maxSizeMbSetting);
            if (!isNaN(parsed) && parsed > 0) {
                maxSizeMb = parsed;
            }
        }

        const maxSizeBytes = maxSizeMb * 1024 * 1024;
        if (fileSizeInBytes > maxSizeBytes) {
            return {
                valid: false,
                error: `حجم الصورة المرفقة كبير جداً (${(fileSizeInBytes / (1024 * 1024)).toFixed(1)}MB). الحد الأقصى المسموح به هو ${maxSizeMb}MB.`
            };
        }
    } catch (err) {
        console.error('Error in image size validation:', err.message);
        return { valid: false, error: 'حدث خطأ أثناء قراءة وفحص حجم ملف الصورة.' };
    }

    return { valid: true, error: null };
}

module.exports = {
    validateIncomingImage
};
