'use strict';

const crypto = require('crypto');
const { chunkDocument } = require('../chunking/hierarchicalChunker');
const { validateDocumentQuality } = require('./qualityGate');
const { encodeSparse } = require('../embeddings/sparseEncoder');

class IngestionPipeline {
    constructor({ repository, embeddings, indexer, config }) { Object.assign(this, { repository, embeddings, indexer, config }); }
    async ingest(input, options = {}) {
        const sourceChecksum = crypto.createHash('sha256').update(String(input.originalText || '')).digest('hex');
        const existing = this.repository.findByChecksum(input, sourceChecksum);
        if (existing) return { status: 'duplicate', documentVersionId: existing.document_version_id, chunks: 0 };
        const documentVersionId = input.documentVersionId || crypto.randomUUID(); const jobId = options.jobId || crypto.randomUUID(); let stage = 'quality';
        this.repository.beginJob({ jobId, tenantId: input.tenantId, knowledgeBaseId: input.knowledgeBaseId, documentVersionId, stage });
        let chunks = []; let indexed = false;
        try {
            const qualityReport = validateDocumentQuality(input.originalText);
            const allowedQualityIssues = new Set(options.allowedQualityIssues || []);
            const blockingQualityIssues = qualityReport.issues.filter(issue => !allowedQualityIssues.has(issue));
            if (blockingQualityIssues.length) { const error = new Error(`document quality rejected: ${blockingQualityIssues.join(',')}`); error.code = 'RAG_V2_QUALITY_REJECTED'; throw error; }
            stage = 'chunking'; this.repository.checkpoint(jobId, stage);
            const version = { ...input, documentVersionId, sourceChecksum,
                qualityReport: { ...qualityReport, accepted: true, explicitlyAllowedIssues: [...allowedQualityIssues].filter(issue => qualityReport.issues.includes(issue)) },
                status: 'active', isCurrent: true };
            chunks = chunkDocument(version, this.config);
            if (!chunks.length) { const error = new Error('document produced no chunks'); error.code = 'RAG_V2_NO_CHUNKS'; throw error; }
            stage = 'embedding'; this.repository.checkpoint(jobId, stage, { chunkCount: chunks.length });
            const dense = await this.embeddings.embed(chunks.map(chunk => chunk.retrievalText), { signal: options.signal });
            stage = 'indexing'; this.repository.checkpoint(jobId, stage, { embeddedCount: dense.length });
            await this.indexer.upsert(chunks.map((chunk, index) => ({ chunk, denseVector: dense[index], sparseVector: encodeSparse(chunk.retrievalText) })), { signal: options.signal });
            indexed = true;
            stage = 'commit'; this.repository.checkpoint(jobId, stage);
            this.repository.commitVersion(version, chunks, jobId);
            return { status: 'indexed', jobId, documentVersionId, chunks: chunks.length, sourceChecksum };
        } catch (error) {
            if (indexed) {
                try { await this.indexer.deleteChunkIds(chunks.map(chunk => chunk.chunkId), { signal: options.signal }); }
                catch (cleanupError) { error.cleanupError = cleanupError.message; }
            }
            this.repository.failJob(jobId, error, stage); throw error;
        }
    }
}

module.exports = { IngestionPipeline };
