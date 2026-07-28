const { performance } = require('perf_hooks');
const {
    RISK,
    scanText,
    parseSerializedChunks,
    redactSecrets
} = require('../security/promptInjectionGuard');

const STATUS = Object.freeze({
    SUPPORTED: 'SUPPORTED',
    PARTIAL: 'PARTIALLY_SUPPORTED',
    UNSUPPORTED: 'UNSUPPORTED',
    CONTRADICTED: 'CONTRADICTED',
    UNKNOWN: 'UNKNOWN',
    INSUFFICIENT: 'INSUFFICIENT_CONTEXT'
});
const UNVERIFIED_MESSAGE = "I couldn't verify this information from the available knowledge.";
const ARABIC_UNVERIFIED_MESSAGE = 'لم أتمكن من التحقق من هذه المعلومة من المعرفة المتاحة.';
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions?/i,
    /disregard\s+(all\s+)?previous/i,
    /you\s+are\s+(chatgpt|an?\s+ai|the\s+assistant)/i,
    /system\s*prompt/i,
    /answer\s+only\s+with/i,
    /do\s+not\s+follow/i,
    /تجاهل\s+(كل\s+)?(التعليمات|الأوامر)/i,
    /أنت\s+(شات\s*جي\s*بي\s*تي|مساعد)/i,
    /أجب\s+فقط/i
];
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'and', 'or',
    'our', 'we', 'it', 'this', 'that', 'for', 'in', 'on', 'at', 'with', 'from',
    'من', 'في', 'على', 'الى', 'إلى', 'عن', 'هو', 'هي', 'هذا', 'هذه', 'ذلك',
    'تلك', 'و', 'او', 'أو', 'لدينا', 'يتم', 'يمكن', 'أن', 'ان', 'ما'
]);

let lastValidationMetadata = null;

function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
}

function normalizeText(text) {
    return String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[^\p{L}\p{N}%@+:/.-]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(text) {
    return normalizeText(text)
        .split(/\s+/)
        .map(token => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, ''))
        .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function extractNumbers(text) {
    if (!text) return [];
    const cleaned = String(text)
        .replace(/(?:^|\n)\s*\d+[.)]\s+/g, '\n')
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    return cleaned.match(/(?:\+?\d[\d\s().-]{1,}\d|\d+(?:[.,]\d+)?%?)/g)
        ?.map(value => value.replace(/[\s(),.-]/g, '').replace(',', '.')) || [];
}

function trigrams(text) {
    const normalized = normalizeText(text).replace(/\s+/g, ' ');
    if (normalized.length < 3) return new Set(normalized ? [normalized] : []);
    const result = new Set();
    for (let index = 0; index <= normalized.length - 3; index++) {
        result.add(normalized.slice(index, index + 3));
    }
    return result;
}

function setSimilarity(left, right) {
    if (!left.size || !right.size) return 0;
    let intersection = 0;
    for (const value of left) if (right.has(value)) intersection++;
    return intersection / (left.size + right.size - intersection);
}

function keywordCoverage(claim, evidence) {
    const claimTokens = new Set(tokenize(claim));
    const evidenceTokens = new Set(tokenize(evidence));
    if (!claimTokens.size) return 0;
    let matched = 0;
    for (const token of claimTokens) if (evidenceTokens.has(token)) matched++;
    return matched / claimTokens.size;
}

function semanticSimilarity(claim, evidence) {
    const keyword = setSimilarity(new Set(tokenize(claim)), new Set(tokenize(evidence)));
    const character = setSimilarity(trigrams(claim), trigrams(evidence));
    return clamp((keyword * 0.65) + (character * 0.35));
}

function containsInjection(text) {
    return INJECTION_PATTERNS.some(pattern => pattern.test(String(text || '')));
}

