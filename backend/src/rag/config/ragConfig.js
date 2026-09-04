const path = require('path');
// Attempt to require settings repository to provide live settings from SQLite database
let settingsRepo;
try {
    settingsRepo = require('../../database/repositories/settingsRepository');
} catch (e) {
    // Ignore if not resolvable or during early startup testing
}

// Initial defaults
const DEFAULTS = {
    RAG_CHUNK_SIZE: 800,
    RAG_CHUNK_OVERLAP: 120,
    RAG_EMBEDDING_MODEL: 'nomic-embed-text',
    QDRANT_COLLECTION: 'futhing_knowledge',
    RAG_INDEX_ON_STARTUP: 'true',
    RAG_ENABLE_FALLBACK: 'true',
    RAG_ALLOW_RERANK_FALLBACK: 'true',
    RAG_ALLOW_EMBEDDING_PROVIDER_SWITCH: 'false',
    RAG_FAIL_OPEN_ON_VALIDATOR: 'false',
    RAG_FAIL_OPEN_ON_PROMPT_GUARD: 'false',
    RAG_ALLOW_OPEN_DOMAIN: 'false',
    RAG_KNOWLEDGE_BASE_ONLY: 'true',
    RAG_EVIDENCE_GATE_ENABLED: 'true',
    // Grounded business responses fail closed by default. Installations can still
    // opt into shadow mode explicitly for diagnostics.
    RAG_GROUNDING_SAFETY_BOUNDARY_ENABLED: 'true',
    RAG_GROUNDING_SAFETY_BOUNDARY_SHADOW: 'false',
    RAG_GROUNDING_SAFETY_ENFORCEMENT_PERCENT: 100,
    QDRANT_URL: 'http://127.0.0.1:6333',
    QDRANT_API_KEY: '',
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    RAG_EMBEDDING_TIMEOUT_MS: 30000,
    RAG_OLLAMA_EMBED_TIMEOUT_MS: 30000,
    RAG_OLLAMA_HEALTH_TIMEOUT_MS: 5000,
    RAG_EMBEDDING_DIMENSION: 768,
    RAG_QDRANT_SEARCH_TIMEOUT_MS: 10000,
    RAG_QDRANT_UPLOAD_TIMEOUT_MS: 30000,
    RAG_QDRANT_DELETE_TIMEOUT_MS: 15000,
    RAG_QDRANT_COUNT_TIMEOUT_MS: 10000,
    RAG_QDRANT_SCROLL_TIMEOUT_MS: 15000,
    RAG_QDRANT_HEALTH_TIMEOUT_MS: 5000,
    RAG_QDRANT_UPLOAD_BATCH_SIZE: 64,
    RAG_RETRY_MAX_ATTEMPTS: 3,
    RAG_RETRY_BASE_DELAY_MS: 300,
    RAG_RETRY_MAX_DELAY_MS: 3000,
    RAG_MAX_CHUNKS_PER_DOCUMENT: 5000,
    RAG_MAX_FILE_SIZE_BYTES: 10485760,
    RAG_MAX_EXTRACTED_TEXT_LENGTH: 10000000,
    RAG_SHUTDOWN_GRACE_MS: 15000,
    // Part 2 configurable settings defaults
    RAG_MIN_TOP_K: 3,
    RAG_DEFAULT_TOP_K: 5,
    RAG_MAX_TOP_K: 7,
    RAG_CANDIDATE_MULTIPLIER: 3,
    RAG_SEMANTIC_WEIGHT: 0.80,
    RAG_KEYWORD_WEIGHT: 0.20,
    RAG_SIMILARITY_THRESHOLD: 0.40,
    RAG_RETRIEVAL_CACHE_TTL_MS: 300000,
    RAG_RETRIEVAL_CACHE_MAX_ENTRIES: 1000,
    RAG_EMBEDDING_CONCURRENCY: 4,
    RAG_QDRANT_TIMEOUT_MS: 30000,
    RAG_RECONCILIATION_ENABLED: 'false',
    RAG_RECONCILIATION_INTERVAL_HOURS: 24,
    RAG_RECONCILIATION_BATCH_SIZE: 100,
    RAG_RECONCILIATION_MAX_RUNTIME_MS: 30000,
    RAG_RECONCILIATION_LOCK_TTL_MS: 600000,
    RAG_ORPHAN_GRACE_PERIOD_HOURS: 24,
    RAG_NEIGHBOR_EXPANSION: 'false',
    RAG_MULTI_QUERY_ENABLED: 'false',
    RAG_CONTEXT_BUDGET: 3000,
    RAG_INJECTION_GUARD_ENABLED: 'true',
    RAG_INJECTION_BLOCK_HIGH_RISK: 'true',
    RAG_INJECTION_SCAN_ON_INGEST: 'true',
    RAG_INJECTION_SCAN_ON_RETRIEVAL: 'true',
    RAG_INJECTION_MAX_SIGNALS: 20
};

