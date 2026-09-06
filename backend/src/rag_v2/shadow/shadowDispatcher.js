'use strict';

class ShadowDispatcher {
    constructor({ implementation = 'legacy', legacy, v2, record = () => {}, onError = () => {} }) {
        Object.assign(this, { implementation, legacy, v2, record, onError });
    }
    async execute(request) {
        const legacyStarted = performance.now(); const legacyAnswer = await this.legacy(request);
        if (this.implementation !== 'shadow') return legacyAnswer;
        Promise.resolve().then(async () => {
            const started = performance.now();
            try { const v2Answer = await this.v2({ ...request, shadow: true });
                await this.record({ requestId: request.requestId, legacy: legacyAnswer, v2: v2Answer,
                    legacyLatencyMs: started - legacyStarted, v2LatencyMs: performance.now() - started });
            } catch (error) { await this.onError({ requestId: request.requestId, code: error.code || 'RAG_V2_SHADOW_FAILED' }); }
        });
        return legacyAnswer;
    }
}

module.exports = { ShadowDispatcher };