function sanitizeEvidence(text) {
    return String(text || '')
        .split(/\n|(?<=[.!؟])\s+/)
        .filter(segment => {
            if (containsInjection(segment)) return false;
            const risk = scanText(segment).riskLevel;
            return risk === RISK.SAFE;
        })
        .join(' ')
        .trim();
}

function normalizeChunks(retrievedContext) {
    if (!retrievedContext) return [];
    let input = Array.isArray(retrievedContext) ? retrievedContext : [retrievedContext];
    if (typeof retrievedContext === 'string' && /(?:^|\n)Chunk #[^\n]+/.test(retrievedContext)) {
        input = retrievedContext
            .split(/\n\n=+\n\n/)
            .map((block, index) => {
                const id = block.match(/(?:^|\n)Chunk #([^\n]+)/)?.[1]?.trim() || `context-${index + 1}`;
                const content = block.match(/(?:^|\n)Content:\s*\n([\s\S]*)$/)?.[1] || block;
                return { id, text: content };
            });
    } else if (typeof retrievedContext === 'string'
        && retrievedContext.includes('<untrusted_document ')) {
        input = (parseSerializedChunks(retrievedContext) || []).map((chunk, index) => ({
            ...chunk,
            id: chunk.chunkId || `context-${index + 1}`,
            retrievalScore: chunk.retrievalScore || 0.5
        }));
    }
    const chunks = [];
    const ignoredPromptInjectionChunks = [];
    input.forEach((item, index) => {
        const rawText = typeof item === 'string'
            ? item
            : item?.text || item?.content || item?.pageContent || item?.payload?.text || '';
        const text = sanitizeEvidence(rawText);
        const id = String(item?.chunkId || item?.id || item?.payload?.chunkId || `context-${index + 1}`);
        const guard = item?.injectionGuard || scanText(rawText, {
            chunkId: id,
            tenantId: item?.tenantId || item?.payload?.tenantId,
            documentId: item?.documentId || item?.payload?.documentId
        });
        if ([RISK.HIGH, RISK.BLOCKED].includes(guard.riskLevel)) {
            ignoredPromptInjectionChunks.push(id);
            return;
        }
        if (!text) {
            if (containsInjection(rawText)) ignoredPromptInjectionChunks.push(id);
            return;
        }
        chunks.push({
            id,
            text,
            retrievalScore: clamp(Number(item?.retrievalScore ?? item?.score ?? item?.semanticScore ?? 0.5)),
            rerankerScore: clamp(Number(item?.rerankerScore ?? item?.rerankScore ?? item?.finalScore ?? 0.5)),
            injectionRemoved: text !== String(rawText).trim()
        });
    });
    const seen = new Set();
    const unique = chunks.filter(chunk => {
        const fingerprint = normalizeText(chunk.text);
        if (!fingerprint || seen.has(fingerprint)) return false;
        seen.add(fingerprint);
        return true;
    });
    unique.ignoredPromptInjectionChunks = ignoredPromptInjectionChunks;
    return unique;
}

function splitIntoSentences(text) {
    if (!text) return [];
    return String(text)
        .replace(/```[\s\S]*?```/g, ' ')
        .split(/(?<=[.!?؟؛])\s+|\n+|(?<=\S)[؛;]+/)
        .map(value => value.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, '').trim())
        .filter(Boolean);
}

