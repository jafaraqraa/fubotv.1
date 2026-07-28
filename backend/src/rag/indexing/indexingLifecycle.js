const ALLOWED_TRANSITIONS = Object.freeze({
    uploaded: new Set(['extracting', 'failed']),
    failed: new Set(['extracting', 'rollback', 'cleanup_pending']),
    extracting: new Set(['chunking', 'failed', 'rollback']),
    chunking: new Set(['embedding', 'failed', 'rollback']),
    embedding: new Set(['uploading_vectors', 'failed', 'rollback']),
    uploading_vectors: new Set(['verifying', 'failed', 'rollback']),
    verifying: new Set(['activating', 'failed', 'rollback']),
    activating: new Set(['active', 'failed', 'rollback']),
    rollback: new Set(['failed', 'cleanup_pending']),
    active: new Set(['extracting', 'cleanup_pending']),
    cleanup_pending: new Set(['active', 'extracting', 'failed'])
});

function assertTransition(from, to) {
    if (from === to) return;
    if (!ALLOWED_TRANSITIONS[from]?.has(to)) {
        const error = new Error(`Illegal RAG indexing state transition: ${from} -> ${to}`);
        error.code = 'RAG_ILLEGAL_STATE_TRANSITION';
        error.stage = 'state_transition';
        throw error;
    }
}

function createLifecycle({ tenantId, documentId, versionId, initialState, persist }) {
    let state = initialState;
    let stageStartedAt = Date.now();
    return {
        get state() { return state; },
        transition(nextState, stage = nextState) {
            assertTransition(state, nextState);
            const now = Date.now();
            console.log('[Index] Stage completed', {
                tenantId, documentId, versionId, stage: state,
                durationMs: now - stageStartedAt
            });
            persist(nextState);
            state = nextState;
            stageStartedAt = now;
            console.log('[Index] Stage started', { tenantId, documentId, versionId, stage });
        },
        fail(error) {
            const now = Date.now();
            console.error('[Index] Stage failed', {
                tenantId, documentId, versionId, stage: error.stage || state,
                durationMs: now - stageStartedAt, code: error.code || 'RAG_INDEX_FAILED'
            });
        }
    };
}

function assertActiveDocument(doc) {
    if (!doc || doc.status !== 'active' || doc.is_active !== 1
        || !Number.isInteger(doc.chunk_count) || doc.chunk_count <= 0
        || doc.vector_count !== doc.chunk_count) {
        const error = new Error('فشل التحقق من الحالة النهائية للمستند النشط.');
        error.code = 'RAG_FINAL_STATE_INVALID';
        error.stage = 'activation';
        throw error;
    }
    return doc;
}

module.exports = { ALLOWED_TRANSITIONS, assertTransition, createLifecycle, assertActiveDocument };
