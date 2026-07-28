const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { getConfig } = require('../config/ragConfig');
const { requireTenantId } = require('../security/tenantContext');
const {
    RagTransientError, RagPermanentError,
    withTimeout, retryOperation
} = require('../runtime/asyncControl');
const metrics = require('../runtime/ragMetrics');

function positiveConfig(key, fallback) {
    const value = Number(getConfig(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function qdrantOperation(url, method = 'GET') {
    if (url.includes('/readyz')) return ['qdrant_health', 'RAG_QDRANT_HEALTH_TIMEOUT_MS', 5000, true];
    if (url.includes('/points/search')) return ['qdrant_search', 'RAG_QDRANT_SEARCH_TIMEOUT_MS', 10000, true];
    if (url.includes('/points/count')) return ['qdrant_count', 'RAG_QDRANT_COUNT_TIMEOUT_MS', 10000, true];
    if (url.includes('/points/scroll')) return ['qdrant_scroll', 'RAG_QDRANT_SCROLL_TIMEOUT_MS', 15000, true];
    if (url.includes('/points/delete')) return ['qdrant_delete', 'RAG_QDRANT_DELETE_TIMEOUT_MS', 15000, false];
    if (url.includes('/points') && method === 'PUT') return ['qdrant_upload', 'RAG_QDRANT_UPLOAD_TIMEOUT_MS', 30000, false];
    if (url.includes('/points/payload')) return ['qdrant_payload_update', 'RAG_QDRANT_UPLOAD_TIMEOUT_MS', 30000, false];
    return ['qdrant_health', 'RAG_QDRANT_HEALTH_TIMEOUT_MS', 5000, method === 'GET'];
}

async function qdrantFetch(url, options = {}, stage = 'request') {
    const [operation, timeoutKey, fallback, idempotent] = qdrantOperation(url, options.method || 'GET');
    const timeoutMs = positiveConfig(timeoutKey, fallback);
    const startedAt = performance.now();
    let succeeded = false;
    try {
        const response = await retryOperation({
            operation,
            signal: options.signal,
            maxAttempts: idempotent ? positiveConfig('RAG_RETRY_MAX_ATTEMPTS', 3) : 1,
            baseDelayMs: positiveConfig('RAG_RETRY_BASE_DELAY_MS', 300),
            maxDelayMs: positiveConfig('RAG_RETRY_MAX_DELAY_MS', 3000),
            fn: async attempt => {
                if (attempt > 1) metrics.increment('dependencyRetriesTotal');
                let response;
                try {
                    response = await withTimeout({
                        operation, timeoutMs, parentSignal: options.signal,
                        errorCode: 'RAG_QDRANT_TIMEOUT',
                        fn: signal => fetch(url, { ...options, signal })
                    });
                } catch (error) {
                    if (error.code === 'RAG_QDRANT_TIMEOUT') metrics.increment('dependencyTimeoutsTotal');
                    if (error.code?.startsWith('RAG_')) throw error;
                    if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']
                        .includes(error?.cause?.code || error?.code)) {
                        throw new RagTransientError(`Qdrant connection failed during ${stage}.`, {
                            operation, code: 'RAG_QDRANT_CONNECTION_FAILED', cause: error
                        });
                    }
                    throw error;
                }
                if (idempotent && [429, 502, 503, 504].includes(response.status)) {
                    throw new RagTransientError(`Transient Qdrant HTTP ${response.status}.`, {
                        operation, code: `RAG_QDRANT_HTTP_${response.status}`
                    });
                }
                return response;
            }
        });
        succeeded = true;
        return response;
    } finally {
        const durationMs = performance.now() - startedAt;
        metrics.observe('qdrantRequestDurationMs', durationMs);
        if (operation === 'qdrant_search') {
            console.log(`[RAG Qdrant] Search ${succeeded ? 'completed' : 'failed'} durationMs=${durationMs.toFixed(1)}`);
        }
    }
}

function qdrantHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = getConfig('QDRANT_API_KEY');
    if (apiKey) headers['api-key'] = apiKey;
    return headers;
}

async function searchPoints(body, options = {}) {
    const response = await qdrantFetch(
        `${getConfig('QDRANT_URL')}/collections/${getConfig('QDRANT_COLLECTION')}/points/search`,
        {
            method: 'POST',
            headers: qdrantHeaders(),
            body: JSON.stringify(body),
            signal: options.signal
        },
        'بحث Qdrant'
    );
    if (!response.ok) {
        throw new RagPermanentError(`Qdrant search rejected (HTTP ${response.status}).`, {
            operation: 'qdrant_search', code: `RAG_QDRANT_HTTP_${response.status}`
        });
    }
    return (await response.json()).result || [];
}

async function countPoints(filter, options = {}) {
    const response = await qdrantFetch(
        `${getConfig('QDRANT_URL')}/collections/${getConfig('QDRANT_COLLECTION')}/points/count`,
        {
            method: 'POST', headers: qdrantHeaders(), signal: options.signal,
            body: JSON.stringify({ exact: true, filter })
        },
        'عد نقاط Qdrant'
    );
    if (response.status === 404) return 0;
    if (!response.ok) throw new Error(`Qdrant count failed: HTTP ${response.status}`);
    return (await response.json()).result?.count || 0;
}

async function getCollectionStats(options = {}) {
    const response = await qdrantFetch(
        `${getConfig('QDRANT_URL')}/collections/${getConfig('QDRANT_COLLECTION')}`,
        { headers: qdrantHeaders(), signal: options.signal },
        'قراءة إحصاءات المجموعة'
    );
    if (!response.ok) throw new Error(`فشل جلب إحصاءات Qdrant: HTTP ${response.status}`);
    const result = (await response.json()).result || {};
    const vectorsConfig = result.config?.params?.vectors;
    const unnamedVector = vectorsConfig && Number.isFinite(Number(vectorsConfig.size))
        ? vectorsConfig : null;
    const namedVectors = vectorsConfig && !unnamedVector && typeof vectorsConfig === 'object'
        ? Object.values(vectorsConfig) : [];
    const dimensions = unnamedVector
        ? [Number(unnamedVector.size)]
        : namedVectors.map(vector => Number(vector?.size)).filter(Number.isFinite);
    return {
        qdrantPointsCount: Number.isFinite(Number(result.points_count))
            ? Number(result.points_count) : null,
        qdrantVectorsCount: Number.isFinite(Number(result.vectors_count))
            ? Number(result.vectors_count) : null,
        indexedVectorsCount: Number.isFinite(Number(result.indexed_vectors_count))
            ? Number(result.indexed_vectors_count) : null,
        embeddingDimension: dimensions.length === 1 ? dimensions[0] : null,
        namedVectorDimensions: unnamedVector || !dimensions.length ? null : dimensions,
        collectionSegmentsCount: Number.isFinite(Number(result.segments_count))
            ? Number(result.segments_count) : null,
        distance: unnamedVector?.distance || null,
        status: result.status || null,
        optimizerStatus: result.optimizer_status || null,
        source: 'qdrant_collection_info',
        scope: 'collection',
        exactness: 'qdrant_reported',
        collectedAt: new Date().toISOString()
    };
}

function exactVersionFilter({ tenantId, documentId, documentVersionId, indexVersionId, lifecycle }) {
    tenantId = requireTenantId(tenantId, 'qdrant-version-count');
    if (!documentId || !documentVersionId || !indexVersionId || !lifecycle) {
        throw new Error('tenantId, documentId, documentVersionId, indexVersionId and lifecycle are required.');
    }
    return {
        must: [
            { key: 'tenantId', match: { value: tenantId } },
            { key: 'documentId', match: { value: String(documentId) } },
            { key: 'documentVersionId', match: { value: String(documentVersionId) } },
            { key: 'indexVersionId', match: { value: String(indexVersionId) } },
            { key: 'lifecycle', match: { value: String(lifecycle) } }
        ]
    };
}

async function countDocumentVersionPoints(identity, options = {}) {
    return countPoints(exactVersionFilter(identity), options);
}

async function scrollPointsPage(filter, offset, limit, signal, stage) {
    const response = await qdrantFetch(
        `${getConfig('QDRANT_URL')}/collections/${getConfig('QDRANT_COLLECTION')}/points/scroll`,
        {
            method: 'POST',
            headers: qdrantHeaders(),
            signal,
            body: JSON.stringify({
                filter,
                limit,
                ...(offset !== undefined && offset !== null ? { offset } : {}),
                with_payload: true,
                with_vector: false
            })
        },
        stage
    );
    if (!response.ok) throw new Error(`فشل Qdrant scroll: HTTP ${response.status}`);
    const result = (await response.json()).result || {};
    return { points: result.points || [], nextOffset: result.next_page_offset ?? null };
}

async function scrollTenantPointsPage(tenantId, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-reconcile-scroll');
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
    return scrollPointsPage(
        { must: [{ key: 'tenantId', match: { value: tenantId } }] },
        options.offset,
        limit,
        options.signal,
        'مصالحة نقاط المستأجر'
    );
}

async function scrollUnownedPointsPage(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
    return scrollPointsPage(
        { must: [{ is_empty: { key: 'tenantId' } }] },
        options.offset,
        limit,
        options.signal,
        'تدقيق النقاط القديمة غير المملوكة'
    );
}

async function collectFilteredPoints(filter, options = {}) {
    const points = [];
    let offset = null;
    const maxPoints = Number(options.maxPoints)
        || positiveConfig('RAG_MAX_CHUNKS_PER_DOCUMENT', 5000);
    do {
        const response = await qdrantFetch(
            `${getConfig('QDRANT_URL')}/collections/${getConfig('QDRANT_COLLECTION')}/points/scroll`,
            {
                method: 'POST', headers: qdrantHeaders(), signal: options.signal,
                body: JSON.stringify({
                    filter, limit: Math.min(500, maxPoints - points.length),
                    ...(offset !== null ? { offset } : {}),
                    with_payload: true, with_vector: options.withVector === true
                })
            },
            'جلب نقاط Qdrant المفلترة'
        );
        if (!response.ok) throw new Error(`Qdrant scroll failed: HTTP ${response.status}`);
        const result = (await response.json()).result || {};
        points.push(...(result.points || []));
        offset = result.next_page_offset ?? null;
        if (points.length >= maxPoints && offset !== null) {
            throw new RagPermanentError('Qdrant verification result exceeds configured point limit.', {
                operation: 'qdrant_scroll', code: 'RAG_MAX_POINTS_EXCEEDED'
            });
        }
    } while (offset !== null);
    return points;
}

async function deleteTenantPointsByIds(tenantId, pointIds, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-reconcile-delete');
    const ids = [...new Set((pointIds || []).map(String))];
    if (!ids.length) return { deleted: 0 };
    const ownershipFilter = [
        { key: 'tenantId', match: { value: tenantId } },
        { has_id: ids }
    ];
    if (options.sourceType) {
        ownershipFilter.push({ key: 'sourceType', match: { value: String(options.sourceType) } });
    }
    if (options.documentVersionId) {
        ownershipFilter.push({
            key: 'documentVersionId',
            match: { value: String(options.documentVersionId) }
        });
    }
    if (options.indexVersionId) {
        ownershipFilter.push({
            key: 'indexVersionId',
            match: { value: String(options.indexVersionId) }
        });
    }
    if (!options.documentVersionId && !options.indexVersionId) {
        throw new Error('Version metadata is required for a reconciliation delete.');
    }
    const response = await qdrantFetch(
        `${getConfig('QDRANT_URL')}/collections/${getConfig('QDRANT_COLLECTION')}/points/delete?wait=true`,
        {
            method: 'POST',
            headers: qdrantHeaders(),
            signal: options.signal,
            body: JSON.stringify({
                filter: {
                    must: ownershipFilter
                }
            })
        },
        'حذف نقاط المصالحة'
    );
    if (!response.ok) {
        throw new Error(`فشل حذف نقاط المصالحة: HTTP ${response.status} - ${await response.text()}`);
    }
    return { deleted: ids.length };
}

/**
 * Converts any string into a deterministic UUID valid for Qdrant.
 */
function stringToDeterministicUUID(str) {
    const hash = crypto.createHash('md5').update(str).digest('hex');
    return [
        hash.substring(0, 8),
        hash.substring(8, 12),
        '4' + hash.substring(13, 16),
        ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hash.substring(18, 20),
        hash.substring(20, 32)
    ].join('-');
}

/**
 * Checks Qdrant service connection and ready status.
 */
async function checkQdrantReady(options = {}) {
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');

    const headers = {};
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    try {
        const response = await qdrantFetch(`${qdrantUrl}/readyz`, {
            headers, signal: options.signal
        }, 'فحص جاهزية Qdrant');
        return response.ok;
    } catch (e) {
        throw e;
    }
}

/**
 * Validates or creates the configured collection with a verified vector dimension.
 * cosine similarity is used.
 */
async function initCollection(dimension, options = {}) {
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    // 1. Check if collection exists
    const checkRes = await qdrantFetch(`${qdrantUrl}/collections/${collectionName}`, {
        headers, signal: options.signal
    }, 'فحص مجموعة Qdrant');

    if (checkRes.ok) {
        // Collection exists, validate dimension
        const data = await checkRes.json();
        const existingDim = data.result && data.result.config && data.result.config.params && data.result.config.params.vectors && data.result.config.params.vectors.size;

        if (existingDim && existingDim !== dimension) {
            throw new Error(`تعذر المتابعة: حجم المتجه في المجموعة الحالية (${existingDim}) غير متوافق مع النموذج الحالي (${dimension}). يتطلب الأمر إعادة فهرسة كاملة للمجموعة.`);
        }
        return true;
    }

    // 2. Collection does not exist, create it
    const createBody = {
        vectors: {
            size: dimension,
            distance: 'Cosine'
        }
    };

    const createRes = await qdrantFetch(`${qdrantUrl}/collections/${collectionName}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(createBody),
        signal: options.signal
    }, 'إنشاء مجموعة Qdrant');

    if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`فشل إنشاء مجموعة Qdrant: ${createRes.status} - ${errText}`);
    }

    return true;
}

/**
 * Retrieves the total count of vectors currently stored in the configured collection.
 */
async function getTenantPhysicalPointCount(tenantId, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-count');
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    const headers = {};
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    try {
        const response = await qdrantFetch(`${qdrantUrl}/collections/${collectionName}/points/count`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            signal: options.signal,
            body: JSON.stringify({
                exact: true,
                filter: { must: [{ key: 'tenantId', match: { value: tenantId } }] }
            })
        }, 'عد متجهات المستأجر');
        if (!response.ok) return 0;
        return (await response.json()).result?.count || 0;
    } catch (e) { throw e; }
}

// Deprecated compatibility alias. This value has always represented tenant-filtered
// Qdrant points, not vectors. New code must use getTenantPhysicalPointCount().
const getCollectionVectorCount = getTenantPhysicalPointCount;

/**
 * Upserts structured chunks along with their computed embedding vectors into Qdrant.
 */
async function upsertVectors(richChunks, vectors, options = {}) {
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    if (richChunks.length !== vectors.length) {
        throw new Error('عدم تطابق في الطول بين المقاطع والمتجهات المصاحبة.');
    }
    const tenantIds = new Set(richChunks.map(chunk => requireTenantId(chunk.tenantId, 'qdrant-upsert')));
    if (tenantIds.size !== 1) throw new Error('لا يمكن رفع متجهات لأكثر من مستأجر في دفعة واحدة.');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    const points = richChunks.map((chunk, index) => {
        return {
            id: stringToDeterministicUUID(`${chunk.tenantId}:${chunk.chunkId}`),
            vector: vectors[index],
            payload: chunk
        };
    });

    const batchSize = Math.max(1, Math.min(512,
        Number(options.batchSize) || positiveConfig('RAG_QDRANT_UPLOAD_BATCH_SIZE', 64)));
    const uploadedBatchIds = [];
    const totalBatches = Math.ceil(points.length / batchSize);
    for (let start = 0, batch = 1; start < points.length; start += batchSize, batch++) {
        const batchPoints = points.slice(start, start + batchSize);
        const batchStartedAt = performance.now();
        let response;
        try {
            response = await qdrantFetch(
                `${qdrantUrl}/collections/${collectionName}/points?wait=true`,
                {
                    method: 'PUT', headers, signal: options.signal,
                    body: JSON.stringify({ points: batchPoints })
                },
                `رفع دفعة المتجهات ${batch}/${totalBatches}`
            );
        } catch (error) {
            error.failedBatch = batch;
            error.totalBatches = totalBatches;
            error.uploadedBatchIds = uploadedBatchIds;
            throw error;
        }
        if (!response.ok) {
            const error = new RagPermanentError(
                `Qdrant rejected upload batch ${batch}/${totalBatches} (HTTP ${response.status}).`,
                { operation: 'qdrant_upload', code: `RAG_QDRANT_HTTP_${response.status}` }
            );
            error.failedBatch = batch;
            error.totalBatches = totalBatches;
            error.uploadedBatchIds = uploadedBatchIds;
            throw error;
        }
        uploadedBatchIds.push(batchPoints.map(point => point.id));
        metrics.increment('qdrantUploadBatchesTotal');
        console.log(`[RAG Qdrant] Upload batch completed batch=${batch}/${totalBatches} durationMs=${(performance.now() - batchStartedAt).toFixed(1)}`);
    }
    return { success: true, batches: totalBatches, uploadedBatchIds };
}

/**
 * Deletes points (stale vectors) associated with a given document ID using Qdrant filters.
 */
async function deleteVectorsByDocument(tenantId, documentId, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-delete-document');
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    const body = {
        filter: {
            must: [
                { key: 'tenantId', match: { value: tenantId } },
                {
                    key: 'documentId',
                    match: { value: documentId }
                }
            ]
        }
    };

    const response = await qdrantFetch(`${qdrantUrl}/collections/${collectionName}/points/delete?wait=true`, {
        method: 'POST',
        headers,
        signal: options.signal,
        body: JSON.stringify(body)
    }, 'حذف المتجهات');

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`فشل حذف المتجهات من Qdrant: ${response.status} - ${errText}`);
    }

    return true;
}

async function deleteVectorsByIndexVersion(tenantId, indexVersionId, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-delete-index-version');
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['api-key'] = apiKey;
    const response = await qdrantFetch(`${qdrantUrl}/collections/${collectionName}/points/delete?wait=true`, {
        method: 'POST',
        headers,
        signal: options.signal,
        body: JSON.stringify({
            filter: { must: [
                { key: 'tenantId', match: { value: tenantId } },
                { key: 'indexVersionId', match: { value: indexVersionId } }
            ] }
        })
    }, 'حذف نسخة الفهرس');
    if (!response.ok) {
        throw new Error(`فشل حذف نسخة متجهات Qdrant: ${response.status} - ${await response.text()}`);
    }
    return true;
}

async function setIndexVersionLifecycle(tenantId, indexVersionId, lifecycle, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-update-index-version');
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['api-key'] = apiKey;
    const response = await qdrantFetch(`${qdrantUrl}/collections/${collectionName}/points/payload?wait=true`, {
        method: 'POST',
        headers,
        signal: options.signal,
        body: JSON.stringify({
            payload: { lifecycle },
            filter: { must: [
                { key: 'tenantId', match: { value: tenantId } },
                { key: 'indexVersionId', match: { value: indexVersionId } }
            ] }
        })
    }, 'تفعيل نسخة الفهرس');
    if (!response.ok) throw new Error(`فشل تفعيل نسخة Qdrant: ${response.status} - ${await response.text()}`);
    return true;
}

async function getPointsByIndexVersion(tenantId, indexVersionId, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-scroll-index-version');
    return collectFilteredPoints({ must: [
        { key: 'tenantId', match: { value: tenantId } },
        { key: 'indexVersionId', match: { value: indexVersionId } }
    ] }, { ...options, withVector: true });
}

async function queryIndexVersion(vector, indexVersionId, tenantId, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-query-index-version');
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['api-key'] = apiKey;
    const response = await qdrantFetch(`${qdrantUrl}/collections/${collectionName}/points/search`, {
        method: 'POST',
        headers,
        signal: options.signal,
        body: JSON.stringify({
            vector,
            limit: 1,
            filter: {
                must: [
                    { key: 'indexVersionId', match: { value: indexVersionId } },
                    { key: 'tenantId', match: { value: tenantId } }
                ]
            },
            with_payload: true
        })
    }, 'استعلام التحقق');
    if (!response.ok) throw new Error(`فشل استعلام تحقق Qdrant: ${response.status} - ${await response.text()}`);
    return (await response.json()).result || [];
}

async function setDocumentVectorsLifecycle(tenantId, documentId, lifecycle, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-update-document');
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['api-key'] = apiKey;
    const response = await qdrantFetch(`${qdrantUrl}/collections/${collectionName}/points/payload?wait=true`, {
        method: 'POST',
        headers,
        signal: options.signal,
        body: JSON.stringify({
            payload: { lifecycle },
            filter: {
                must: [
                    { key: 'tenantId', match: { value: tenantId } },
                    { key: 'documentId', match: { value: documentId } }
                ]
            }
        })
    }, 'تحديث دورة حياة متجهات المستند');
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`فشل تحديث دورة حياة متجهات Qdrant: ${response.status} - ${text}`);
    }
    return true;
}

async function getPointsByIds(tenantId, ids, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-get-points-by-id');
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    const uuids = ids.map(id => stringToDeterministicUUID(`${tenantId}:${id}`));

    try {
        const response = await qdrantFetch(`${qdrantUrl}/collections/${collectionName}/points/scroll`, {
            method: 'POST',
            headers,
            signal: options.signal,
            body: JSON.stringify({
                filter: {
                    must: [
                        { key: 'tenantId', match: { value: tenantId } },
                        { has_id: uuids }
                    ]
                },
                limit: uuids.length,
                with_payload: true,
                with_vector: false
            })
        }, 'جلب النقاط بالمعرف');

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        return (data.result?.points || []).filter(point => point.payload?.tenantId === tenantId);
    } catch (e) { throw e; }
}

async function getPointsByDocument(tenantId, documentId, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-scroll-document');
    return collectFilteredPoints({ must: [
        { key: 'tenantId', match: { value: tenantId } },
        { key: 'documentId', match: { value: documentId } }
    ] }, { ...options, withVector: true });
}

async function restoreVectors(tenantId, points, options = {}) {
    tenantId = requireTenantId(tenantId, 'qdrant-restore-vectors');
    if (!points || points.length === 0) return true;
    if (points.some(point => point.payload?.tenantId !== tenantId)) {
        throw new Error('رفض استعادة متجهات لا يملكها المستأجر.');
    }

    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    const batchSize = Math.max(1, Math.min(512,
        Number(options.batchSize) || positiveConfig('RAG_QDRANT_UPLOAD_BATCH_SIZE', 64)));
    for (let start = 0; start < points.length; start += batchSize) {
        const response = await qdrantFetch(
            `${qdrantUrl}/collections/${collectionName}/points?wait=true`,
            {
                method: 'PUT', headers, signal: options.signal,
                body: JSON.stringify({ points: points.slice(start, start + batchSize) })
            },
            'استعادة دفعة متجهات المستند'
        );
        if (!response.ok) return false;
        metrics.increment('qdrantUploadBatchesTotal');
    }
    return true;
}

module.exports = {
    stringToDeterministicUUID,
    checkQdrantReady,
    initCollection,
    getCollectionVectorCount,
    getTenantPhysicalPointCount,
    countDocumentVersionPoints,
    exactVersionFilter,
    upsertVectors,
    deleteVectorsByDocument,
    getPointsByIds,
    getPointsByDocument,
    restoreVectors,
    setDocumentVectorsLifecycle,
    deleteVectorsByIndexVersion,
    setIndexVersionLifecycle,
    getPointsByIndexVersion,
    queryIndexVersion,
    getCollectionStats,
    scrollTenantPointsPage,
    scrollUnownedPointsPage,
    deleteTenantPointsByIds,
    searchPoints,
    countPoints
};
