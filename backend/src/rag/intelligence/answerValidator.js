const { performance } = require('perf_hooks');
const {
    RISK,
    scanText,
    parseSerializedChunks,
    redactSecrets
} = require('../security/promptInjectionGuard');
const { DERIVED_STATUS, validateDerivedClaim } = require('./derivedClaimValidator');
const { RELATION: POLICY_RELATION, evaluateConditionalPolicy } = require('../security/conditionalPolicyGuard');

const STATUS = Object.freeze({
    SUPPORTED: 'SUPPORTED',
    PARTIAL: 'PARTIALLY_SUPPORTED',
    UNSUPPORTED: 'UNSUPPORTED',
    CONTRADICTED: 'CONTRADICTED',
    UNKNOWN: 'UNKNOWN',
    INSUFFICIENT: 'INSUFFICIENT_CONTEXT'
});
const PROPOSITION_RELATION = Object.freeze({
    SINGLE: 'SINGLE',
    INDEPENDENT: 'INDEPENDENT',
    SCOPE_COUPLED: 'SCOPE_COUPLED',
    CAUSAL: 'CAUSAL'
});
const UNVERIFIED_MESSAGE = "I couldn't verify this information from the available knowledge.";
const ARABIC_UNVERIFIED_MESSAGE = 'لا تتوفر لدي معلومات مؤكدة حول هذا الموضوع حالياً. يمكنك التواصل مع فريق الدعم للحصول على التفاصيل.';
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
    , 'خاص', 'بك', 'لك', 'عميل', 'موجود', 'موجوده', 'عياده', 'العياده'
]);

const ARABIC_TOKEN_ALIASES = new Map([
    ['يمكنك', 'يمكن'], ['يمكنكم', 'يمكن'], ['باستخدام', 'استخدام'],
    ['بواسطه', 'استخدام'], ['واسطه', 'استخدام'], ['باستعمال', 'استخدام'], ['استعمال', 'استخدام'],
    ['طلبك', 'طلب'], ['طلبكم', 'طلب'], ['طلبه', 'طلب'], ['طلبي', 'طلب'],
    ['للعميل', 'عميل'], ['العميل', 'عميل'], ['الخاص', 'خاص'],
    ['تجهيزه', 'تجهيز'], ['تجهيزها', 'تجهيز'], ['التجهيز', 'تجهيز'],
    ['تتبعك', 'تتبع'], ['تتبعه', 'تتبع'],
    ['مجانيا', 'مجاني'], ['مجانيه', 'مجاني'],
    ['فروع', 'فرع'], ['للفروع', 'فرع'], ['الفروع', 'فرع'],
    ['شركات', 'شركه'], ['لشركات', 'شركه'], ['شركتي', 'شركه'],
    ['وتامين', 'تامين'],
    ['المتعاقد', 'تعامل'], ['المتعاقده', 'تعامل'], ['نتعامل', 'تعامل'],
    ['الشحن', 'توصيل'], ['شحن', 'توصيل'], ['التوصيل', 'توصيل'],
    ['العروض', 'عرض'], ['العرض', 'عرض'],
    ['الحاليه', 'حاليا'], ['حاليه', 'حاليا'],
    ['طبيب', 'دكتور'], ['طبيبه', 'دكتور'], ['دكتوره', 'دكتور'],
    ['يحتسب', 'شمول'], ['تحتسب', 'شمول'], ['يشمل', 'شمول'], ['تشمل', 'شمول'],
    ['يغطي', 'شمول'], ['تغطي', 'شمول'], ['تغطيه', 'شمول'], ['مغطي', 'شمول'],
    ['يسري', 'شمول'], ['تسري', 'شمول'],
    ['ساعه', 'ساعه'], ['ساعات', 'ساعه'], ['ساعتين', 'ساعه'],
    ['ايام', 'يوم'], ['يومين', 'يوم'], ['شواكل', 'شيكل']
]);

