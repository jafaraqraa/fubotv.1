/**
 * Normalizes metadata extracted from retrieved chunks or source names.
 */
class EvidenceMetadata {
    /**
     * Packages a retrieved chunk payload into a standardized, rich metadata schema.
     *
     * @param {Object} chunk - Raw chunk candidate from hybrid retrieval.
     * @param {string} intent - Detected intent category.
     * @param {string} subQuery - Associated sub-query text.
     * @returns {Object} Mapped metadata schema.
     */
    static map(chunk, intent = 'General', subQuery = '') {
        const payload = chunk.payload || {};
        const sourceName = chunk.source || payload.documentName || 'معرفة عامة';
        const docId = chunk.documentId || payload.documentId || sourceName;
        const chunkId = chunk.chunkId || payload.chunkId || require('crypto')
            .createHash('sha256')
            .update(`${docId}\0${String(chunk.text || payload.text || '')}`)
            .digest('hex')
            .slice(0, 20);

        return {
            chunkId,
            documentId: docId,
            sourceName,
            title: payload.title || sourceName.replace(/\.[^/.]+$/, ""), // Strip extension for default title
            section: payload.section || 'General Content',
            heading: payload.heading || payload.section || null,
            page: payload.page ?? null,
            retrievalScore: chunk.score || 0.0,
            semanticScore: chunk.semanticScore || chunk.score || 0.0,
            keywordScore: chunk.keywordScore || 0.0,
            rerankScore: chunk.rerankScore || chunk.score || 0.0,
            finalScore: chunk.finalScore || chunk.score || 0.0,
            tenantId: payload.tenantId || chunk.tenantId || '',
            documentVersionId: payload.documentVersionId || chunk.documentVersionId || '',
            sourceType: payload.sourceType || chunk.sourceType || '',
            indexVersionId: payload.indexVersionId || chunk.indexVersionId || '',
            injectionGuard: chunk.injectionGuard || null,
            intent,
            query: subQuery || chunk.query || ''
        };
    }
}

/**
 * Tracks individual citation chunks in an execution flow.
 */
class ChunkReference {
    constructor(metadata, text) {
        this.metadata = metadata;
        this.text = text;
    }
}

/**
 * Holds active evidence index for tracing and auditing retrieved queries.
 */
class EvidenceIndex {
    constructor() {
        this.activeEvidence = new Map();
        this.discardedEvidence = new Map();
    }

    registerActive(metadata, text) {
        this.activeEvidence.set(metadata.chunkId, new ChunkReference(metadata, text));
    }

    registerDiscarded(metadata, text, reason) {
        this.discardedEvidence.set(metadata.chunkId, {
            reference: new ChunkReference(metadata, text),
            reason
        });
    }

    getActive() {
        return Array.from(this.activeEvidence.values());
    }

    getDiscarded() {
        return Array.from(this.discardedEvidence.values());
    }

    retainActive(chunkIds, reason = 'Excluded by context budget.') {
        const allowed = new Set(chunkIds);
        for (const [chunkId, reference] of this.activeEvidence) {
            if (allowed.has(chunkId)) continue;
            this.activeEvidence.delete(chunkId);
            this.discardedEvidence.set(chunkId, { reference, reason });
        }
    }
}

/**
 * Serializes citation-rich structured prompt context.
 */
class EvidenceBuilder {
    /**
     * Builds standard structured context blocks mapping chunks clearly for downstream LLMs.
     *
     * @param {Array<ChunkReference>} activeRefs - Mapped references.
     * @returns {string} Serialized prompt context.
     */
    static buildGroundingContext(activeRefs) {
        if (!activeRefs || activeRefs.length === 0) return '';

        const escapeLabel = value => String(value || '')
            .replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
        return activeRefs.map(ref => {
            const m = ref.metadata;
            const labels = [
                `Chunk #${escapeLabel(m.chunkId)}`,
                `Document: ${escapeLabel(m.title || m.sourceName)}`,
                m.section ? `Section: ${escapeLabel(m.section)}` : '',
                m.intent ? `Intent: ${escapeLabel(m.intent)}` : ''
            ].filter(Boolean).join('\n');
            return `${labels}\n${serializeChunks([{
                text: ref.text,
                injectionGuard: m.injectionGuard,
                tenantId: m.tenantId,
                documentId: m.documentId,
                documentVersionId: m.documentVersionId,
                chunkId: m.chunkId,
                sourceType: m.sourceType,
                sourceName: m.sourceName,
                retrievalScore: m.finalScore,
                indexVersionId: m.indexVersionId
            }])}`;
        }).join('\n\n');
    }
}

/**
 * Maintains relational traceability of query, intent, chunks, and answers.
 */
class CitationMapper {
    constructor() {
        this.mappings = [];
    }

    /**
     * Maps query to final output tracing details.
     */
    recordTrace({ userQuery, retrievedQuery, intent, chunkId, title, sourceName }) {
        this.mappings.push({
            userQuery,
            retrievedQuery,
            intent,
            chunkId,
            title,
            sourceName,
            timestamp: new Date().toISOString()
        });
    }

    getTraces() {
        return this.mappings;
    }
}

/**
 * Audit engine to validate context entry and ranking decisions.
 */
class GroundingValidator {
    /**
     * Audits and logs the end-to-end evidence tracking.
     *
     * @param {EvidenceIndex} index - Active index.
     * @param {number} executionTimeMs - Latency.
     */
    static audit(index, executionTimeMs) {
        const active = index.getActive();
        const discarded = index.getDiscarded();

        console.log(`\n🕵️ [Grounding & Evidence Tracking Audit]`);
        console.log(`• Final Context Evidence count: ${active.length} chunks`);
        active.forEach((ref, idx) => {
            const m = ref.metadata;
            console.log(`  [Active #${idx + 1}] ID: ${m.chunkId} | Doc: "${m.title}" | Section: "${m.section}" | Match Score: ${m.finalScore.toFixed(2)}`);
        });

        console.log(`• Discarded Evidence count: ${discarded.length} chunks`);
        discarded.forEach((item, idx) => {
            const m = item.reference.metadata;
            console.log(`  [Discarded #${idx + 1}] ID: ${m.chunkId} | Reason: "${item.reason}"`);
        });

        console.log(`• Active Evidence IDs: [${active.map(r => r.metadata.chunkId).join(', ')}]`);
        console.log(`• Auditing Execution Time: ${executionTimeMs} ms\n`);
    }
}

module.exports = {
    EvidenceMetadata,
    ChunkReference,
    EvidenceIndex,
    EvidenceBuilder,
    CitationMapper,
    GroundingValidator
};
const { serializeChunks } = require('../security/promptInjectionGuard');
