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
        const chunkId = chunk.chunkId || payload.chunkId || `chunk-${Math.random().toString(36).substring(2, 7)}`;

        return {
            chunkId,
            documentId: docId,
            sourceName,
            title: payload.title || sourceName.replace(/\.[^/.]+$/, ""), // Strip extension for default title
            section: payload.section || 'General Content',
            retrievalScore: chunk.score || 0.0,
            semanticScore: chunk.semanticScore || chunk.score || 0.0,
            keywordScore: chunk.keywordScore || 0.0,
            rerankScore: chunk.rerankScore || chunk.score || 0.0,
            finalScore: chunk.finalScore || chunk.score || 0.0,
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

        return activeRefs.map((ref, idx) => {
            const m = ref.metadata;
            let block = `Chunk #${m.chunkId}\n`;
            block += `Document: ${m.title} (${m.sourceName})\n`;
            if (m.section && m.section !== 'General Content') {
                block += `Section: ${m.section}\n`;
            }
            block += `Intent: ${m.intent}\n`;
            block += `Content:\n${ref.text.trim()}`;
            return block;
        }).join('\n\n====================\n\n');
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
