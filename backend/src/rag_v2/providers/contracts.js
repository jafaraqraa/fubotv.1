'use strict';

class EmbeddingProvider {
    async embed(_input, _options) { throw new Error('EmbeddingProvider.embed must be implemented'); }
    async probeDimensions(_options) { throw new Error('EmbeddingProvider.probeDimensions must be implemented'); }
}
class RerankerProvider {
    async rerank(_request) { throw new Error('RerankerProvider.rerank must be implemented'); }
}
class GroundedGeneratorProvider {
    async generateGrounded(_request) { throw new Error('GroundedGeneratorProvider.generateGrounded must be implemented'); }
}
class ClaimVerifierProvider {
    async verifyClaims(_request) { throw new Error('ClaimVerifierProvider.verifyClaims must be implemented'); }
}

module.exports = { EmbeddingProvider, RerankerProvider, GroundedGeneratorProvider, ClaimVerifierProvider };
