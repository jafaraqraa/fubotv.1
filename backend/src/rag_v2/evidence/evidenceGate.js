'use strict';

const CLASSIFICATION = Object.freeze({ SUFFICIENT: 'SUFFICIENT', PARTIALLY_SUFFICIENT: 'PARTIALLY_SUFFICIENT', AMBIGUOUS: 'AMBIGUOUS', CONFLICTING: 'CONFLICTING', INSUFFICIENT: 'INSUFFICIENT', UNAUTHORIZED: 'UNAUTHORIZED' });

function decideEvidence(input) {
    if (input.authorizationDenied) return { classification: CLASSIFICATION.UNAUTHORIZED, reason: 'authorization_denied' };
    if (input.ambiguous) return { classification: CLASSIFICATION.AMBIGUOUS, reason: 'focused_clarification_required' };
    if (input.conflicts?.length) return { classification: CLASSIFICATION.CONFLICTING, reason: 'active_authoritative_sources_conflict', conflicts: input.conflicts };
    const evidence = input.candidates || []; const covered = new Set(evidence.flatMap(x => x.coveredComponents || []));
    const required = new Set(input.questionComponents || []); const coverage = required.size ? [...required].filter(x => covered.has(x)).length / required.size : (evidence.length ? 1 : 0);
    const independent = new Set(evidence.map(x => x.documentVersionId)).size;
    const hybridAgreement = evidence.some(x => new Set(x.retrievalSources || []).size >= 2);
    if (!evidence.length || coverage === 0) return { classification: CLASSIFICATION.INSUFFICIENT, reason: 'no_supported_component', coverage };
    if (coverage < 1) return { classification: CLASSIFICATION.PARTIALLY_SUFFICIENT, reason: 'partial_component_coverage', coverage };
    if (!hybridAgreement && independent < 2 && input.exactValueRequired && !input.exactValuePresent) return { classification: CLASSIFICATION.INSUFFICIENT, reason: 'exact_value_not_verified', coverage };
    return { classification: CLASSIFICATION.SUFFICIENT, reason: hybridAgreement ? 'hybrid_agreement' : 'component_coverage', coverage, independentSources: independent };
}

module.exports = { CLASSIFICATION, decideEvidence };
