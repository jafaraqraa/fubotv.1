const { getConfig, validateSetting, validateAllSettings } = require('./config/ragConfig');
const { reindexKnowledgeBase, isIndexingRunning, getIndexingState } = require('./indexing/knowledgeIndexingService');
const { getRAGSystemStatus } = require('./services/ragHealthService');
const { normalizeArabic } = require('./processing/arabicNormalizer');
const { cleanText } = require('./processing/textCleaner');
const { chunkDocument } = require('./processing/documentChunker');
const { getPointsByIds } = require('./vector/qdrantVectorStore');

module.exports = {
    getConfig,
    validateSetting,
    validateAllSettings,
    reindexKnowledgeBase,
    isIndexingRunning,
    getIndexingState,
    getRAGSystemStatus,
    normalizeArabic,
    cleanText,
    chunkDocument,
    getPointsByIds
};
