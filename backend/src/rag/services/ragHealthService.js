const { checkQdrantReady, getCollectionStats } = require('../vector/qdrantVectorStore');
const { checkModelAvailability } = require('../embeddings/ollamaEmbeddingProvider');
const { isIndexingRunning, getIndexingState } = require('../indexing/knowledgeIndexingService');
const { getConfig } = require('../config/ragConfig');
const { getMetrics: getFallbackMetrics } = require('../runtime/fallbackPolicy');

async function getRAGSystemStatus(tenantId) {
    const { requireTenantId } = require('../security/tenantContext');
    tenantId = requireTenantId(tenantId, 'rag-health-status');
    const modelName = getConfig('RAG_EMBEDDING_MODEL');
    const collectionName = getConfig('QDRANT_COLLECTION');

    let qdrantReachable = false;
    let ollamaReachable = false;
    let modelAvailable = false;
    let collectionAvailable = false;
    let collectionStats = null;
    let tenantStatistics = null;
    let errorSummary = null;

    try {
        qdrantReachable = await checkQdrantReady();
    } catch (e) {
        errorSummary = `Qdrant unreachable: ${e.message}`;
    }

    try {
        ollamaReachable = await checkModelAvailability();
        modelAvailable = ollamaReachable;
    } catch (e) {
        if (!errorSummary) {
            errorSummary = `Ollama unreachable: ${e.message}`;
        }
    }

    if (qdrantReachable) {
        try {
            collectionStats = await getCollectionStats();
            collectionAvailable = true;
            tenantStatistics = await require('./ragObservabilityService')
                .getTenantRagStatistics(tenantId);
        } catch (e) {
            // Ignore collection fetch error
        }
    }

    // Get index metadata from SQLite
    let lastSuccessAt = null;
    let lastStatus = 'never_indexed';
    let lastDurationMs = 0;
    let lastChunkCount = 0;

    try {
        const indexState = getIndexingState(tenantId, 'knowledge.txt');
        if (indexState) {
            lastStatus = indexState.last_status;
            lastSuccessAt = indexState.last_success_at;
            lastDurationMs = indexState.last_duration_ms;
            lastChunkCount = indexState.total_chunks;
            if (indexState.last_error && !errorSummary) {
                errorSummary = indexState.last_error;
            }
        }
    } catch (e) {
        // Ignore SQLite read error
    }

    // Determine retrieval and infrastructure modes
    let retrievalMode = 'FAILED';
    let infrastructureMode = 'unhealthy';

    if (qdrantReachable && ollamaReachable && collectionAvailable) {
        retrievalMode = 'NORMAL';
        infrastructureMode = 'healthy';
    }

    const logical = require('./ragObservabilityService').logicalStatistics(tenantId);
    const chunkSize = parseInt(getConfig('RAG_CHUNK_SIZE'), 10) || 800;
    const chunkOverlap = parseInt(getConfig('RAG_CHUNK_OVERLAP'), 10) || 120;
    const runtime = require('../runtime/ragMetrics').snapshot();
    const retrievalTiming = runtime.metrics?.qdrantRequestDurationMs || null;

    return {
        qdrantReachable,
        ollamaReachable,
        modelAvailable,
        collectionAvailable,
        collectionName,
        embeddingModelName: modelName,
        statistics: tenantStatistics,
        collectionStatistics: collectionStats,
        retrievalMode,
        infrastructureMode,
        lastSuccessfulIndexingTime: lastSuccessAt,
        lastIndexingStatus: lastStatus,
        lastIndexingDuration: lastDurationMs,
        lastIndexingChunkCount: lastChunkCount,
        isReindexingActive: isIndexingRunning(),
        errorSummary,
        documentCount: logical.activeDocuments,
        indexedDocumentCount: logical.activeDocuments,
        failedDocumentCount: logical.failedVersions,
        totalIndexedChunks: logical.activeChunks,
        supportedFileTypes: ['pdf', 'txt', 'docx', 'md'],
        configuredChunkSize: chunkSize,
        configuredChunkOverlap: chunkOverlap,
        embeddingDimension: collectionStats?.embeddingDimension ?? null,
        avgRetrievalLatencyMs: retrievalTiming?.averageMs ?? null,
        metricAvailability: {
            collectionSizeBytes: 'unavailable',
            storageUsageBytes: 'unavailable',
            retrievalPercentiles: retrievalTiming?.sampleStatus || 'insufficient_samples'
        },
        fallbackMetrics: getFallbackMetrics()
    };
}

module.exports = {
    getRAGSystemStatus
};
