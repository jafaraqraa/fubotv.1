'use strict';

const db = require('../../database/connection');
const { createRagV2Runtime } = require('..');
const { loadRagV2Config } = require('../config/ragV2Config');
const { TaskRerankerProvider } = require('../providers/rerankerProvider');
const { TaskGroundedGeneratorProvider } = require('../providers/groundedGeneratorProvider');
const { DeterministicClaimVerifierProvider } = require('../providers/claimVerifierProvider');

const KNOWLEDGE_BASE_ID = 'default';
let cached;

function getProductionRuntime() {
    const config = loadRagV2Config();
    if (config.implementation !== 'v2') {
        const error = new Error('RAG v2 production runtime is not enabled');
        error.code = 'RAG_V2_NOT_ENABLED';
        throw error;
    }
    if (!cached) cached = createRagV2Runtime({
        db,
        config,
        reranker: new TaskRerankerProvider(),
        generator: new TaskGroundedGeneratorProvider(),
        verifier: new DeterministicClaimVerifierProvider()
    });
    return cached;
}

async function answerWithRagV2({ question, history, tenantId, signal }) {
    const runtime = getProductionRuntime();
    const result = await runtime.answers.answer({
        question,
        history,
        scope: { tenantId, knowledgeBaseId: KNOWLEDGE_BASE_ID, permissionIds: [] },
        signal
    });
    return result;
}

module.exports = { KNOWLEDGE_BASE_ID, getProductionRuntime, answerWithRagV2 };