const RUNTIME_LIMITS = {
    RAG_GROUNDING_SAFETY_ENFORCEMENT_PERCENT: [0, 100],
    RAG_OLLAMA_EMBED_TIMEOUT_MS: [100, 300000],
    RAG_OLLAMA_HEALTH_TIMEOUT_MS: [100, 60000],
    RAG_EMBEDDING_DIMENSION: [1, 65536],
    RAG_QDRANT_SEARCH_TIMEOUT_MS: [100, 120000],
    RAG_QDRANT_UPLOAD_TIMEOUT_MS: [100, 300000],
    RAG_QDRANT_DELETE_TIMEOUT_MS: [100, 300000],
    RAG_QDRANT_COUNT_TIMEOUT_MS: [100, 120000],
    RAG_QDRANT_SCROLL_TIMEOUT_MS: [100, 300000],
    RAG_QDRANT_HEALTH_TIMEOUT_MS: [100, 60000],
    RAG_EMBEDDING_CONCURRENCY: [1, 32],
    RAG_QDRANT_UPLOAD_BATCH_SIZE: [1, 512],
    RAG_RETRY_MAX_ATTEMPTS: [1, 10],
    RAG_RETRY_BASE_DELAY_MS: [1, 30000],
    RAG_RETRY_MAX_DELAY_MS: [1, 60000],
    RAG_MAX_CHUNKS_PER_DOCUMENT: [1, 50000],
    RAG_MAX_FILE_SIZE_BYTES: [1024, 104857600],
    RAG_MAX_EXTRACTED_TEXT_LENGTH: [1000, 100000000],
    RAG_SHUTDOWN_GRACE_MS: [100, 120000]
};

function validateRuntimeConfig() {
    const errors = [];
    for (const [key, [min, max]] of Object.entries(RUNTIME_LIMITS)) {
        const value = Number(getConfig(key));
        if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
            errors.push(`${key} must be an integer between ${min} and ${max}.`);
        }
    }
    const base = Number(getConfig('RAG_RETRY_BASE_DELAY_MS'));
    const max = Number(getConfig('RAG_RETRY_MAX_DELAY_MS'));
    if (base > max) errors.push('RAG_RETRY_BASE_DELAY_MS must not exceed RAG_RETRY_MAX_DELAY_MS.');
    if (errors.length) {
        const error = new Error(`[RAG Config] Invalid runtime configuration: ${errors.join(' ')}`);
        error.code = 'RAG_INVALID_RUNTIME_CONFIG';
        throw error;
    }
    return true;
}

/**
 * Retrieves the effective configuration value based on precedence:
 * SQLite Persisted Setting -> process.env (populated from settings or .env) -> Defaults
 */
function getConfig(key) {
    if (settingsRepo && typeof settingsRepo.getSetting === 'function') {
        try {
            const dbVal = settingsRepo.getSetting(key);
            if (dbVal !== undefined && dbVal !== null && dbVal !== '') {
                return dbVal;
            }
        } catch (e) {
            // Fallback if DB table settings doesn't exist yet or connection is inactive
        }
    }
    const val = process.env[key];
    if (val !== undefined && val !== null && val !== '') {
        return val;
    }
    return DEFAULTS[key];
}

/**
 * Validates a single configuration key and value.
 * Returns { valid: boolean, error?: string }
 */
