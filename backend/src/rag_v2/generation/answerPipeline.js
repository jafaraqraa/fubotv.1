'use strict';

const { routeQuery } = require('../query_understanding/queryRouter');
const { encodeSparse } = require('../embeddings/sparseEncoder');
const { buildContext } = require('../context/contextBuilder');
const { decideEvidence, CLASSIFICATION } = require('../evidence/evidenceGate');
const { verifyClaims } = require('../verification/claimVerifier');
const { deriveConversationStyle } = require('./conversationStyle');

function formatCustomerAnswer(value) {
    return String(value || '').trim()
        .replace(/متوفر(ة)?\s+كوحدة/gu, (_match, feminine) => `معروض${feminine || ''} كوحدة`)
        .replace(/(?:غير متوفرة?|مش متوفرة?) في (?:قاعدة المعرفة|البيانات(?: المتوفرة)?)/gu, 'مش محدّث بشكل مباشر عنا')
        .replace(/لا يمكن(?:ني)? تأكيد/gu, 'ما بنقدر نأكد')
        .replace(/\s+([,.!؟])/gu, '$1');
}

class AnswerPipeline {
    constructor({ retriever, generator, verifier = null, config }) { Object.assign(this, { retriever, generator, verifier, config }); }
    async runGeneration(request) {
        if (typeof this.generator.generateGrounded === 'function') {
            return this.generator.generateGrounded(request);
        }
        return { response: await this.generator.generate(request), metadata: null, provider: null };
    }
    async runVerification(response, selected) {
        return this.verifier?.verifyClaims
            ? this.verifier.verifyClaims({ response, selected })
            : verifyClaims(response, selected);
    }
    async answer({ question, history = [], scope, signal }) {
        const route = routeQuery(question, history);
        if (route.decision === 'reject') return { decision: 'abstain', answer: 'آسف، ما بقدر أساعد بهاد الطلب.', route };
        if (route.decision === 'clarify') return { decision: 'clarify', answer: 'أكيد، بس شو المنتج أو الخدمة اللي بتقصدها؟', route };
        if (route.decision === 'casual') return { decision: 'casual', answer: question, route };
        const retrieval = await this.retriever.retrieve({ originalQuestion: route.isFollowUp ? route.standaloneQuestion : question, standaloneQuestion: route.standaloneQuestion,
            scope, sparseVector: encodeSparse(route.standaloneQuestion), signal });
        const bestRerankerScore = retrieval.reranked?.[0]?.rerankerScore;
        const scoreWindow = Number.isFinite(this.config.rerankerScoreWindow) ? this.config.rerankerScoreWindow : 0.18;
        const dynamicFloor = Number.isFinite(bestRerankerScore)
            ? Math.max(this.config.minimumRerankerScore, bestRerankerScore - scoreWindow)
            : this.config.minimumRerankerScore;
        const topSection = retrieval.reranked?.[0]?.sectionPath?.[0] || null;
        const eligibleEvidence = (retrieval.reranked || []).filter(candidate =>
            !Number.isFinite(candidate.rerankerScore)
            || candidate.rerankerScore >= dynamicFloor).filter(candidate =>
                !route.isFollowUp || !topSection || candidate.sectionPath?.[0] === topSection);
        const context = buildContext(eligibleEvidence, this.config);
        const gate = decideEvidence({ candidates: context.selected });
        if ([CLASSIFICATION.INSUFFICIENT, CLASSIFICATION.UNAUTHORIZED].includes(gate.classification)) {
            return { decision: 'abstain', answer: 'ما عندي معلومة مؤكدة عن هاد الموضوع حالياً.', route, gate, retrieval, context };
        }
        const groundedQuestion = route.isFollowUp ? route.standaloneQuestion : question;
        const style = deriveConversationStyle(question, history);
        let generation = await this.runGeneration({ question: groundedQuestion, context: context.text, sourceIds: context.selected.map(x => x.sourceId), style, signal });
        let response = generation.response;
        if (['abstain', 'clarify'].includes(response.decision)) {
            response = { ...response, claims: [], citations: [] };
        }
        let verification = await this.runVerification(response, context.selected);
        if (!verification.valid) {
            generation = await this.runGeneration({ question: groundedQuestion, context: context.text, sourceIds: context.selected.map(x => x.sourceId), style, signal,
                verifierFeedback: verification.errors.join('; ') });
            response = generation.response;
            if (['abstain', 'clarify'].includes(response.decision)) response = { ...response, claims: [], citations: [] };
            verification = await this.runVerification(response, context.selected);
        }
        if (!verification.valid) return { decision: 'abstain', answer: 'ما بقدر أعطيك جواب مؤكد عن هاد الموضوع حالياً.', route, gate, verification, retrieval, context };
        return { ...response, answer: formatCustomerAnswer(response.answer), route, gate, verification, retrieval, context,
            generation: { metadata: generation.metadata || null, provider: generation.provider || null } };
    }
}

module.exports = { AnswerPipeline, formatCustomerAnswer };
