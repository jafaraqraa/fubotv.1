'use strict';

function validateDocumentQuality(text) {
    const value = String(text || ''); const issues = [];
    if (!value.trim()) issues.push('empty_document');
    if (value.includes('\uFFFD')) issues.push('broken_encoding');
    const visible = [...value].filter(char => !/\s/u.test(char));
    const strange = visible.filter(char => !/[\p{L}\p{N}\p{P}\p{S}]/u.test(char)).length;
    if (visible.length && strange / visible.length > 0.1) issues.push('excessive_strange_characters');
    const lines = value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const counts = new Map(); lines.forEach(line => counts.set(line, (counts.get(line) || 0) + 1));
    const repeated = [...counts.entries()].filter(([, count]) => count >= 4).map(([line]) => line.slice(0, 120));
    if (repeated.length) issues.push('repeated_headers_or_footers');
    return { accepted: issues.length === 0, issues, repeatedLines: repeated, characterCount: value.length };
}

module.exports = { validateDocumentQuality };