function validateSetting(key, value) {
    if (RUNTIME_LIMITS[key]) {
        const [min, max] = RUNTIME_LIMITS[key];
        const number = Number(value);
        if (!Number.isFinite(number) || !Number.isInteger(number)
            || number < min || number > max) {
            return {
                valid: false,
                error: `${key} must be an integer between ${min} and ${max}.`
            };
        }
        return { valid: true };
    }
    switch (key) {
        case 'RAG_CHUNK_SIZE': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 200 || num > 4000) {
                return { valid: false, error: 'حجم المقطع يجب أن يكون رقماً صحيحاً بين 200 و 4000.' };
            }
            break;
        }
        case 'RAG_CHUNK_OVERLAP': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 0 || num > 1000) {
                return { valid: false, error: 'التداخل يجب أن يكون رقماً صحيحاً بين 0 و 1000.' };
            }
            break;
        }
        case 'RAG_EMBEDDING_MODEL': {
            if (!value || typeof value !== 'string' || value.trim() === '') {
                return { valid: false, error: 'نموذج التضمين لا يمكن أن يكون فارغاً.' };
            }
            if (value.length > 100 || /[\x00-\x1F\x7F]/.test(value)) {
                return { valid: false, error: 'اسم نموذج التضمين غير صالح.' };
            }
            break;
        }
        case 'QDRANT_COLLECTION': {
            if (!value || typeof value !== 'string' || value.trim() === '') {
                return { valid: false, error: 'اسم مجموعة Qdrant لا يمكن أن يكون فارغاً.' };
            }
            if (!/^[a-zA-Z0-9_-]+$/.test(value) || value.length > 100) {
                return { valid: false, error: 'اسم مجموعة Qdrant غير صالح. يجب أن يحتوي فقط على أحرف، أرقام، شرطة سفلية أو شرطة عادية.' };
            }
            break;
        }
        case 'QDRANT_URL':
        case 'OLLAMA_BASE_URL': {
            if (!value || typeof value !== 'string' || value.trim() === '') {
                return { valid: false, error: 'الرابط لا يمكن أن يكون فارغاً.' };
            }
            if (!value.startsWith('http://') && !value.startsWith('https://')) {
                return { valid: false, error: 'الرابط يجب أن يبدأ بـ http:// أو https://' };
            }
            break;
        }
        case 'RAG_INDEX_ON_STARTUP':
        case 'RAG_ENABLE_FALLBACK':
        case 'RAG_ALLOW_RERANK_FALLBACK':
        case 'RAG_ALLOW_EMBEDDING_PROVIDER_SWITCH':
        case 'RAG_FAIL_OPEN_ON_VALIDATOR':
        case 'RAG_FAIL_OPEN_ON_PROMPT_GUARD':
        case 'RAG_ALLOW_OPEN_DOMAIN':
        case 'RAG_KNOWLEDGE_BASE_ONLY':
        case 'RAG_EVIDENCE_GATE_ENABLED':
        case 'RAG_GROUNDING_SAFETY_BOUNDARY_ENABLED':
        case 'RAG_GROUNDING_SAFETY_BOUNDARY_SHADOW':
        case 'RAG_NEIGHBOR_EXPANSION':
        case 'RAG_INJECTION_GUARD_ENABLED':
        case 'RAG_INJECTION_BLOCK_HIGH_RISK':
        case 'RAG_INJECTION_SCAN_ON_INGEST':
        case 'RAG_INJECTION_SCAN_ON_RETRIEVAL': {
            const str = String(value).toLowerCase();
            if (str !== 'true' && str !== 'false' && str !== '1' && str !== '0') {
                return { valid: false, error: 'القيمة يجب أن تكون منطقية (مفعل/معطل).' };
            }
            break;
        }
        case 'RAG_INJECTION_MAX_SIGNALS': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1 || num > 100) {
                return { valid: false, error: 'RAG_INJECTION_MAX_SIGNALS must be between 1 and 100.' };
            }
            break;
        }
        case 'RAG_MIN_TOP_K':
        case 'RAG_DEFAULT_TOP_K':
        case 'RAG_MAX_TOP_K': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1 || num > 50) {
                return { valid: false, error: `${key} يجب أن يكون رقماً صحيحاً بين 1 و 50.` };
            }
            break;
        }
        case 'RAG_RETRIEVAL_CACHE_TTL_MS': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1000 || num > 86400000) {
                return { valid: false, error: 'مدة كاش الاسترجاع يجب أن تكون بين ثانية واحدة و24 ساعة.' };
            }
            break;
        }
        case 'RAG_RETRIEVAL_CACHE_MAX_ENTRIES': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1 || num > 100000) {
                return { valid: false, error: 'الحد الأقصى لكاش الاسترجاع يجب أن يكون بين 1 و100000.' };
            }
            break;
        }
        case 'RAG_EMBEDDING_CONCURRENCY': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1 || num > 16) {
                return { valid: false, error: 'تزامن إنشاء المتجهات يجب أن يكون بين 1 و16.' };
            }
            break;
        }
        case 'RAG_QDRANT_TIMEOUT_MS': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1000 || num > 120000) {
                return { valid: false, error: 'مهلة Qdrant يجب أن تكون بين ثانية واحدة ودقيقتين.' };
            }
            break;
        }
        case 'RAG_CANDIDATE_MULTIPLIER': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1 || num > 20) {
                return { valid: false, error: 'مضاعف المرشحين يجب أن يكون رقماً صحيحاً بين 1 و 20.' };
            }
            break;
        }
        case 'RAG_SEMANTIC_WEIGHT':
        case 'RAG_KEYWORD_WEIGHT': {
            const num = parseFloat(value);
            if (isNaN(num) || num < 0 || num > 1) {
                return { valid: false, error: 'الوزن يجب أن يكون قيمة عشرية بين 0.0 و 1.0.' };
            }
            break;
        }
        case 'RAG_SIMILARITY_THRESHOLD': {
            const num = parseFloat(value);
            if (isNaN(num) || num < 0.0 || num > 1.0) {
                return { valid: false, error: 'حد التشابه يجب أن يكون قيمة عشرية بين 0.0 و 1.0.' };
            }
            break;
        }
        case 'RAG_CONTEXT_BUDGET': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 500 || num > 50000) {
                return { valid: false, error: 'ميزانية السياق القصوى يجب أن تكون رقماً بين 500 و 50000 حرف.' };
            }
            break;
        }
    }
    return { valid: true };
}

