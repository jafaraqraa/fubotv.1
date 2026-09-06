'use strict';

class RagV2Repository {
    constructor(db) { this.db = db; }
    beginJob(job) {
        this.db.prepare(`INSERT INTO rag_v2_ingestion_jobs
            (job_id, tenant_id, knowledge_base_id, document_version_id, state, stage, started_at)
            VALUES (?, ?, ?, ?, 'running', ?, CURRENT_TIMESTAMP)`).run(job.jobId, job.tenantId, job.knowledgeBaseId, job.documentVersionId, job.stage);
    }
    checkpoint(jobId, stage, checkpoint = {}) {
        this.db.prepare(`UPDATE rag_v2_ingestion_jobs SET stage=?, checkpoint_json=?, updated_at=CURRENT_TIMESTAMP WHERE job_id=?`)
            .run(stage, JSON.stringify(checkpoint), jobId);
    }
    failJob(jobId, error, stage) {
        this.db.prepare(`UPDATE rag_v2_ingestion_jobs SET state='failed', stage=?, error_code=?, error_detail_redacted=?, finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE job_id=?`)
            .run(stage, error.code || 'RAG_V2_INGESTION_FAILED', String(error.message || 'failed').slice(0, 500), jobId);
    }
    findByChecksum(scope, checksum) {
        return this.db.prepare(`SELECT * FROM rag_v2_document_versions WHERE tenant_id=? AND knowledge_base_id=? AND source_checksum=? LIMIT 1`)
            .get(scope.tenantId, scope.knowledgeBaseId, checksum);
    }
    commitVersion(version, chunks, jobId) {
        return this.db.transaction(() => {
            this.db.prepare(`UPDATE rag_v2_document_versions SET is_current=0, status='inactive', updated_at=CURRENT_TIMESTAMP
                WHERE tenant_id=? AND knowledge_base_id=? AND document_id=? AND is_current=1`)
                .run(version.tenantId, version.knowledgeBaseId, version.documentId);
            this.db.prepare(`INSERT INTO rag_v2_document_versions
                (document_version_id,tenant_id,knowledge_base_id,document_id,version_number,status,valid_from,valid_to,is_current,source_type,source_uri,source_checksum,language,title,permissions_json,quality_report_json,indexed_at)
                VALUES (?,?,?,?,?,'active',?,?,1,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
                .run(version.documentVersionId, version.tenantId, version.knowledgeBaseId, version.documentId, version.versionNumber,
                    version.validFrom, version.validTo, version.sourceType, version.sourceUri, version.sourceChecksum,
                    version.language, version.title, JSON.stringify(version.permissions || []), JSON.stringify(version.qualityReport || {}));
            const insert = this.db.prepare(`INSERT INTO rag_v2_chunks
                (chunk_id,document_version_id,tenant_id,knowledge_base_id,parent_id,chunk_index,section_path_json,page_number,original_text,retrieval_text,content_checksum,token_count)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
            chunks.forEach((chunk, index) => insert.run(chunk.chunkId, chunk.documentVersionId, chunk.tenantId, chunk.knowledgeBaseId,
                chunk.parentId, index, JSON.stringify(chunk.sectionPath || []), chunk.pageNumber, chunk.originalText,
                chunk.retrievalText, chunk.contentChecksum, chunk.tokenCount));
            this.db.prepare(`UPDATE rag_v2_ingestion_jobs SET state='completed', stage='completed', finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).run(jobId);
        })();
    }
}

module.exports = { RagV2Repository };
