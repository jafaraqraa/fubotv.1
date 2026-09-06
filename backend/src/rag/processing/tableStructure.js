'use strict';
// Deterministic table projection: copy headers/cells only; never infer a unit,
// currency, missing cell, entity, or business value.
function cells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}
function tableRows(text) {
    const lines = String(text || '').split('\n');
    const declarations = lines.filter(line => /(?:العملة|currency)\s*[*_]*\s*:/iu.test(line));
    const currencies = [...new Set(declarations.flatMap(line =>
        (line.match(/شيكل|شيقل|ILS|دولار|USD/giu) || []).map(unit => /شيكل|شيقل|ILS/iu.test(unit) ? 'ILS' : 'USD')))];
    const currency = currencies.length === 1 ? currencies[0] : null;
    const result = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('|') && /^\s*\|?\s*:?-{3,}/u.test(lines[i + 1] || '')) {
            const headers = cells(lines[i]);
            i += 2;
            for (; i < lines.length && lines[i].includes('|'); i++) {
                const row = cells(lines[i]);
                if (row.length !== headers.length) { result.push(lines[i]); continue; }
                result.push(row.map((value, index) => {
                    const header = headers[index];
                    const monetary = /سعر|أسعار|اسعار|يومي|أسبوعي|اسبوعي|تأمين|تامين|price|cost|deposit/iu.test(header);
                    const ownUnit = /شيكل|شيقل|ILS|دولار|USD|%/iu.test(header);
                    const explicitCurrency = currency && monetary && !ownUnit && /^[0-9٠-٩]+(?:[.,][0-9٠-٩]+)?$/u.test(value)
                        ? ` ${currency}` : '';
                    return `${header}: ${value}${explicitCurrency}`;
                }).join(' | '));
            }
            i--;
        } else result.push(lines[i]);
    }
    return result.join('\n');
}
function decodeHtml(text) {
    return text.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function htmlToStructuredText(html) {
    // Input is Mammoth's generated HTML, never served to a browser.
    let value = String(html || '').replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, table) => {
        const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match =>
            [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
                .map(cell => cell[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()));
        if (!rows.length) return '';
        // Keep an explicit grid; the first row is not assumed to be a header.
        return '\n\n' + rows.map(row => row.join(' | ')).join('\n') + '\n\n';
    });
    value = value.replace(/<\/(?:p|h[1-6]|li|ul|ol)>/gi, '\n\n').replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '');
    return decodeHtml(value);
}
function tableFacts(text) {
    return tableRows(text).split('\n').flatMap(line => {
        const parts = line.split('|').map(part => part.trim()).filter(Boolean);
        if (parts.length < 2 || !parts.every(part => part.includes(':'))) return [line];
        return parts.slice(1).map(part => {
            const delimiter = part.indexOf(':');
            const header = part.slice(0, delimiter);
            const value = part.slice(delimiter + 1).trim();
            // A numbered period in a header (weekly price, 7 days) describes
            // the billing basis, not the unit of the numeric cell.
            const unitHeader = header.replace(/\([^)]*[0-9٠-٩][^)]*\)/gu, '');
            const unit = unitHeader.match(/(?:^|[^\p{L}])(شيكل|شيقل|دولار|ILS|USD|%|ساعة|ساعات|يوم|أيام)(?=$|[^\p{L}])/iu)?.[1];
            const explicitUnit = unit && /^[0-9٠-٩]+(?:[.,][0-9٠-٩]+)?$/.test(value) ? ` ${unit}` : '';
            return `${parts[0]} | ${part}${explicitUnit}`;
        });
    }).join('\n');
}
module.exports = { tableRows, tableFacts, htmlToStructuredText };
