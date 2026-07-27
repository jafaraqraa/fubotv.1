const crypto = require('crypto');
const { getConfig } = require('../config/ragConfig');

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
async function checkQdrantReady() {
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');

    const headers = {};
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    try {
        const response = await fetch(`${qdrantUrl}/readyz`, { headers });
        return response.ok;
    } catch (e) {
        return false;
    }
}

/**
 * Validates or creates the configured collection with a verified vector dimension.
 * cosine similarity is used.
 */
async function initCollection(dimension) {
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    // 1. Check if collection exists
    const checkRes = await fetch(`${qdrantUrl}/collections/${collectionName}`, { headers });

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

    const createRes = await fetch(`${qdrantUrl}/collections/${collectionName}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(createBody)
    });

    if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`فشل إنشاء مجموعة Qdrant: ${createRes.status} - ${errText}`);
    }

    return true;
}

/**
 * Retrieves the total count of vectors currently stored in the configured collection.
 */
async function getCollectionVectorCount() {
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    const headers = {};
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    try {
        const response = await fetch(`${qdrantUrl}/collections/${collectionName}`, { headers });
        if (!response.ok) return 0;

        const data = await response.json();
        return data.result && data.result.vectors_count ? data.result.vectors_count : 0;
    } catch (e) {
        return 0;
    }
}

/**
 * Upserts structured chunks along with their computed embedding vectors into Qdrant.
 */
async function upsertVectors(richChunks, vectors) {
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    if (richChunks.length !== vectors.length) {
        throw new Error('عدم تطابق في الطول بين المقاطع والمتجهات المصاحبة.');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    const points = richChunks.map((chunk, index) => {
        return {
            id: stringToDeterministicUUID(chunk.chunkId),
            vector: vectors[index],
            payload: chunk
        };
    });

    const response = await fetch(`${qdrantUrl}/collections/${collectionName}/points?wait=true`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ points })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`فشل تخزين متجهات Qdrant: ${response.status} - ${errText}`);
    }

    return true;
}

/**
 * Deletes points (stale vectors) associated with a given document ID using Qdrant filters.
 */
async function deleteVectorsByDocument(documentId) {
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
                {
                    key: 'documentId',
                    match: { value: documentId }
                }
            ]
        }
    };

    const response = await fetch(`${qdrantUrl}/collections/${collectionName}/points/delete?wait=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`فشل حذف المتجهات من Qdrant: ${response.status} - ${errText}`);
    }

    return true;
}

async function getPointsByIds(ids) {
    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    const uuids = ids.map(id => stringToDeterministicUUID(id));

    try {
        const response = await fetch(`${qdrantUrl}/collections/${collectionName}/points`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ids: uuids })
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        return data.result || [];
    } catch (e) {
        return [];
    }
}

async function getPointsByDocument(documentId) {
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
                {
                    key: 'documentId',
                    match: { value: documentId }
                }
            ]
        },
        limit: 1000,
        with_payload: true,
        with_vector: true
    };

    try {
        const response = await fetch(`${qdrantUrl}/collections/${collectionName}/points/scroll`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) return [];

        const data = await response.json();
        return data.result && data.result.points ? data.result.points : [];
    } catch (e) {
        console.error('Failed to scroll points by document:', e.message);
        return [];
    }
}

async function restoreVectors(points) {
    if (!points || points.length === 0) return true;

    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    const response = await fetch(`${qdrantUrl}/collections/${collectionName}/points?wait=true`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ points })
    });

    return response.ok;
}

module.exports = {
    stringToDeterministicUUID,
    checkQdrantReady,
    initCollection,
    getCollectionVectorCount,
    upsertVectors,
    deleteVectorsByDocument,
    getPointsByIds,
    getPointsByDocument,
    restoreVectors
};
