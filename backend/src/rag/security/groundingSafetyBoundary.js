const { performance } = require('perf_hooks');
const crypto = require('crypto');

const DECISION = Object.freeze({ ALLOW: 'ALLOW', BLOCK: 'BLOCK', PARTIAL: 'PARTIAL' });
const SAFE_FALLBACK = 'لا تتوفر لدي معلومات مؤكدة حول هذا الموضوع حالياً. يمكنك التواصل مع فريق الدعم للحصول على التفاصيل.';
const TECHNICAL_FALLBACK = "I couldn't verify this information from the available knowledge.";
const CURRENT_MARKER = /(?:^|\s)(?:اليوم|حاليا|الان|هسا|هسه|هلا|هلق|currently|today|now)(?:\s|$)|(?:حالي|حاليه|current|active)/iu;
const NEGATION_MARKER = /(?:^|\s)(?:لا|ولا|ليس|ليست|غير|لن|لم|بدون|مغلق|مغلقه|غير\s+متوفر|غير\s+متاح|لا\s+يوجد|لا\s+توجد|not|never|none|unavailable|closed)(?:\s|$)/iu;
const EXCLUSIVE_MARKER = /(?:^|\s)(?:فقط|الوحيد|الوحيده|حصرا|كل|جميع|مره\s+واحده|لا\s+غير|only|sole|all|every|once|no\s+other)(?:\s|$)/iu;
const COMPLETENESS_MARKER = /(?:^|\s)(?:فقط|الوحيد|الوحيده|حصرا|جميع|كل|كامل|كامله|الكامل|الكامله|ايام\s+العمل|لا\s+يوجد|لا\s+توجد|only|sole|all|every|complete|no\s+other)(?:\s|$)/iu;
const WEEKDAYS = new Set(['الاحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس', 'الجمعه', 'السبت']);
const LOCATION_QUERY = /(?:فرع|فروع|معرض|موقع|عنوان)/u;

function enforcementBucket(tenantId, conversationId) {
    const stableId = `${String(tenantId || '')}:${String(conversationId || '')}`;
    const digest = crypto.createHash('sha256').update(stableId).digest();
    return digest.readUInt32BE(0) % 100;
}

function enforcementAssignment({ tenantId, conversationId, percent = 0, shadowMode = true }) {
    const boundedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
    const bucket = enforcementBucket(tenantId, conversationId);
    return {
        bucket,
        percent: boundedPercent,
        enforced: shadowMode !== true && boundedPercent > 0 && bucket < boundedPercent
    };
}

