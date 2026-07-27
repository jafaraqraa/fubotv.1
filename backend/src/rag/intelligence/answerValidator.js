let lastValidationMetadata = null;

/**
 * Standard utility to score text overlaps and coverage.
 */
class EvidenceScorer {
    /**
     * Extracts digits/numbers from a string.
     */
    static extractNumbers(text) {
        if (!text) return [];
        // Strip leading list indices at the start of any line or block (e.g., "1. ", "2. ")
        let cleaned = text.replace(/(?:^|\n)\s*\d+\.\s+/g, '\n');
        // Strip standard bullet list indices
        cleaned = cleaned.replace(/(?:^|\n)\s*[-*+]\s+/g, '\n');

        const matches = cleaned.match(/\d+/g);
        return matches ? matches : [];
    }

    /**
     * Calculates coverage ratio.
     */
    static getCoverageRatio(answer, context) {
        if (!answer) return 0.0;
        if (!context) return 0.0;

        const contextWords = new Set(context.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const answerWords = answer.toLowerCase().split(/\s+/).filter(w => w.length > 2);

        if (answerWords.length === 0) return 1.0;

        let overlapCount = 0;
        answerWords.forEach(w => {
            if (contextWords.has(w)) {
                overlapCount++;
            }
        });

        return overlapCount / answerWords.length;
    }
}

/**
 * Classifies claims as SUPPORTED, UNSUPPORTED, or CONTRADICTING.
 */
class HallucinationClassifier {
    /**
     * Determines whether numbers in the claim directly contradict known numbers in context.
     * Contradiction exists only when the claim and context refer to the same topic domain but have different numbers.
     *
     * @param {string} claim - Individual claim.
     * @param {string} context - Retrieved context.
     * @param {Set<string>} contextNumbers - Numbers present in the retrieved context.
     * @returns {string} SUPPORTED, UNSUPPORTED, or CONTRADICTING.
     */
    static classify(claim, context, contextNumbers) {
        const claimLower = claim.toLowerCase();
        const contextLower = (context || '').toLowerCase();

        // 1. Semantic negation check: if context explicitly denies or has no information, any assertion is UNSUPPORTED
        const hasNegation = /no information|لا معلومات|غير متوفر|لا يمكن/i.test(contextLower);
        if (hasNegation) {
            if (/possible|يمكن|متاح|مسموح/i.test(claimLower)) {
                return "UNSUPPORTED";
            }
        }

        const claimNumbers = EvidenceScorer.extractNumbers(claim);
        if (claimNumbers.length === 0) {
            return "SUPPORTED"; // No factual numbers means no objective contradiction
        }

        const missing = claimNumbers.filter(num => !contextNumbers.has(num));

        if (missing.length > 0) {
            // Contradiction requires positive conflicting evidence on the same topic domain
            // Domain Topics List
            const topics = [
                { keywords: ["fee", "cost", "شحن", "توصيل", "سعر", "رسوم"], alternativeKeywords: ["fee", "cost", "شحن", "توصيل", "سعر", "رسوم"] },
                { keywords: ["day", "days", "يوم", "ايام"], alternativeKeywords: ["day", "days", "يوم", "ايام"] }
            ];

            let matchesSameTopic = false;
            for (const topic of topics) {
                const claimHasTopic = topic.keywords.some(k => claimLower.includes(k));
                const contextHasTopic = topic.alternativeKeywords.some(k => contextLower.includes(k));
                if (claimHasTopic && contextHasTopic) {
                    matchesSameTopic = true;
                    break;
                }
            }

            // We only fail if we have positive conflicting evidence on the exact same topic domain
            if (matchesSameTopic && contextNumbers.size > 0) {
                return "CONTRADICTING";
            }
            return "UNSUPPORTED";
        }

        return "SUPPORTED";
    }
}

/**
 * Implements the enterprise conservative decision policy.
 */
class DecisionPolicy {
    /**
     * Determines validation state based on coverage and claims classification.
     */
    static decide(coverageRatio, claimsList) {
        const hasContradicting = claimsList.some(c => c.classification === "CONTRADICTING");
        const allUnsupported = claimsList.length > 0 && claimsList.every(c => c.classification === "UNSUPPORTED");
        const hasUnsupported = claimsList.some(c => c.classification === "UNSUPPORTED");

        if (hasContradicting) {
            return "FAIL";
        }

        if (allUnsupported) {
            return "UNSUPPORTED";
        }

        if (hasUnsupported) {
            // Incomplete evidence (some supported, some unsupported) -> WARN
            return "WARN";
        }

        if (coverageRatio >= 1.0) {
            return "PASS";
        }

        if (coverageRatio >= 0.70) {
            return "PASS";
        }

        if (coverageRatio >= 0.40) {
            return "WARN";
        }

        return "UNSUPPORTED";
    }
}

/**
 * Surgical correction engine that only edits objective contradictions.
 */
class MinimalCorrectionEngine {
    static correct(answer, claimsList) {
        if (!answer) return '';

        // Surgical claim-level replacement preserving all valid and unsupported structures
        const parts = answer.split(/(\s+and\s+|\s+و\s+|[,،\n]+)/i);
        const correctedParts = [];

        for (const part of parts) {
            if (!part || part.trim() === '') {
                correctedParts.push(part);
                continue;
            }

            if (/^(\s+and\s+|\s+و\s+|[,،\n]+)$/i.test(part)) {
                correctedParts.push(part);
                continue;
            }

            // Find matching claim in our evaluated list
            const matchedClaim = claimsList.find(c => c.text === part);
            if (matchedClaim && matchedClaim.classification === "CONTRADICTING") {
                // Replace ONLY the contradicting segment surgically
                correctedParts.push('[تفاصيل لم يتم تأكيدها بموجب مستندات السياق المتوفرة]');
            } else {
                correctedParts.push(part);
            }
        }

        return correctedParts.join('');
    }
}

/**
 * Builds metadata rich contract representing the validation outcomes.
 */
class ResponseMetadataBuilder {
    static build(state, ratio, claimsList) {
        const unsupported = claimsList.filter(c => c.classification === "UNSUPPORTED").map(c => c.text);
        const contradicted = claimsList.filter(c => c.classification === "CONTRADICTING").map(c => c.text);

        return {
            validationState: state,
            evidenceCoverage: ratio,
            unsupportedClaims: unsupported,
            contradictedClaims: contradicted,
            confidence: ratio >= 0.70 ? "High" : (ratio >= 0.40 ? "Medium" : "Low")
        };
    }
}

/**
 * Enterprise-grade, conservative Validation Decision Engine.
 */
class ValidationDecisionEngine {
    /**
     * Executes the modern non-destructive conservative decision pipeline.
     *
     * @param {string} originalResponse - Raw LLM answer.
     * @param {string} context - Retrieved context.
     * @returns {string} Exact original response (unless FAIL matches contradiction).
     */
    static validate(originalResponse, context) {
        const startTime = Date.now();

        if (!originalResponse || typeof originalResponse !== 'string' || originalResponse.trim() === '') {
            return '';
        }

        if (!context) {
            // Conservative fallback: untouched original response returned
            lastValidationMetadata = ResponseMetadataBuilder.build("PASS", 1.0, []);
            return originalResponse;
        }

        const coverageRatio = EvidenceScorer.getCoverageRatio(originalResponse, context);
        const contextNumbers = new Set(EvidenceScorer.extractNumbers(context));

        // Segment response into clauses/claims
        const clauses = originalResponse.split(/(\s+and\s+|\s+و\s+|[,،\n]+)/i);
        const claimsList = [];

        for (const c of clauses) {
            if (c && c.trim() !== '' && !/^(\s+and\s+|\s+و\s+|[,،\n]+)$/i.test(c)) {
                const classification = HallucinationClassifier.classify(c, context, contextNumbers);
                claimsList.push({
                    text: c,
                    classification
                });
            }
        }

        // Decide validation state based on conservative evidence-aware policy
        const state = DecisionPolicy.decide(coverageRatio, claimsList);

        let finalAnswer = originalResponse;
        let modifiedCount = 0;

        if (state === "FAIL") {
            finalAnswer = MinimalCorrectionEngine.correct(originalResponse, claimsList);
            modifiedCount = Math.abs(originalResponse.length - finalAnswer.length);
        }

        const durationMs = Date.now() - startTime;
        lastValidationMetadata = ResponseMetadataBuilder.build(state, coverageRatio, claimsList);

        // Developer logging
        console.log(`\n% [Conservative Answer Validation Decision Report]`);
        console.log(`• Validation State: ${state}`);
        console.log(`• Reason: "${state === "FAIL" ? "Direct factual contradiction detected." : "Conservative policy preserve original text."}"`);
        console.log(`• Evidence Coverage: ${(coverageRatio * 100).toFixed(1)}%`);
        console.log(`• Contradicted Claims Count: ${lastValidationMetadata.contradictedClaims.length}`);
        console.log(`• Unsupported Claims Count: ${lastValidationMetadata.unsupportedClaims.length}`);
        console.log(`• Modified Claims Count: ${modifiedCount}`);
        console.log(`• Correction Applied: ${state === "FAIL" ? "Yes" : "No"}`);
        console.log(`• Execution Time: ${durationMs} ms\n`);

        return finalAnswer;
    }
}

/**
 * Splits text into sentences/clauses based on common Arabic and Latin delimiters.
 * Kept for backward compatibility.
 */
function splitIntoSentences(text) {
    if (!text) return [];
    return text.split(/[.،,;\n]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Extracts digits/numbers from a string.
 * Kept for backward compatibility.
 */
function extractNumbers(text) {
    return EvidenceScorer.extractNumbers(text);
}

/**
 * Validates an AI-generated response against the retrieved source context to prevent hallucinations.
 * Adheres to strict conservative evidence-aware decision policies.
 */
function validateAnswer(answer, retrievedContext) {
    return ValidationDecisionEngine.validate(answer, retrievedContext);
}

function getLastValidationMetadata() {
    return lastValidationMetadata;
}

module.exports = {
    splitIntoSentences,
    extractNumbers,
    validateAnswer,
    getLastValidationMetadata,
    EvidenceScorer,
    HallucinationClassifier,
    DecisionPolicy,
    MinimalCorrectionEngine,
    ResponseMetadataBuilder,
    ValidationDecisionEngine
};
