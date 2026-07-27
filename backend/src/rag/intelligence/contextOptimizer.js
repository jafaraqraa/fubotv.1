/**
 * Finds the character overlap length between the suffix of string a and prefix of string b.
 */
function findOverlapLength(a, b) {
    if (!a || !b) return 0;

    const cleanA = a.trim();
    const cleanB = b.trim();
    const maxLen = Math.min(cleanA.length, cleanB.length);

    for (let len = maxLen; len >= 1; len--) {
        const suffix = cleanA.substring(cleanA.length - len);
        const prefix = cleanB.substring(0, len);
        if (suffix === prefix) {
            return len;
        }
    }
    return 0;
}

/**
 * Optimizes context by merging overlapping suffix/prefix chunks in sequence.
 */
function optimizeContext(chunks) {
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) return '';

    let merged = chunks[0].text;

    for (let i = 1; i < chunks.length; i++) {
        const nextText = chunks[i].text;
        const overlap = findOverlapLength(merged, nextText);

        if (overlap > 0) {
            const remainder = nextText.substring(overlap).trim();
            merged = merged + '\n' + remainder;
        } else {
            merged = merged + '\n\n' + nextText;
        }
    }

    return merged;
}

module.exports = {
    findOverlapLength,
    optimizeContext
};
