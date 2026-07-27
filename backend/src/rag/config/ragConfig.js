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
    RAG_LEGACY_FALLBACK: 'true',
    QDRANT_URL: 'http://127.0.0.1:6333',
    QDRANT_API_KEY: '',
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    RAG_EMBEDDING_TIMEOUT_MS: 30000,
    // Part 2 configurable settings defaults
    RAG_MIN_TOP_K: 3,
    RAG_DEFAULT_TOP_K: 5,
    RAG_MAX_TOP_K: 7,
    RAG_CANDIDATE_MULTIPLIER: 3,
    RAG_SEMANTIC_WEIGHT: 0.80,
    RAG_KEYWORD_WEIGHT: 0.20,
    RAG_SIMILARITY_THRESHOLD: 0.40,
    RAG_NEIGHBOR_EXPANSION: 'false',
    RAG_CONTEXT_BUDGET: 3000
};

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
        case 'RAG_LEGACY_FALLBACK':
        case 'RAG_NEIGHBOR_EXPANSION': {
            const str = String(value).toLowerCase();
            if (str !== 'true' && str !== 'false' && str !== '1' && str !== '0') {
                return { valid: false, error: 'القيمة يجب أن تكون منطقية (مفعل/معطل).' };
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
    validateAllSettings
};
