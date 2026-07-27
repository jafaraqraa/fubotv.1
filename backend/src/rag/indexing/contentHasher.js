const crypto = require('crypto');

/**
 * Computes SHA-256 hash for stable document and chunk comparison.
 */
function computeSHA256(text) {
    if (!text) return '';
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

module.exports = {
    computeSHA256
};