const NUMBER_WORDS = new Map([
    ['واحد', 1], ['واحده', 1], ['احد', 1], ['اثنان', 2], ['اثنين', 2],
    ['ثلاثه', 3], ['اربع', 4], ['خمسه', 5], ['سته', 6],
    ['سبعه', 7], ['ثمانيه', 8], ['تسعه', 9], ['عشره', 10]
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
        .map(token => ARABIC_TOKEN_ALIASES.get(token) || token)
        .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function canonicalTokens(text) {
    return tokenize(text).map(token => {
        if (ARABIC_TOKEN_ALIASES.has(token)) return ARABIC_TOKEN_ALIASES.get(token);
        if (/^[\u0600-\u06FF]+$/u.test(token)) {
            const withoutArticle = token.startsWith('ال') && token.length > 4 ? token.slice(2) : token;
            const aliased = ARABIC_TOKEN_ALIASES.get(withoutArticle) || withoutArticle;
            // Arabic أفعل/فعلاء adjective agreement, e.g. masculine/feminine
            // forms. This is a morphological rule, not a vocabulary list.
            const feminineAdjective = aliased.match(/^([\u0621-\u064A])([\u0621-\u064A])([\u0621-\u064A])اء$/u);
            return feminineAdjective ? `ا${feminineAdjective[1]}${feminineAdjective[2]}${feminineAdjective[3]}` : aliased;
        }
        return token;
    });
}

function extractNumbers(text) {
    if (!text) return [];
    const cleaned = String(text)
        .replace(/(?:^|\n)\s*\d+[.)]\s+/g, '\n')
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    return cleaned.match(/(?<![\p{L}\p{N}])(?:\+?\d[\d\s().-]{1,}\d|\d+(?:[.,]\d+)?%?)(?![\p{L}\p{N}])/gu)
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
    const claimTokens = new Set(canonicalTokens(claim));
    const evidenceTokens = new Set(canonicalTokens(evidence));
    if (!claimTokens.size) return 0;
    let matched = 0;
    for (const token of claimTokens) if (evidenceTokens.has(token)) matched++;
    return matched / claimTokens.size;
}

function bidirectionalCoverage(claim, evidence) {
    const claimTokens = new Set(canonicalTokens(claim));
    const evidenceTokens = new Set(canonicalTokens(evidence));
    if (!claimTokens.size || evidenceTokens.size < 2) return 0;
    let matched = 0;
    for (const token of evidenceTokens) if (claimTokens.has(token)) matched++;
    return matched / evidenceTokens.size;
}

function semanticSimilarity(claim, evidence) {
    const keyword = setSimilarity(new Set(canonicalTokens(claim)), new Set(canonicalTokens(evidence)));
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
    if (typeof retrievedContext === 'string'
        && retrievedContext.includes('<untrusted_document ')) {
        input = (parseSerializedChunks(retrievedContext) || []).map((chunk, index) => ({
            ...chunk,
            id: chunk.chunkId || `context-${index + 1}`,
            retrievalScore: chunk.retrievalScore || 0.5
        }));
    } else if (typeof retrievedContext === 'string' && /(?:^|\n)Chunk #[^\n]+/.test(retrievedContext)) {
        input = retrievedContext
            .split(/\n\n=+\n\n/)
            .map((block, index) => {
                const id = block.match(/(?:^|\n)Chunk #([^\n]+)/)?.[1]?.trim() || `context-${index + 1}`;
                const content = block.match(/(?:^|\n)Content:\s*\n([\s\S]*)$/)?.[1] || block;
                return { id, text: content };
            });
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
            tenantId: item?.tenantId || item?.payload?.tenantId || '',
            documentId: item?.documentId || item?.payload?.documentId || item?.source || item?.payload?.source || '',
            chunkIndex: Number.isInteger(item?.chunkIndex ?? item?.payload?.chunkIndex)
                ? (item?.chunkIndex ?? item?.payload?.chunkIndex) : null,
            validFrom: item?.validFrom || item?.payload?.validFrom || null,
            validTo: item?.validTo || item?.payload?.validTo || null,
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
    return String(text).replace(/(^|\s)د\.(?=\s|$)/gu, '$1د․')
        .replace(/```[\s\S]*?```/g, ' ')
        .split(/(?<=[.!?؟؛])\s+|\n+|(?<=\S)[؛;]+|(?=\s*(?:وصف صور[ةه]|نوع المصدر|صور[ةه] معتمد قابل للارسال):)/i)
        .map(value => value.replace(/․/g, '.').replace(/^\s*(?:[-*+]|\d+[.)])\s*/, '').trim())
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

const CAUSAL_CONNECTOR = /(?:^|[\s،,؛;])(?:لذلك|لذا|وبالتالي|بالتالي|ومن\s+ثم|therefore|thus)(?=$|\s)/iu;
const SCOPE_CONNECTOR = /(?:\s*[،,؛;]?\s*)(حتى\s+لو|ولو|ولكن|لكنه|لكنها|لكن|بس|مع\s+ذلك|ومع\s+ذلك|مع\s+الاخذ\s+في\s+الاعتبار\s+(?:ان|أن)|مع\s+الأخذ\s+في\s+الاعتبار\s+(?:ان|أن)|مع\s+العلم\s+(?:ان|أن)(?:ه|ها)?|مع\s+ملاحظه\s+(?:ان|أن)|مع\s+ملاحظة\s+(?:ان|أن)|علم[\u064B-\u065F]*ا\s+ب(?:ان|أن)|إلا|الا|ما\s+عدا)(?=\s)/giu;
const INDEPENDENT_CONNECTOR = /\s+\band\b\s+|\s+و\s+|\s+(و(?=(?:بتقدر|تقدر|يمكنك|يمكنكم|يمكن|ستحصل|تحصل|تتبع|الشحن|التوصيل|الطلب|العرض|الخصم|عندنا|لدينا)(?=\s|$)))/giu;

function cleanPropositionText(text) {
    return String(text || '').replace(/^[\s،,؛;]+|[\s،,؛;]+$/g, '').trim();
}

function splitAtConnectors(sentence, connectorPattern) {
    const pattern = new RegExp(connectorPattern.source, connectorPattern.flags);
    const matches = [...sentence.matchAll(pattern)];
    if (!matches.length || matches[0].index === 0) return null;
    const mainSource = sentence.slice(0, matches[0].index);
    const propositions = [{
        sourceText: mainSource,
        text: cleanPropositionText(mainSource),
        connector: null
    }];
    // Rebuild marker-led parts directly from match boundaries so their source text
    // remains replaceable in the original answer (including attached Arabic waw).
    matches.forEach((match, index) => {
        const end = index + 1 < matches.length ? matches[index + 1].index : sentence.length;
        const sourceText = sentence.slice(match.index, end);
        const text = cleanPropositionText(sentence.slice(match.index + match[0].length, end));
        if (text) propositions.push({ sourceText, text, connector: (match[1] || match[0]).trim() });
    });
    return propositions;
}

function scopeValidationText(mainText, propositionText, connector) {
    if (/^(?:حتى\s+لو|ولو)$/iu.test(connector || '')) {
        const normalizedMain = normalizeText(mainText);
        if (/(?:توصيل|شحن)/u.test(normalizedMain) && /مجاني/u.test(normalizedMain)) {
            return `التوصيل المجاني ${propositionText}`;
        }
    }
    if (!/^(?:إلا|الا|ما\s+عدا|بس)$/iu.test(connector || '') || hasNegation(propositionText)) {
        return propositionText;
    }
    const normalizedMain = normalizeText(mainText);
    if (/(?:توصيل|شحن)/u.test(normalizedMain) && /مجاني/u.test(normalizedMain)) {
        return `التوصيل المجاني لا يحتسب ${propositionText}`;
    }
    return propositionText;
}

function extractClaims(answer) {
    const propositions = [];
    splitIntoSentences(answer).forEach((sentence, sentenceIndex) => {
        const compoundId = `compound-${sentenceIndex + 1}`;
        let parts;
        let relationshipType;
        if (CAUSAL_CONNECTOR.test(sentence)) {
            parts = [{ sourceText: sentence, text: sentence, connector: null }];
            relationshipType = PROPOSITION_RELATION.CAUSAL;
        } else {
            parts = splitAtConnectors(sentence, SCOPE_CONNECTOR);
            relationshipType = parts ? PROPOSITION_RELATION.SCOPE_COUPLED : PROPOSITION_RELATION.SINGLE;
            if (!parts) {
                parts = splitAtConnectors(sentence, INDEPENDENT_CONNECTOR);
                relationshipType = parts ? PROPOSITION_RELATION.INDEPENDENT : PROPOSITION_RELATION.SINGLE;
            }
            if (!parts) parts = [{ sourceText: sentence, text: sentence, connector: null }];
        }
        const mainText = parts[0].text;
        parts.forEach((part, partIndex) => {
            const propositionType = relationshipType === PROPOSITION_RELATION.SCOPE_COUPLED
                ? (partIndex === 0 ? 'MAIN' : /لو/u.test(part.connector || '') ? 'CONDITION' : 'EXCEPTION')
                : relationshipType === PROPOSITION_RELATION.INDEPENDENT ? 'INDEPENDENT' : relationshipType;
            const validationText = relationshipType === PROPOSITION_RELATION.SCOPE_COUPLED
                ? scopeValidationText(mainText, part.text, part.connector) : part.text;
            propositions.push({
                text: validationText,
                sourceText: part.sourceText,
                originalCompoundClaim: sentence,
                propositionText: part.text,
                propositionType,
                relationshipType,
                compoundId,
                factual: !isNonFactual(validationText)
            });
        });
    });
    return propositions.map((claim, index) => ({ id: `claim-${index + 1}`, ...claim }));
}

function hasNegation(text) {
    // A leading "لا،" may answer a negative yes/no question (for example
    // "عليها رسوم؟") while the factual proposition that follows is positive.
    const withoutDiscourseNo = String(text || '').replace(/^\s*لا\s*[,،]\s*/, '');
    const normalized = normalizeText(withoutDiscourseNo);
    if (/\b(?:not|never|no|cannot|can't|doesn't|isn't|without)\b/i.test(normalized)) return true;
    const tokens = new Set(normalized.split(/\s+/));
    return ['لا', 'ولا', 'ليس', 'وليست', 'ليست', 'غير', 'لن', 'لم', 'بدون']
        .some(token => tokens.has(token));
}

function negationResult(claim, evidence) {
    const claimNegated = hasNegation(claim);
    const evidenceNegated = hasNegation(evidence);
    return {
        claimNegated,
        evidenceNegated,
        relation: claimNegated === evidenceNegated ? 'ALIGNED' : 'MISMATCH'
    };
}

function normalizeQuantityText(text) {
    const clockWords = new Map([
        ['الواحده', 1], ['الاولي', 1], ['الثانيه', 2], ['الثالثه', 3],
        ['الرابعه', 4], ['الخامسه', 5], ['السادسه', 6], ['السابعه', 7],
        ['الثامنه', 8], ['التاسعه', 9], ['العاشره', 10],
        ['الحاديه عشر', 11], ['الثانيه عشر', 12]
    ]);
    let normalized = normalizeText(text);
    for (const [word, hour] of clockWords) {
        const escaped = word.replace(/ /g, '\\s+');
        normalized = normalized
            .replace(new RegExp(`(?:الساعه\\s+)?${escaped}\\s+والنصف(?=\\s|$)`, 'gu'), `${hour + 0.5} clock`)
            .replace(new RegExp(`(?:الساعه\\s+)?${escaped}(?=\\s+(?:صباحا|مساء|مساءا|ظهرا)|\\s*$)`, 'gu'), `${hour} clock`);
    }
    return normalized
        // HH:MM is a clock value. In particular, Arabic "الساعة" before it is
        // a clock marker, not a duration unit that must be matched separately.
        .replace(/(?:الساعه\s+)?(\d{1,2}):(\d{2})/g,
            (_, hours, minutes) => `${Number(hours) + Number(minutes) / 60} clock`)
        .replace(/(\d+(?:[.,]\d+)?)\s+(?=صباحا|مساء|مساءا|ظهرا)/g, '$1 clock ')
        .replace(/الساعه\s+(\d+(?:[.,]\d+)?)/g, '$1 clock')
        .replace(/ساعه\s+(\d+(?:[.,]\d+)?)/g, '$1 ساعه')
        .replace(/(ساعه|يوم|شيكل|دولار)\s+(واحده|واحد|احد)(?=[^\p{L}\p{N}]|$)/gu, '1 $1')
        .replace(/(?:^|\s)ساعتين(?=[^\p{L}\p{N}]|$)/gu, ' 2 ساعه')
        .replace(/(?:^|\s)(?:يومين|يومان)(?=[^\p{L}\p{N}]|$)/gu, ' 2 يوم');
}

function canonicalUnit(rawUnit) {
    const unit = normalizeText(rawUnit);
    if (['%', 'بالمئه', 'بالمائه'].includes(unit)) return 'PERCENT';
    if (['شيكل', 'شيقل', 'شواكل', 'شواقل', 'ils'].includes(unit)) return 'ILS';
    if (['دولار', 'دولارات', 'usd'].includes(unit)) return 'USD';
    if (['ساعه', 'ساعات', 'hour', 'hours'].includes(unit)) return 'HOUR';
    if (['دقيقه', 'دقائق', 'minute', 'minutes'].includes(unit)) return 'MINUTE';
    if (['يوم', 'يوما', 'ايام', 'اياما', 'day', 'days'].includes(unit)) return 'DAY';
    if (['كغم', 'كيلو', 'كيلوغرام', 'kg'].includes(unit)) return 'KILOGRAM';
    if (['بوصه', 'انش', 'inch', 'inches'].includes(unit)) return 'INCH';
    if (unit === 'clock') return 'CLOCK';
    return 'UNSPECIFIED';
}

function comparatorBefore(text, numberIndex, unit) {
    const prefix = text.slice(Math.max(0, numberIndex - 65), numberIndex);
    if (/(?:بعد\s+(?:ال)?(?:خصم|زياده))\s*$/iu.test(prefix)) return '=';
    if (/(?:على الاقل|لا يقل|at least)\s*$/i.test(prefix)) return '>=';
    if (/(?:اكثر من|اكبر من|فوق|تجاوز|يتجاوز|تتجاوز|greater than|more than|above|>)\s*[^\d]*$/i.test(prefix)) return '>';
    if (['HOUR', 'DAY', 'CLOCK'].includes(unit) && /(?:بعد)\s*(?:الساعه\s*)?$/iu.test(prefix)) return '>';
    if (/(?:على الاكثر|لا يزيد|at most)\s*$/i.test(prefix)) return '<=';
    if (/(?:لا\s+(?:يزيد|تزيد))\s+[^\d]{1,45}\s+(?:على|عن)\s*$/iu.test(prefix)) return '<=';
    if (/(?:اقل من|دون|less than|below|<)\s*[^\d]*$/i.test(prefix)) return '<';
    if (/(?:يقل|تقل)(?:\s+[^\d]{1,45})?\s+عن\s*$/iu.test(prefix)) return '<';
    if (/(?:يزيد|تزيد)\s+(?:عن|علي)\s*$/iu.test(prefix)) return '>';
    if (/(?:يزيد|تزيد)(?:\s+[^\d]{1,45})?\s+(?:عن|علي)\s*$/iu.test(prefix)) return '>';
    if (['HOUR', 'DAY'].includes(unit) && /(?:خلال|في غضون|within)\s*[^\d]*$/i.test(prefix)) return '<=';
    return '=';
}

function extractQuantities(text) {
    const normalized = normalizeQuantityText(text);
    const wordPattern = [...NUMBER_WORDS.keys()].join('|');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(\\d+(?:[.,]\\d+)?|${wordPattern})(?![\\p{L}\\p{N}])\\s*(%|بالمئه|بالمائه|شيكل|شيقل|شواكل|شواقل|ils|دولار|دولارات|usd|ساعه|ساعات|hour|hours|دقيقه|دقائق|minute|minutes|يوما|يوم|اياما|ايام|day|days|كغم|كيلو|كيلوغرام|kg|بوصه|انش|inch|inches|clock)?`, 'giu');
    const quantities = [];
    for (const match of normalized.matchAll(pattern)) {
        const numericText = match[1].replace(',', '.');
        const value = NUMBER_WORDS.get(numericText) ?? Number(numericText);
        if (!Number.isFinite(value)) continue;
        const unit = canonicalUnit(match[2] || '');
        let operator = comparatorBefore(normalized, match.index, unit);
        const prefix = normalized.slice(Math.max(0, match.index - 70), match.index);
        const suffix = normalized.slice(match.index + match[0].length, match.index + match[0].length + 24);
        if (operator === '=' && /(?:تقل|يقل)\s+عن\s*$/u.test(prefix)) operator = '<';
        if (operator === '=' && /(?:تزيد|يزيد)\s+علي\s*$/u.test(prefix)) operator = '>';
        if (operator === '=' && /^\s+(?:او اكثر|فما فوق|or more|and above)(?=\s|[:：.]|$)/iu.test(suffix)) operator = '>=';
        if (operator === '=' && /^\s+(?:او اقل|فما دون|or less|and below)(?=\s|[:：.]|$)/iu.test(suffix)) operator = '<=';
        quantities.push({ value, unit, operator });
    }
    return quantities;
}

function valueSatisfies(value, operator, threshold) {
    if (operator === '>') return value > threshold;
    if (operator === '>=') return value >= threshold;
    if (operator === '<') return value < threshold;
    if (operator === '<=') return value <= threshold;
    return value === threshold;
}

function approximatelyEqual(left, right) {
    return Math.abs(left - right) < 0.005;
}

function arithmeticResultSupported(quantity, claim, evidence, question) {
    if (quantity.operator !== '=' || !['ILS', 'USD'].includes(quantity.unit)) return false;
    const evidenceQuantities = extractQuantities(evidence);
    const userQuantities = extractQuantities(question || '');
    const bases = [...evidenceQuantities, ...userQuantities]
        .filter(item => item.unit === quantity.unit && item.operator === '=');
    const percentages = evidenceQuantities
        .filter(item => item.unit === 'PERCENT' && item.operator === '=');
    if (!bases.length || !percentages.length) return false;
    const normalizedClaim = normalizeText(claim);
    const discount = /(?:خصم|بعد\s+الخصم|discount)/iu.test(normalizedClaim);
    const increase = /(?:زياده|بعد\s+الزياده|increase)/iu.test(normalizedClaim);
    if (!discount && !increase) return false;
    return bases.some(base => percentages.some(percent => {
        const derived = discount
            ? base.value * (1 - percent.value / 100)
            : base.value * (1 + percent.value / 100);
        return approximatelyEqual(quantity.value, derived);
    }));
}

function numericEntailment(claim, evidence, options = {}) {
    const claimQuantities = extractQuantities(claim);
    const evidenceQuantities = extractQuantities(evidence);
    if (!claimQuantities.length) return { relation: 'NONE', claimQuantities, evidenceQuantities };
    if (!evidenceQuantities.length) return { relation: 'UNKNOWN', claimQuantities, evidenceQuantities };

    let derived = false;
    const questionQuantities = extractQuantities(options.question || '');
    for (const cq of claimQuantities) {
        const suppliedByUser = cq.operator === '=' && questionQuantities
            .some(item => item.unit === cq.unit && item.operator === '=' && item.value === cq.value);
        const arithmeticSupported = arithmeticResultSupported(cq, claim, evidence, options.question);
        if (arithmeticSupported) derived = true;
        if (arithmeticSupported) continue;
        const sameUnit = evidenceQuantities.filter(eq => eq.unit === cq.unit
            || (eq.unit === 'UNSPECIFIED' && cq.unit === 'UNSPECIFIED'));
        if (suppliedByUser) {
            const policySupportsInput = sameUnit.some(eq => eq.operator === '='
                ? eq.value === cq.value : valueSatisfies(cq.value, eq.operator, eq.value));
            if (policySupportsInput) { derived = true; continue; }
            return { relation: 'UNKNOWN', reason: 'user_value_not_business_evidence', claimQuantities, evidenceQuantities };
        }
        if (!sameUnit.length) {
            const sameValueDifferentUnit = evidenceQuantities.some(eq => eq.value === cq.value
                && eq.unit !== 'UNSPECIFIED' && cq.unit !== 'UNSPECIFIED');
            if (sameValueDifferentUnit) {
                return { relation: 'CONTRADICTED', reason: 'unit_mismatch', claimQuantities, evidenceQuantities };
            }
            return { relation: 'UNKNOWN', reason: 'unit_missing', claimQuantities, evidenceQuantities };
        }
        const entailed = sameUnit.some(eq => {
            if (cq.operator === '=' && eq.operator !== '=') {
                return valueSatisfies(cq.value, eq.operator, eq.value);
            }
            return cq.operator === eq.operator && cq.value === eq.value;
        });
        if (!entailed) {
            return { relation: 'CONTRADICTED', reason: 'value_or_condition_mismatch', claimQuantities, evidenceQuantities };
        }
    }
    // Mark a valid instance-of-threshold conclusion as derived.  Both the
    // user's concrete value and the policy comparator remain independently
    // checked; this does not equate or relax >, >=, <, <=.
    if (questionQuantities.some(userValue => userValue.operator === '='
        && evidenceQuantities.some(boundary => boundary.unit === userValue.unit
            && boundary.operator !== '='
            && valueSatisfies(userValue.value, boundary.operator, boundary.value)))) {
        derived = true;
    }
    return { relation: 'ENTAILED', derived, claimQuantities, evidenceQuantities };
}

function topicSimilarity(claim, evidence) {
    const claimTokens = new Set(canonicalTokens(claim).filter(token => !extractNumbers(token).length));
    const evidenceTokens = new Set(canonicalTokens(evidence).filter(token => !extractNumbers(token).length));
    return setSimilarity(claimTokens, evidenceTokens);
}

function contradictionScore(claim, evidence, options = {}) {
    const topic = topicSimilarity(claim, evidence);
    if (topic < 0.18) return 0;
    const numeric = numericEntailment(claim, evidence, options);
    if (numeric.relation === 'CONTRADICTED') return clamp(0.72 + topic * 0.28);
    if (negationResult(claim, evidence).relation === 'MISMATCH' && topic >= 0.35) {
        return clamp(0.65 + topic * 0.25);
    }
    return 0;
}

const COMPLETE_LIST_MARKER = /(?:القائمه\s+(?:الكامله|الشامله)|القائمه.{0,30}كامل|هذه\s+(?:هي\s+)?(?:كل|جميع)|جميع\s+ال\p{L}+|ال\p{L}+\s+كافه|complete\s+(?:current\s+)?list|all\s+current)/iu;

const LIST_STRUCTURAL_TOKENS = new Set([
    'فقط', 'كل', 'جميع', 'كامل', 'كامله', 'حاليا', 'قائمه', 'هذه', 'هي',
    'نحن', 'عندنا', 'لدينا', 'ضمن', 'موجود', 'يوجد', 'نعم', 'تاليه',
    'only', 'all', 'complete', 'current', 'list'
]);

function looseArabicStem(token) {
    let value = String(token || '');
    if (!/^[\u0600-\u06FF]+$/u.test(value)) return value;
    value = value.replace(/^(?:وال|بال|كال|فال|لل|ال)/u, '')
        .replace(/(?:كما|كم|كن|هم|هن|ها|نا|ون|ين|ات|وا|ه|ي)$/u, '');
    return value.replace(/[اويى]/gu, '');
}

function looseArabicStemVariants(token) {
    const variants = [looseArabicStem(token)];
    // Include common conjunction/preposition and imperfect-verb prefixes as
    // optional variants; the unstripped form is retained to avoid forcing a
    // stem interpretation on nouns that genuinely begin with these letters.
    if (/^[وبفكلتني][\u0600-\u06FF]{3,}$/u.test(token)) {
        variants.push(looseArabicStem(token.slice(1)));
    }
    return [...new Set(variants.filter(Boolean))];
}

function explicitCompleteLists(evidence) {
    const source = String(evidence || '');
    const sentenceLists = source.replace(/\n+/g, ' ')
        .split(/(?<=[.!?\u061f\u061b])\s+/u).flatMap(sentence => {
        const normalized = normalizeText(sentence);
        if (!COMPLETE_LIST_MARKER.test(normalized)) return [];
        const colon = sentence.indexOf(':');
        if (colon < 0) return [];
        const header = normalizeText(sentence.slice(0, colon));
        const members = sentence.slice(colon + 1)
            .split(/[,،\n]|\s+و(?=[\p{L}])/u)
            .map(member => normalizeText(member.replace(/[.!؟؛]+$/u, '').trim()))
            .filter(Boolean);
        return members.length ? [{ header, members }] : [];
        });
    return sentenceLists;
}

function listScopeMatches(list, claim, question = '') {
    const memberTokens = new Set(list.members.flatMap(canonicalTokens));
    const headerStems = new Set(canonicalTokens(list.header)
        .filter(token => !LIST_STRUCTURAL_TOKENS.has(token) && !memberTokens.has(token))
        .flatMap(looseArabicStemVariants).filter(stem => stem.length >= 2));
    const assertionStems = new Set(canonicalTokens(`${claim} ${question}`)
        .filter(token => !LIST_STRUCTURAL_TOKENS.has(token) && !memberTokens.has(token))
        .flatMap(looseArabicStemVariants).filter(stem => stem.length >= 2));
    return [...headerStems].some(stem => assertionStems.has(stem));
}

function completeListEntailment(claim, evidence, options = {}) {
    const normalizedEvidence = normalizeText(evidence);
    if (!COMPLETE_LIST_MARKER.test(normalizedEvidence)) return false;
    const lists = explicitCompleteLists(evidence);
    const normalizedAssertion = normalizeText(`${claim} ${options.question || ''}`);
    const assertionStems = new Set(canonicalTokens(normalizedAssertion).flatMap(looseArabicStemVariants));
    for (const list of lists) {
        if (!listScopeMatches(list, claim, options.question)) continue;
        const mentionedMembers = list.members.filter(member => canonicalTokens(member)
            .every(token => looseArabicStemVariants(token).some(stem => assertionStems.has(stem))));
        if (!hasNegation(claim) && mentionedMembers.length === 1) return true;
        if (hasNegation(claim)) {
            const evidenceTokens = new Set(canonicalTokens(evidence));
            const absent = canonicalTokens(claim).filter(token => token.length > 2
                && !LIST_STRUCTURAL_TOKENS.has(token) && !evidenceTokens.has(token));
            if (absent.length) return true;
        }
    }
    const claimTokens = new Set(canonicalTokens(claim));
    const evidenceTokens = new Set(canonicalTokens(evidence));
    const shared = [...claimTokens].filter(token => evidenceTokens.has(token)
        && token.length > 2 && !['يوجد', 'موجود', 'حاليا', 'قائمه', 'كامله'].includes(token));
    if (!shared.length) return false;
    if (hasNegation(claim)) {
        const member = canonicalTokens(claim).at(-1);
        return Boolean(member && !evidenceTokens.has(member));
    }
    const structural = new Set([
        ...LIST_STRUCTURAL_TOKENS,
        'نحن', 'تعامل', 'شركه', 'تامين', 'وهما', 'هما', 'تاليه', 'تاليتين',
        'only', 'all', 'complete'
    ]);
    // Positive membership/enumeration does not need to repeat the source's
    // word "complete". It is supported when every substantive asserted member
    // occurs in an explicitly complete source list. Absence still uses the
    // stricter negative branch above, so incomplete lists never become closed.
    return [...claimTokens].filter(token => token.length > 2
        && !structural.has(token) && !evidenceTokens.has(token)).length === 0;
}

function completeListAcrossAdjacentChunks(claim, chunks, options = {}) {
    for (const left of chunks) for (const right of chunks) {
        if (left === right || !left.documentId || left.documentId !== right.documentId) continue;
        if (!Number.isInteger(left.chunkIndex) || right.chunkIndex !== left.chunkIndex + 1) continue;
        const text = `${left.text}\n${right.text}`;
        if (completeListEntailment(claim, text, options)) {
            return { ids: [left.id, right.id], text };
        }
    }
    return null;
}

function scoreEvidence(claim, chunk, options = {}) {
    // Completeness is a document-level assertion whose members are commonly
    // formatted as separate list lines. Segmenting first discards that scope.
    const segments = splitIntoSentences(chunk.text).flatMap(segment =>
        segment.split(/[،,]\s*(?=(?:و)?لا\s+)/u).map(part => part.trim()).filter(Boolean));
    const candidates = completeListEntailment(claim, chunk.text, options)
        ? [chunk.text]
        : segments.length ? segments : [chunk.text];
    const candidateRelevance = evidence => {
        const numeric = numericEntailment(claim, evidence, options).relation;
        const negation = negationResult(claim, evidence).relation;
        return semanticSimilarity(claim, evidence)
            + (numeric === 'ENTAILED' ? 0.30 : numeric === 'CONTRADICTED' ? -0.20 : 0)
            + (negation === 'ALIGNED' ? 0.08 : -0.22);
    };
    const bestText = [...candidates].sort((left, right) =>
        candidateRelevance(right) - candidateRelevance(left)
    )[0];
    const absenceEvidence = /(?:no information|not documented|unknown|لا معلومات|لا توجد معلومات|غير موثق)/i
        .test(bestText);
    let numericResult = numericEntailment(claim, bestText, options);
    let numericEvidenceText = bestText;
    // A single claim may faithfully combine independent numeric conditions
    // documented in separate sentences of the same trusted chunk (for example
    // an order-value threshold and a TV-size exception). Use the whole chunk
    // only when it proves every quantity; never use it to rescue a mismatch.
    if (extractQuantities(claim).length > 1 && numericResult.relation !== 'ENTAILED') {
        const combinedNumericResult = numericEntailment(claim, chunk.text, options);
        if (combinedNumericResult.relation === 'ENTAILED') {
            numericResult = combinedNumericResult;
            numericEvidenceText = chunk.text;
        }
    }
    const keyword = keywordCoverage(claim, numericEvidenceText);
    const reverseKeyword = bidirectionalCoverage(claim, numericEvidenceText);
    const semantic = semanticSimilarity(claim, numericEvidenceText);
    const completeList = completeListEntailment(claim, chunk.text, options);
    const negation = completeList
        ? { claimNegated: hasNegation(claim), evidenceNegated: false, relation: 'ALIGNED' }
        : negationResult(claim, bestText);
    const contradiction = absenceEvidence ? 0 : contradictionScore(claim, numericEvidenceText, options);
    const claimNumbers = extractNumbers(claim);
    const evidenceNumbers = extractNumbers(numericEvidenceText);
    const numericExact = !claimNumbers.length || numericResult.relation === 'ENTAILED';
    const agreement = absenceEvidence ? 0 : clamp(
        semantic * 0.45
        + keyword * 0.35
        + chunk.retrievalScore * 0.10
        + chunk.rerankerScore * 0.10
    );
    return {
        chunk, matchedEvidence: numericEvidenceText, keyword, reverseKeyword, semantic, contradiction,
        numericExact, numericResult, negationResult: negation, completeList, agreement, absenceEvidence,
        evidenceHasNumbers: evidenceNumbers.length > 0
    };
}

function classifyClaim(claim, chunks, options = {}) {
    if (!claim.factual) {
        return {
            ...claim, classification: STATUS.UNKNOWN, confidence: 0.5,
            evidenceChunkIds: [], similarity: 0, keywordOverlap: 0,
            citationCoverage: 0, missingEvidence: false, contradictionScore: 0
        };
    }
    const claimIsNegated = hasNegation(claim.text);
    const adjacentListSupport = completeListAcrossAdjacentChunks(claim.text, chunks, options);
    const matchPriority = match => match.numericResult.relation === 'ENTAILED'
        ? 2 + match.agreement
        : claimIsNegated && match.negationResult.relation === 'ALIGNED' && match.keyword >= 0.25
            ? 1 + match.agreement : Math.max(match.agreement, match.contradiction);
    const matches = chunks.map(chunk => scoreEvidence(claim.text, chunk, options))
        .sort((left, right) => matchPriority(right) - matchPriority(left));
    const best = matches[0];
    if (!best) {
        return {
            ...claim, classification: STATUS.UNSUPPORTED, confidence: 0,
            evidenceChunkIds: [], similarity: 0, keywordOverlap: 0,
            citationCoverage: 0, missingEvidence: true, contradictionScore: 0
        };
    }

    let classification;
    const policyGuard = evaluateConditionalPolicy({
        claim: claim.text,
        question: options.question || '',
        chunks,
        tenantId: options.tenantId || '',
        extractQuantities
    });
    if (best.absenceEvidence) {
        classification = STATUS.UNSUPPORTED;
    } else if (best.contradiction >= 0.72) {
        classification = STATUS.CONTRADICTED;
    } else if (best.numericResult.relation === 'CONTRADICTED') {
        classification = STATUS.CONTRADICTED;
    } else if (!best.numericExact && extractNumbers(claim.text).length) {
        classification = best.evidenceHasNumbers && (best.semantic >= 0.22 || best.keyword >= 0.22)
            ? STATUS.CONTRADICTED : STATUS.UNSUPPORTED;
    } else if (best.completeList
        || (best.numericResult.relation === 'ENTAILED' && best.numericResult.derived
            && best.keyword >= 0.10)
        || (best.numericResult.relation === 'ENTAILED' && best.keyword >= 0.35)
        || (best.agreement >= 0.57 && best.keyword >= 0.42)
        || best.keyword >= 0.62
        || (best.reverseKeyword >= 0.75 && best.semantic >= 0.28
            && best.negationResult.relation === 'ALIGNED'
            && !['UNKNOWN', 'CONTRADICTED'].includes(best.numericResult.relation))) {
        classification = STATUS.SUPPORTED;
    } else if (best.agreement >= 0.42 && (best.keyword >= 0.28 || best.semantic >= 0.34)) {
        classification = STATUS.PARTIAL;
    } else {
        classification = STATUS.UNSUPPORTED;
    }

    // Separate evidence sentences may establish both sides of a statement, but
    // they cannot establish a causal link between them. The relationship itself
    // must appear in the selected evidence sentence.
    if (claim.relationshipType === PROPOSITION_RELATION.CAUSAL
        && !CAUSAL_CONNECTOR.test(best.matchedEvidence)) {
        classification = STATUS.UNSUPPORTED;
    }

    const derivedResult = validateDerivedClaim({
        claim: claim.text,
        question: options.question || '',
        chunks,
        tenantId: options.tenantId || '',
        now: options.now || new Date()
    });
    if (derivedResult?.status === DERIVED_STATUS.SUPPORTED) {
        classification = STATUS.SUPPORTED;
    }
    if (adjacentListSupport) classification = STATUS.SUPPORTED;
    if (policyGuard.relation === POLICY_RELATION.SUPPORTED) classification = STATUS.SUPPORTED;
    if (policyGuard.relation === POLICY_RELATION.BLOCK) classification = STATUS.CONTRADICTED;

    // numericEntailment can prove an instance of a business rule using a value
    // supplied in the user's question.  Preserve the exact server evidence
    // that performed that proof even when lexical supporting-score thresholds
    // do not select it a second time.  User values are premises, not evidence.
    const numericDerivedProvenance = best.numericResult.relation === 'ENTAILED'
        && best.numericResult.derived
        && best.chunk.id
        && (!options.tenantId || !best.chunk.tenantId
            || String(best.chunk.tenantId) === String(options.tenantId))
        ? {
            operation: best.numericResult.evidenceQuantities.some(quantity => quantity.operator !== '=')
                ? 'THRESHOLD_APPLICATION' : 'NUMERIC_DERIVATION',
            inputs: [
                ...extractQuantities(options.question || '').map(quantity => ({
                    ...quantity, source: 'USER_INPUT', evidenceId: null
                })),
                ...best.numericResult.evidenceQuantities.map(quantity => ({
                    ...quantity, source: 'EVIDENCE', evidenceId: best.chunk.id
                }))
            ],
            evidenceIds: [best.chunk.id]
        } : null;
    const effectiveDerivedProvenance = derivedResult?.status === DERIVED_STATUS.SUPPORTED
        ? derivedResult.provenance : numericDerivedProvenance;

    const supporting = matches
        .filter(match => match.contradiction < 0.72
            && !match.absenceEvidence
            && match.numericExact
            && (match.completeList || match.agreement >= 0.42 || match.keyword >= 0.35))
        .slice(0, 3);
    const evidenceChunkIds = adjacentListSupport
        ? adjacentListSupport.ids
        : effectiveDerivedProvenance
            ? [...new Set(effectiveDerivedProvenance.evidenceIds)]
            : supporting.map(match => match.chunk.id);
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
        numericExact: best.numericExact,
        matchedEvidenceId: evidenceChunkIds[0] || best.chunk.id,
        matchedSentence: adjacentListSupport?.text || best.matchedEvidence,
        semanticScore: Number(best.semantic.toFixed(4)),
        numericResult: derivedResult?.status === DERIVED_STATUS.SUPPORTED
            ? { relation: 'ENTAILED', derived: true,
                claimQuantities: extractQuantities(claim.text), evidenceQuantities: [] }
            : best.numericResult,
        derivedStatus: effectiveDerivedProvenance ? DERIVED_STATUS.SUPPORTED
            : derivedResult?.status || null,
        derivedProvenance: effectiveDerivedProvenance || null,
        completeListEntailed: Boolean(best.completeList || adjacentListSupport),
        negationResult: best.negationResult,
        finalClassification: classification,
        policyGuard
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
    if ([STATUS.INSUFFICIENT, STATUS.UNSUPPORTED].includes(status)) {
        return safeReplacement(answer);
    }
    let output = answer;
    let replacementInserted = false;
    const unsafeScopeGroups = new Set(claims
        .filter(claim => claim.relationshipType === PROPOSITION_RELATION.SCOPE_COUPLED
            && [STATUS.UNSUPPORTED, STATUS.CONTRADICTED].includes(claim.classification))
        .map(claim => claim.compoundId));
    const replacedGroups = new Set();
    for (const claim of claims) {
        if (claim.classification !== STATUS.UNSUPPORTED
            && claim.classification !== STATUS.CONTRADICTED) continue;
        // Multiple unsupported claims are one validation outcome, not multiple
        // user-facing failures. Preserve supported/non-factual text while emitting
        // the localized fallback at most once for the whole answer.
        const replacement = replacementInserted ? '' : safeReplacement(answer);
        if (unsafeScopeGroups.has(claim.compoundId)) {
            if (replacedGroups.has(claim.compoundId)) continue;
            output = output.replace(claim.originalCompoundClaim, replacement);
            replacedGroups.add(claim.compoundId);
        } else {
            output = output.replace(claim.sourceText || claim.propositionText || claim.text, replacement);
        }
        replacementInserted = true;
    }
    return output
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/(?:\r?\n[ \t]*){3,}/g, '\n\n')
        .trim();
}

function validateDetailed(answer, retrievedContext, options = {}) {
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
    const claims = extracted.map(claim => classifyClaim(claim, chunks, options));
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

function validateAnswer(answer, retrievedContext, options = {}) {
    const result = validateDetailed(answer, retrievedContext, options);
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
    PROPOSITION_RELATION,
    ARABIC_UNVERIFIED_MESSAGE,
    splitIntoSentences,
    extractNumbers,
    extractClaims,
    normalizeChunks,
    semanticSimilarity,
    keywordCoverage,
    extractQuantities,
    numericEntailment,
    hasNegation,
    contradictionScore,
    validateDetailed,
    validateAnswer,
    getLastValidationMetadata
};
