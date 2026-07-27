/**
 * Cleans raw text conservatively to prepare it for chunking,
 * while preserving paragraph/list/heading structural boundaries.
 */
function cleanText(text) {
    if (!text || typeof text !== 'string') return '';

    // 1. Normalize line endings
    let cleaned = text.replace(/\r\n/g, '\n');

    // 2. Collapse more than two consecutive empty lines down to exactly two empty lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // 3. Collapse multiple spaces on a single line to a single space, but keep line breaks intact
    cleaned = cleaned.split('\n').map(line => {
        return line.replace(/[ \t]+/g, ' ').trim();
    }).join('\n');

    return cleaned.trim();
}

module.exports = {
    cleanText
};
