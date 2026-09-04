function isKnowledgeOperation(requestPath) {
    const normalized = `/${String(requestPath || '').replace(/^\/+/, '')}`;
    return /^\/(?:rag\/)?documents(?:\/|$)/.test(normalized)
        || /^\/(?:rag\/)?reindex\/?$/.test(normalized)
        || /^\/(?:rag\/)?reconciliation\/reindex\/?$/.test(normalized);
}

module.exports = { isKnowledgeOperation };
