class IndexingStageError extends Error {
    constructor(message, { stage, code, retryable = false, cause, previousVersionPreserved = false } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = this.constructor.name;
        this.stage = stage;
        this.code = code || 'RAG_INDEX_FAILED';
        this.retryable = retryable;
        this.previousVersionPreserved = previousVersionPreserved;
    }
}

class ExtractionError extends IndexingStageError {}
class ChunkingError extends IndexingStageError {}
class EmbeddingError extends IndexingStageError {}
class QdrantUploadError extends IndexingStageError {}
class VerificationError extends IndexingStageError {}
class ActivationError extends IndexingStageError {}
class RollbackError extends IndexingStageError {}

const ERROR_BY_STAGE = Object.freeze({
    extraction: ExtractionError,
    chunking: ChunkingError,
    embedding: EmbeddingError,
    embeddings: EmbeddingError,
    qdrant_upload: QdrantUploadError,
    verification: VerificationError,
    qdrant_verify: VerificationError,
    qdrant_verification: VerificationError,
    activating: ActivationError,
    activation: ActivationError,
    database_commit: ActivationError,
    vector_activation: ActivationError,
    rollback: RollbackError
});

function asStageError(error, stage, extra = {}) {
    if (error instanceof IndexingStageError) {
        if (!error.stage) error.stage = stage;
        Object.assign(error, extra);
        return error;
    }
    const ErrorType = ERROR_BY_STAGE[stage] || IndexingStageError;
    const wrapped = new ErrorType(error.message || String(error), {
        stage,
        code: error.code,
        retryable: error.retryable === true
            || ['embedding', 'embeddings', 'qdrant_upload', 'verification', 'qdrant_verify', 'qdrant_verification']
                .includes(stage),
        cause: error,
        ...extra
    });
    Object.assign(wrapped, extra);
    return wrapped;
}

module.exports = {
    IndexingStageError,
    ExtractionError,
    ChunkingError,
    EmbeddingError,
    QdrantUploadError,
    VerificationError,
    ActivationError,
    RollbackError,
    asStageError
};