function normalize(text) {
    return String(text || '').normalize('NFKC').toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي').replace(/ة/g, 'ه')
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[^\p{L}\p{N}%]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function evidenceId(item) {
    return String(item?.chunkId || item?.id || item?.payload?.chunkId || '').trim();
}

function evidenceTenant(item) {
    const value = item?.tenantId ?? item?.payload?.tenantId;
    return value == null ? '' : String(value).trim();
}

function evidenceText(item) {
    return String(item?.text || item?.content || item?.payload?.text || '');
}

function evidenceTemporalProof(item) {
    const meta = { ...(item?.payload || {}), ...(item?.metadata || {}), ...(item || {}) };
    return meta.temporalValid === true || meta.currentValid === true
        || Boolean(meta.validFrom || meta.validTo || meta.startDate || meta.endDate)
        || explicitCurrentDateRange(evidenceText(item));
}

function explicitCurrentDateRange(text, now = new Date()) {
    const normalized = normalize(text);
    const monthNumbers = new Map([
        ['يناير', 0], ['كانون الاول', 0], ['فبراير', 1], ['شباط', 1],
        ['مارس', 2], ['اذار', 2], ['ابريل', 3], ['نيسان', 3],
        ['مايو', 4], ['ايار', 4], ['يونيو', 5], ['حزيران', 5],
        ['يوليو', 6], ['تموز', 6], ['اغسطس', 7], ['اب', 7],
        ['سبتمبر', 8], ['ايلول', 8], ['اكتوبر', 9], ['تشرين الاول', 9],
        ['نوفمبر', 10], ['تشرين الثاني', 10], ['ديسمبر', 11], ['كانون الثاني', 11]
    ]);
    const monthPattern = [...monthNumbers.keys()].sort((a, b) => b.length - a.length).join('|');
    const match = normalized.match(new RegExp(
        `(?:ساري|صالح|فعال)\\s+من\\s+(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})\\s+حتي\\s+(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})`, 'u'
    ));
    if (!match) return false;
    const start = new Date(Number(match[3]), monthNumbers.get(match[2]), Number(match[1]), 0, 0, 0, 0);
    const end = new Date(Number(match[6]), monthNumbers.get(match[5]), Number(match[4]), 23, 59, 59, 999);
    const nowMs = now instanceof Date ? now.getTime() : Number(now);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
        && Number.isFinite(nowMs) && nowMs >= start.getTime() && nowMs <= end.getTime();
}

function explicitScopeTokens(question) {
    const normalized = normalize(question);
    const tokens = normalized.split(/\s+/);
    const days = tokens.filter(token => WEEKDAYS.has(token));
    const locations = [];
    if (LOCATION_QUERY.test(normalized)) {
        for (let index = 0; index < tokens.length; index++) {
            if (tokens[index] === 'في' && tokens[index + 1]) locations.push(tokens[index + 1]);
            const nearbyLocationMarker = tokens.slice(Math.max(0, index - 2), index)
                .some(token => LOCATION_QUERY.test(token));
            if (/^ب[\u0621-\u064A]{3,}$/u.test(tokens[index])
                && nearbyLocationMarker
                && !/^(?:بدي|بسعر|بفرع)$/u.test(tokens[index])) {
                locations.push(tokens[index].slice(1));
            }
        }
    }
    return [...new Set([...days, ...locations])];
}

function relevancePass(question, claim, matchedEvidence) {
    const anchors = explicitScopeTokens(question);
    if (!anchors.length) return true;
    const haystack = normalize(`${claim} ${matchedEvidence}`);
    const dayAnchors = anchors.filter(anchor => WEEKDAYS.has(anchor));
    const locationAnchors = anchors.filter(anchor => !WEEKDAYS.has(anchor));
    const discussesDayScope = [...WEEKDAYS].some(day => haystack.includes(day))
        || /(?:دعم|دوام|ساعات|متاح|مغلق|support|hours|available|closed)/u.test(haystack);
    const discussesLocationScope = LOCATION_QUERY.test(haystack);
    if (dayAnchors.length && discussesDayScope
        && !dayAnchors.every(anchor => haystack.includes(anchor))) return false;
    if (locationAnchors.length && discussesLocationScope
        && !locationAnchors.every(anchor => haystack.includes(anchor))) return false;
    return true;
}

function claimSurvivesDelivery(claim, deliveredAnswer) {
    const delivered = normalize(deliveredAnswer);
    if (!delivered) return false;
    const candidates = [claim.sourceText, claim.propositionText, claim.text]
        .map(normalize).filter(Boolean);
    return candidates.some(candidate => delivered.includes(candidate)
        || (candidate.length >= 18 && candidate.split(/\s+/)
            .filter(token => token.length > 2)
            .filter(token => delivered.includes(token)).length
            / Math.max(1, candidate.split(/\s+/).filter(token => token.length > 2).length) >= 0.7));
}

function explicitNegationPass(claimText, evidence, numericSafety = 'NOT_APPLICABLE') {
    const claim = normalize(claimText);
    const source = normalize(evidence);
    const claimNegative = NEGATION_MARKER.test(claim);
    const claimExclusive = EXCLUSIVE_MARKER.test(claim);
    if (!claimNegative && !claimExclusive) return true;
    if (claimNegative && !NEGATION_MARKER.test(source) && !COMPLETENESS_MARKER.test(source)) return false;
    const numericUpperBoundEmphasis = numericSafety === 'PASS'
        && /(?:^|\s)(?:حتي|الي)(?:\s|$)/u.test(claim)
        && /(?:^|\s)فقط$/u.test(claim);
    if (claimExclusive && !EXCLUSIVE_MARKER.test(source) && !numericUpperBoundEmphasis) return false;
    return !claimNegative || COMPLETENESS_MARKER.test(source) || NEGATION_MARKER.test(source);
}

function telemetryFrom(result, input, startedAt) {
    const claims = result.claimResults || [];
    const countReason = reason => claims.filter(claim => claim.reasons.includes(reason)).length;
    return {
        tenantId: input.tenantId,
        route: input.route || null,
        boundaryEnabled: true,
        shadowMode: input.shadowMode === true,
        boundaryDecision: result.decision,
        boundaryReasons: result.reasons,
        claimCount: claims.length,
        allowedClaimCount: claims.filter(claim => claim.finalDecision === DECISION.ALLOW).length,
        blockedClaimCount: claims.filter(claim => claim.finalDecision === DECISION.BLOCK).length,
        unknownEvidenceIdCount: countReason('UNKNOWN_EVIDENCE_ID'),
        missingTenantEvidenceCount: countReason('MISSING_EVIDENCE_TENANT'),
        tenantMismatchCount: countReason('EVIDENCE_TENANT_MISMATCH'),
        numericBlockCount: countReason('NUMERIC_NOT_EXPLICITLY_SUPPORTED'),
        temporalBlockCount: countReason('TEMPORAL_PROOF_MISSING'),
        negationBlockCount: countReason('NEGATION_OR_EXCLUSIVITY_NOT_EXPLICIT'),
        nonresponsiveBlockCount: countReason('SUPPORTED_BUT_NONRESPONSIVE'),
        processingErrorCount: result.processingError ? 1 : 0,
        durationMs: Number((performance.now() - startedAt).toFixed(3))
    };
}

function evaluateGroundingSafety(input) {
    const startedAt = performance.now();
    if (input.upstreamDecision === 'CLARIFY') {
        const result = {
            decision: DECISION.BLOCK,
            reasons: ['UPSTREAM_CLARIFY'],
            claimResults: []
        };
        result.telemetry = telemetryFrom(result, input, startedAt);
        return result;
    }
    const serverEvidence = Array.isArray(input.serverEvidence) ? input.serverEvidence : [];
    const evidenceMap = new Map(serverEvidence.map(item => [evidenceId(item), item]).filter(([id]) => id));
    const businessRoute = input.route === 'COMPANY_KNOWLEDGE';
    const candidateTenantMismatch = serverEvidence.some(item => {
        const owner = evidenceTenant(item);
        return owner && owner !== String(input.tenantId);
    });
    const removedClaims = [];
    const validatorClaims = Array.isArray(input.validation?.claims)
        ? input.validation.claims.filter(claim => {
            if (claim?.factual === false) return false;
            const survives = claimSurvivesDelivery(claim, input.answer);
            if (!survives) removedClaims.push({
                claimText: claim?.propositionText || claim?.text || '',
                validatorSupport: claim?.classification || claim?.finalClassification || 'UNKNOWN'
            });
            return survives;
        }) : [];

    const claimResults = validatorClaims.map(claim => {
        const ids = [...new Set(claim.evidenceChunkIds || claim.evidenceIds || [])].map(String);
        const reasons = [];
        if (claim.classification !== 'SUPPORTED' && claim.finalClassification !== 'SUPPORTED') {
            reasons.push('UNSUPPORTED_CLAIM');
        }
        if (!ids.length) reasons.push('MISSING_EVIDENCE_ID');
        const linked = [];
        for (const id of ids) {
            const evidence = evidenceMap.get(id);
            if (!evidence) {
                reasons.push('UNKNOWN_EVIDENCE_ID');
                continue;
            }
            linked.push(evidence);
            const owner = evidenceTenant(evidence);
            if (!owner) reasons.push('MISSING_EVIDENCE_TENANT');
            else if (owner !== String(input.tenantId)) reasons.push('EVIDENCE_TENANT_MISMATCH');
        }
        const claimText = claim.propositionText || claim.text || '';
        const matchedText = claim.matchedSentence
            || linked.map(evidenceText).join(' ');
        const hasNumeric = Array.isArray(claim.numericResult?.claimQuantities)
            ? claim.numericResult.claimQuantities.length > 0 : /\d|[٠-٩]|%/.test(claimText);
        const numericSafety = hasNumeric
            ? (claim.numericResult?.relation === 'ENTAILED' ? 'PASS' : 'BLOCK') : 'NOT_APPLICABLE';
        if (numericSafety === 'BLOCK') reasons.push('NUMERIC_NOT_EXPLICITLY_SUPPORTED');
        const temporalRequired = CURRENT_MARKER.test(normalize(claimText))
            || CURRENT_MARKER.test(normalize(input.question));
        const temporalSafety = temporalRequired
            ? (linked.some(item => evidenceTemporalProof(item)
                || CURRENT_MARKER.test(normalize(evidenceText(item)))) ? 'PASS' : 'BLOCK')
            : 'NOT_APPLICABLE';
        if (temporalSafety === 'BLOCK') reasons.push('TEMPORAL_PROOF_MISSING');
        const negationSafety = explicitNegationPass(claimText, matchedText, numericSafety) ? 'PASS' : 'BLOCK';
        if (negationSafety === 'BLOCK') reasons.push('NEGATION_OR_EXCLUSIVITY_NOT_EXPLICIT');
        const relevanceSafety = relevancePass(input.question, claimText, matchedText) ? 'PASS' : 'BLOCK';
        if (relevanceSafety === 'BLOCK') reasons.push('SUPPORTED_BUT_NONRESPONSIVE');
        const uniqueReasons = [...new Set(reasons)];
        return {
            claimText,
            evidenceIds: ids,
            tenantIntegrity: uniqueReasons.some(reason => ['UNKNOWN_EVIDENCE_ID', 'MISSING_EVIDENCE_TENANT', 'EVIDENCE_TENANT_MISMATCH'].includes(reason)) ? 'BLOCK' : 'PASS',
            validatorSupport: claim.classification || claim.finalClassification || 'UNKNOWN',
            numericSafety,
            temporalSafety,
            negationSafety,
            relevanceSafety,
            reasons: uniqueReasons,
            finalDecision: uniqueReasons.length ? DECISION.BLOCK : DECISION.ALLOW
        };
    });

    // On the tenant/business path an empty claim set means that no proposition
    // was proven for delivery. It is not a vacuous safety success. Social
    // conversation remains outside this fail-closed contract.
    const normalizedAnswer = normalize(input.answer);
    const alreadySafeNonAnswer = !normalizedAnswer
        || normalizedAnswer === normalize(SAFE_FALLBACK)
        || normalizedAnswer === normalize(TECHNICAL_FALLBACK)
        || normalizedAnswer === 'no answer';
    if (businessRoute && claimResults.length === 0
        && (!alreadySafeNonAnswer || candidateTenantMismatch)) {
        const reasons = ['NO_DELIVERABLE_CLAIMS'];
        if (candidateTenantMismatch) reasons.push('EVIDENCE_TENANT_MISMATCH');
        const result = { decision: DECISION.BLOCK, reasons, claimResults, removedClaims };
        result.telemetry = telemetryFrom(result, input, startedAt);
        if (candidateTenantMismatch) result.telemetry.tenantMismatchCount = 1;
        return result;
    }

    const blocked = claimResults.filter(claim => claim.finalDecision === DECISION.BLOCK).length;
    const allowed = claimResults.length - blocked;
    const decision = blocked === 0 ? DECISION.ALLOW : allowed > 0 ? DECISION.PARTIAL : DECISION.BLOCK;
    const result = {
        decision,
        reasons: [...new Set(claimResults.flatMap(claim => claim.reasons))],
        claimResults,
        removedClaims
    };
    result.telemetry = telemetryFrom(result, input, startedAt);
    return result;
}

function applyGroundingSafetyBoundary(input, options = {}) {
    const evaluator = options.evaluator || evaluateGroundingSafety;
    // Preserve the established non-shadow API contract. Rollout callers opt
    // non-selected conversations out explicitly with enforcementActive=false.
    const enforced = input.shadowMode !== true && input.enforcementActive !== false;
    try {
        const result = evaluator(input);
        const knownDecision = Object.values(DECISION).includes(result.decision);
        const safeToDeliver = knownDecision && result.decision === DECISION.ALLOW;
        const outputAnswer = !enforced || safeToDeliver
            ? input.answer : (input.fallback || SAFE_FALLBACK);
        Object.assign(result.telemetry, {
            enforcementActive: enforced,
            wouldHaveDeliveredInShadow: true,
            actualDeliveredDecision: enforced && !safeToDeliver ? 'SAFE_FALLBACK' : 'CANDIDATE',
            fallbackType: enforced && !safeToDeliver
                ? (input.upstreamDecision === 'CLARIFY' ? 'CLARIFY' : 'NO_ANSWER') : null
        });
        return { ...result, outputAnswer };
    } catch (error) {
        const startedAt = performance.now();
        const result = {
            decision: DECISION.BLOCK,
            reasons: ['BOUNDARY_PROCESSING_ERROR'],
            claimResults: [],
            processingError: true,
            errorCode: error?.code || 'GROUNDING_BOUNDARY_ERROR'
        };
        result.telemetry = telemetryFrom(result, input, startedAt);
        result.outputAnswer = enforced ? (input.fallback || SAFE_FALLBACK) : input.answer;
        Object.assign(result.telemetry, {
            enforcementActive: enforced,
            wouldHaveDeliveredInShadow: true,
            actualDeliveredDecision: enforced ? 'SAFE_FALLBACK' : 'CANDIDATE',
            fallbackType: enforced ? 'NO_ANSWER' : null
        });
        return result;
    }
}

module.exports = {
    DECISION,
    SAFE_FALLBACK,
    evaluateGroundingSafety,
    applyGroundingSafetyBoundary,
    normalize,
    relevancePass,
    explicitNegationPass
    , explicitCurrentDateRange
    , enforcementBucket,
    enforcementAssignment
};
