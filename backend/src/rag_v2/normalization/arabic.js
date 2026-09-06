'use strict';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function normalizeForRetrieval(value, options = {}) {
    let text = String(value || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '');
    text = text.replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي');
    if (options.foldTaMarbuta === true) text = text.replace(/ة/g, 'ه');
    text = text.replace(/[٠-٩]/g, d => String(ARABIC_DIGITS.indexOf(d)))
        .replace(/[۰-۹]/g, d => String(EASTERN_DIGITS.indexOf(d)))
        .replace(/\s+/g, ' ').trim().toLowerCase();
    // Preserve the user's Arabic spelling while adding common catalog aliases
    // so sparse retrieval can match Latin product headings such as "Mesh Wi-Fi".
    text = text.replace(/(^|\s)ميش(?=\s|$|[?!؟.,])/gu, '$1ميش mesh');
    return text;
}

function dualText(originalText, options) {
    return Object.freeze({ originalText: String(originalText || ''), retrievalText: normalizeForRetrieval(originalText, options) });
}

module.exports = { normalizeForRetrieval, dualText };
