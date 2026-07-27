const db = require('../../database/connection');

// Standard memory-based dictionary as a baseline and robust fallback
const defaultSynonyms = {
    'الدفع': ['السداد', 'فيزا', 'دفع', 'سداد'],
    'الشحن': ['التوصيل', 'توصيل', 'شحن', 'طرد'],
    'الشراء': ['الطلب', 'طلب', 'شراء'],
    'الارجاع': ['الاسترجاع', 'استرجاع', 'ارجاع', 'استبدال']
};

let localCache = { ...defaultSynonyms };

/**
 * Expands query tokens with any matched synonyms from the database or memory cache.
 */
function expandSynonyms(tokens) {
    if (!tokens || !Array.isArray(tokens)) return [];

    const expanded = new Set(tokens);
    const synonymsDict = getAllSynonyms();

    tokens.forEach(token => {
        // Direct match
        if (synonymsDict[token]) {
            synonymsDict[token].forEach(syn => expanded.add(syn));
        }

        // Reverse match: if a token exists in any of the values lists, expand to key and other values
        for (const [key, list] of Object.entries(synonymsDict)) {
            if (list.includes(token) || key === token) {
                expanded.add(key);
                list.forEach(syn => expanded.add(syn));
            }
        }
    });

    return Array.from(expanded);
}

/**
 * Registers a new synonym record dynamically.
 */
function addSynonymRecord(word, synonyms) {
    if (!word) return;
    const synList = Array.isArray(synonyms) ? synonyms : [synonyms];

    localCache[word] = synList;

    // Save to database if available
    try {
        const tableCheck = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='rag_synonyms'`).get();
        if (tableCheck) {
            db.prepare(`
                INSERT INTO rag_synonyms (word, synonyms)
                VALUES (?, ?)
                ON CONFLICT(word) DO UPDATE SET synonyms=excluded.synonyms
            `).run(word, JSON.stringify(synList));
        }
    } catch (err) {
        console.warn('Synonym database storage skipped:', err.message);
    }
}

/**
 * Returns the entire synonym dictionary, combining DB records and local memory fallbacks.
 */
function getAllSynonyms() {
    try {
        const tableCheck = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='rag_synonyms'`).get();
        if (tableCheck) {
            const rows = db.prepare(`SELECT word, synonyms FROM rag_synonyms`).all();
            const dbDict = {};
            rows.forEach(r => {
                try {
                    dbDict[r.word] = JSON.parse(r.synonyms);
                } catch (e) {
                    dbDict[r.word] = [];
                }
            });
            return { ...localCache, ...dbDict };
        }
    } catch (err) {
        // Fall back gracefully to cache
    }
    return { ...localCache };
}

module.exports = {
    expandSynonyms,
    addSynonymRecord,
    getAllSynonyms
};