/**
 * Validates cross-dependent settings (e.g. overlap < chunk size, weights add up to 1.0)
 */
function validateAllSettings(settings) {
    const chunkSize = parseInt(settings.RAG_CHUNK_SIZE, 10);
    const chunkOverlap = parseInt(settings.RAG_CHUNK_OVERLAP, 10);

    if (!isNaN(chunkSize) && !isNaN(chunkOverlap)) {
        if (chunkOverlap >= chunkSize) {
            return { valid: false, error: 'يجب أن يكون تداخل المقاطع أصغر من حجم المقطع نفسه.' };
        }
    }

    const semWeight = parseFloat(settings.RAG_SEMANTIC_WEIGHT !== undefined ? settings.RAG_SEMANTIC_WEIGHT : getConfig('RAG_SEMANTIC_WEIGHT'));
    const keyWeight = parseFloat(settings.RAG_KEYWORD_WEIGHT !== undefined ? settings.RAG_KEYWORD_WEIGHT : getConfig('RAG_KEYWORD_WEIGHT'));
    if (!isNaN(semWeight) && !isNaN(keyWeight)) {
        const sum = semWeight + keyWeight;
        if (Math.abs(sum - 1.0) > 0.01) {
            return { valid: false, error: 'مجموع وزن البحث الدلالي ووزن البحث بالكلمات يجب أن يساوي 1.0 تقريباً.' };
        }
    }

    const minK = parseInt(settings.RAG_MIN_TOP_K !== undefined ? settings.RAG_MIN_TOP_K : getConfig('RAG_MIN_TOP_K'), 10);
    const defK = parseInt(settings.RAG_DEFAULT_TOP_K !== undefined ? settings.RAG_DEFAULT_TOP_K : getConfig('RAG_DEFAULT_TOP_K'), 10);
    const maxK = parseInt(settings.RAG_MAX_TOP_K !== undefined ? settings.RAG_MAX_TOP_K : getConfig('RAG_MAX_TOP_K'), 10);

    if (!isNaN(minK) && !isNaN(defK) && !isNaN(maxK)) {
        if (minK > defK || defK > maxK) {
            return { valid: false, error: 'يجب أن يكون الحد الأدنى لـ Top-K أصغر من أو يساوي القيمة الافتراضية، والافتراضية أصغر من أو تساوي الحد الأعلى.' };
        }
    }

    return { valid: true };
}

module.exports = {
    DEFAULTS,
    getConfig,
    validateSetting,
    validateAllSettings,
    validateRuntimeConfig,
    RUNTIME_LIMITS
};