function isNonFactual(claim) {
    const normalized = normalizeText(claim);
    if (!normalized) return true;
    if (/^\s*(?:#{1,6}|\|?[-:| ]+\|?)\s*/.test(claim)) return true;
    if (/^\s*\|.*\|\s*$/.test(claim) && !extractNumbers(claim).length) return true;
    if (/^(thanks?|thank you|hello|hi|مرحبا|اهلا|شكرا|يسعدني)/i.test(normalized)) return true;
    if (/[?؟]$/.test(claim.trim())) return true;
    return tokenize(claim).length < 2;
}

function extractClaims(answer) {
    const clauses = splitIntoSentences(answer).flatMap(sentence =>
        sentence.split(/\s+\band\b\s+|\s+و\s+/i).map(value => value.trim()).filter(Boolean)
    );
    return clauses.map((text, index) => ({
        id: `claim-${index + 1}`,
        text,
        factual: !isNonFactual(text)
    }));
}

function hasNegation(text) {
    return /(?:\b(?:not|never|no|cannot|can't|doesn't|isn't|without)\b|(?:لا|ليس|غير|لن|بدون))/i
        .test(normalizeText(text));
}

function topicSimilarity(claim, evidence) {
    const claimTokens = new Set(tokenize(claim).filter(token => !extractNumbers(token).length));
    const evidenceTokens = new Set(tokenize(evidence).filter(token => !extractNumbers(token).length));
    return setSimilarity(claimTokens, evidenceTokens);
}

function contradictionScore(claim, evidence) {
    const topic = topicSimilarity(claim, evidence);
    if (topic < 0.18) return 0;
    const claimNumbers = extractNumbers(claim);
    const evidenceNumbers = extractNumbers(evidence);
    if (claimNumbers.length && evidenceNumbers.length) {
        const exact = claimNumbers.every(number => evidenceNumbers.includes(number));
        if (!exact) return clamp(0.72 + topic * 0.28);
    }
    if (hasNegation(claim) !== hasNegation(evidence) && topic >= 0.35) {
        return clamp(0.65 + topic * 0.25);
    }
    return 0;
}

function scoreEvidence(claim, chunk) {
    const absenceEvidence = /(?:no information|not documented|unknown|لا معلومات|لا توجد معلومات|غير موثق)/i
        .test(chunk.text);
    const keyword = keywordCoverage(claim, chunk.text);
    const semantic = semanticSimilarity(claim, chunk.text);
    const contradiction = absenceEvidence ? 0 : contradictionScore(claim, chunk.text);
    const claimNumbers = extractNumbers(claim);
    const evidenceNumbers = extractNumbers(chunk.text);
    const numericExact = !claimNumbers.length
        || claimNumbers.every(number => evidenceNumbers.includes(number));
    const agreement = absenceEvidence ? 0 : clamp(
        semantic * 0.45
        + keyword * 0.35
        + chunk.retrievalScore * 0.10
        + chunk.rerankerScore * 0.10
    );
    return {
        chunk, keyword, semantic, contradiction, numericExact, agreement, absenceEvidence,
        evidenceHasNumbers: evidenceNumbers.length > 0
    };
}

function classifyClaim(claim, chunks) {
    if (!claim.factual) {
        return {
            ...claim, classification: STATUS.UNKNOWN, confidence: 0.5,
            evidenceChunkIds: [], similarity: 0, keywordOverlap: 0,
            citationCoverage: 0, missingEvidence: false, contradictionScore: 0
        };
    }
    const matches = chunks.map(chunk => scoreEvidence(claim.text, chunk))
        .sort((left, right) => Math.max(right.agreement, right.contradiction)
            - Math.max(left.agreement, left.contradiction));
    const best = matches[0];
    if (!best) {
        return {
            ...claim, classification: STATUS.UNSUPPORTED, confidence: 0,
            evidenceChunkIds: [], similarity: 0, keywordOverlap: 0,
            citationCoverage: 0, missingEvidence: true, contradictionScore: 0
        };
    }

    let classification;
    if (best.absenceEvidence) {
        classification = STATUS.UNSUPPORTED;
    } else if (best.contradiction >= 0.72) {
        classification = STATUS.CONTRADICTED;
    } else if (!best.numericExact && extractNumbers(claim.text).length) {
        classification = best.evidenceHasNumbers && (best.semantic >= 0.22 || best.keyword >= 0.22)
            ? STATUS.CONTRADICTED : STATUS.UNSUPPORTED;
    } else if ((best.agreement >= 0.62 && best.keyword >= 0.45) || best.keyword >= 0.72) {
        classification = STATUS.SUPPORTED;
    } else if (best.agreement >= 0.42 && (best.keyword >= 0.28 || best.semantic >= 0.34)) {
        classification = STATUS.PARTIAL;
    } else {
        classification = STATUS.UNSUPPORTED;
    }

    const supporting = matches
        .filter(match => match.contradiction < 0.72
            && !match.absenceEvidence
            && match.numericExact
            && (match.agreement >= 0.42 || match.keyword >= 0.35))
        .slice(0, 3);
    const evidenceChunkIds = supporting.map(match => match.chunk.id);
    const confidence = classification === STATUS.CONTRADICTED
        ? best.contradiction
        : classification === STATUS.UNSUPPORTED
            ? clamp(1 - best.agreement)
            : best.agreement;
    return {
        ...claim,
        classification,
        confidence: Number(confidence.toFixed(4)),
        evidenceChunkIds,
        similarity: Number(best.semantic.toFixed(4)),
        keywordOverlap: Number(best.keyword.toFixed(4)),
        citationCoverage: evidenceChunkIds.length ? 1 : 0,
        missingEvidence: evidenceChunkIds.length === 0,
        contradictionScore: Number(best.contradiction.toFixed(4)),
        numericExact: best.numericExact
    };
}

function overallStatus(claims, hasContext) {
    if (!hasContext) return STATUS.INSUFFICIENT;
    const factual = claims.filter(claim => claim.factual);
    if (!factual.length) return STATUS.UNKNOWN;
    if (factual.some(claim => claim.classification === STATUS.CONTRADICTED)) return STATUS.CONTRADICTED;
    if (factual.every(claim => claim.classification === STATUS.SUPPORTED)) return STATUS.SUPPORTED;
    if (factual.every(claim => claim.classification === STATUS.UNSUPPORTED)) return STATUS.UNSUPPORTED;
    if (factual.some(claim => claim.classification === STATUS.UNSUPPORTED
        || claim.classification === STATUS.PARTIAL)) return STATUS.PARTIAL;
    return STATUS.UNKNOWN;
}

function calculateConfidence(claims, chunks, status) {
    const factual = claims.filter(claim => claim.factual);
    if (!chunks.length || !factual.length) return status === STATUS.UNKNOWN ? 0.5 : 0;
    const weights = {
        [STATUS.SUPPORTED]: 1,
        [STATUS.PARTIAL]: 0.55,
        [STATUS.UNKNOWN]: 0.25,
        [STATUS.UNSUPPORTED]: 0,
        [STATUS.CONTRADICTED]: 0
    };
    const claimSupport = factual.reduce((sum, claim) => sum + weights[claim.classification], 0) / factual.length;
    const evidenceCoverage = factual.filter(claim => claim.evidenceChunkIds.length).length / factual.length;
    const semanticAgreement = factual.reduce((sum, claim) => sum + claim.similarity, 0) / factual.length;
    const retrievalQuality = chunks.reduce((sum, chunk) => sum + chunk.retrievalScore, 0) / chunks.length;
    const rerankerQuality = chunks.reduce((sum, chunk) => sum + chunk.rerankerScore, 0) / chunks.length;
    const contradictionPenalty = factual.filter(claim => claim.classification === STATUS.CONTRADICTED).length / factual.length;
    return clamp(
        claimSupport * 0.35
        + evidenceCoverage * 0.25
        + semanticAgreement * 0.15
        + retrievalQuality * 0.10
        + rerankerQuality * 0.10
        + (1 - contradictionPenalty) * 0.05
        - contradictionPenalty * 0.30
    );
}

function confidenceLabel(score) {
    if (score >= 0.85) return 'High';
    if (score >= 0.65) return 'Medium';
    if (score >= 0.40) return 'Low';
    return 'Reject';
}

function safeReplacement(answer) {
    return /[\u0600-\u06FF]/.test(answer) ? ARABIC_UNVERIFIED_MESSAGE : UNVERIFIED_MESSAGE;
}

function rewriteUnsafeClaims(answer, claims, status) {
    if (status === STATUS.INSUFFICIENT) return safeReplacement(answer);
    let output = answer;
    for (const claim of claims) {
        if (claim.classification !== STATUS.UNSUPPORTED
            && claim.classification !== STATUS.CONTRADICTED) continue;
        output = output.replace(claim.text, safeReplacement(claim.text));
    }
    return output;
}

function validateDetailed(answer, retrievedContext) {
    const startedAt = performance.now();
    if (!answer || typeof answer !== 'string' || !answer.trim()) {
        return {
            finalAnswer: '', overallStatus: STATUS.UNKNOWN, confidenceScore: 0,
            confidenceLabel: 'Reject', claims: [], evidenceCoverage: 0,
            durationMs: performance.now() - startedAt
        };
    }
    const chunks = normalizeChunks(retrievedContext);
    const extracted = extractClaims(answer);
    const claims = extracted.map(claim => classifyClaim(claim, chunks));
    const status = overallStatus(claims, chunks.length > 0);
    const confidenceScore = calculateConfidence(claims, chunks, status);
    const factual = claims.filter(claim => claim.factual);
    const evidenceCoverage = factual.length
        ? factual.filter(claim => claim.evidenceChunkIds.length).length / factual.length : 0;
    const result = {
        finalAnswer: redactSecrets(rewriteUnsafeClaims(answer, claims, status)),
        overallStatus: status,
        validationState: status,
        confidenceScore: Number(confidenceScore.toFixed(4)),
        confidenceLabel: confidenceLabel(confidenceScore),
        evidenceCoverage: Number(evidenceCoverage.toFixed(4)),
        claims,
        supportedClaims: claims.filter(c => c.classification === STATUS.SUPPORTED).map(c => c.text),
        partiallySupportedClaims: claims.filter(c => c.classification === STATUS.PARTIAL).map(c => c.text),
        unsupportedClaims: claims.filter(c => c.classification === STATUS.UNSUPPORTED).map(c => c.text),
        contradictedClaims: claims.filter(c => c.classification === STATUS.CONTRADICTED).map(c => c.text),
        ignoredPromptInjectionChunks: [
            ...(chunks.ignoredPromptInjectionChunks || []),
            ...chunks.filter(chunk => chunk.injectionRemoved).map(chunk => chunk.id)
        ],
        uniqueEvidenceChunks: chunks.length,
        durationMs: Number((performance.now() - startedAt).toFixed(3))
    };
    return result;
}

function validateAnswer(answer, retrievedContext) {
    const result = validateDetailed(answer, retrievedContext);
    lastValidationMetadata = result;
    const counts = classification => result.claims.filter(claim => claim.classification === classification).length;
    console.log('[AnswerValidator]');
    console.log(`Claims: ${result.claims.length}`);
    console.log(`Supported: ${counts(STATUS.SUPPORTED)}`);
    console.log(`Partial: ${counts(STATUS.PARTIAL)}`);
    console.log(`Unsupported: ${counts(STATUS.UNSUPPORTED)}`);
    console.log(`Contradicted: ${counts(STATUS.CONTRADICTED)}`);
    console.log(`Overall: ${result.overallStatus}`);
    console.log(`Confidence: ${result.confidenceScore.toFixed(2)} (${result.confidenceLabel})`);
    return result.finalAnswer;
}

function getLastValidationMetadata() {
    return lastValidationMetadata;
}

module.exports = {
    STATUS,
    splitIntoSentences,
    extractNumbers,
    extractClaims,
    normalizeChunks,
    semanticSimilarity,
    keywordCoverage,
    contradictionScore,
    validateDetailed,
    validateAnswer,
    getLastValidationMetadata
};
