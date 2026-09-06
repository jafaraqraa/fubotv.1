'use strict';

const { normalizeForRetrieval } = require('../normalization/arabic');
const { assertAuthorizedCandidate } = require('../security/filters');

function tokenize(text) { return normalizeForRetrieval(text).match(/[\p{L}\p{N}][\p{L}\p{N}_.+:/-]*/gu) || []; }

class Bm25Index {
    constructor({ k1 = 1.2, b = 0.75 } = {}) { this.k1 = k1; this.b = b; this.documents = new Map(); this.df = new Map(); this.totalLength = 0; }
    add(candidate) {
        if (!candidate?.chunkId) throw new Error('chunkId is required');
        this.remove(candidate.chunkId);
        const terms = tokenize(candidate.retrievalText || candidate.originalText); const tf = new Map();
        for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1);
        this.documents.set(candidate.chunkId, { candidate, terms, tf }); this.totalLength += terms.length;
        for (const term of tf.keys()) this.df.set(term, (this.df.get(term) || 0) + 1);
    }
    remove(chunkId) {
        const old = this.documents.get(chunkId); if (!old) return false;
        this.totalLength -= old.terms.length; for (const term of old.tf.keys()) { const next = this.df.get(term) - 1; next ? this.df.set(term, next) : this.df.delete(term); }
        return this.documents.delete(chunkId);
    }
    search(query, scope, limit = 40) {
        const queryTerms = [...new Set(tokenize(query))]; const n = this.documents.size; if (!n || !queryTerms.length) return [];
        const avgdl = this.totalLength / n; const ranked = [];
        for (const { candidate, terms, tf } of this.documents.values()) {
            if (!assertAuthorizedCandidate(candidate, scope)) continue;
            let score = 0;
            for (const term of queryTerms) { const frequency = tf.get(term) || 0; if (!frequency) continue;
                const df = this.df.get(term) || 0; const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
                score += idf * frequency * (this.k1 + 1) / (frequency + this.k1 * (1 - this.b + this.b * terms.length / avgdl));
            }
            if (score > 0) ranked.push({ ...candidate, sparseScore: score, retrievalSource: 'sparse' });
        }
        return ranked.sort((a, b) => b.sparseScore - a.sparseScore || String(a.chunkId).localeCompare(String(b.chunkId))).slice(0, limit);
    }
}

module.exports = { Bm25Index, tokenize };
