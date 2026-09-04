const DECISION = Object.freeze({
    ANSWER: 'ANSWER',
    NO_ANSWER: 'NO_ANSWER',
    CLARIFY: 'CLARIFY'
});

const ARABIC_CLARIFY_MESSAGE = 'ممكن توضّح المقصود أكثر؟';

const AMBIGUITY_TYPE = Object.freeze({
    REFERENT: 'REFERENT_AMBIGUITY',
    ATTRIBUTE_TARGET: 'ATTRIBUTE_TARGET_AMBIGUITY',
    ACTION_TARGET: 'ACTION_TARGET_AMBIGUITY',
    REQUIRED_PARAMETER: 'REQUIRED_PARAMETER_MISSING',
    LIVE_STATE: 'LIVE_STATE_MISSING',
    KNOWLEDGE: 'KNOWLEDGE_MISSING',
    NONE: 'NOT_AMBIGUOUS'
});

function normalize(text) {
    return String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const AMBIGUOUS_WITHOUT_REFERENCE = [
    /^(?:قديش|كم)\s+(?:سعر|حق)(?:ها|ه)\??$/,
    /^(?:و)?بعدها\s+(?:بقدر|يمكنني|اقدر)?\s*(?:اعدله|اغيره|تعديله)\??$/,
    /^متي\s+(?:بوصل|بتوصل|يوصل)\??$/,
    /^شو\s+بصير\s+بعدين\??$/,
    /^(?:هل\s+)?يشملها\s+العرض\??$/,
    /^متي\s+موعدي\??$/,
    /^(?:هل\s+)?(?:التامين|تامين)\s+(?:ب)?شملها\??$/,
    /^مين\s+الدكتور\s+المناسب\??$/,
    /^(?:هل\s+)?الدكتور\s+(?:متوفر|متاح|موجود)\??$/
];

const REFERENCE_TERMS = /(?:طلب|طلبيه|منتج|قطعه|شحن|توصيل|عرض|صوره|شخص|خدمه|فرع|متجر|موعد|باقه|مشروع)/;
const CURRENT_INTENT = /(?:^|\s)(?:اليوم|هاليوم|حاليا|الان|هسا|هسه|هلا|هلق)(?:\s|$)|اليومين\s+هدول|(?:العرض|العروض|الخصم|الخصومات|المتوفر|المتاح)\s+الحالي(?:ه)?/u;
const FUTURE_INTENT = /(?:بكره|غدا|الاسبوع\s+القادم|الاسبوع\s+الجاي|الشهر\s+القادم|الشهر\s+الجاي|tomorrow|next\s+(?:week|month))/iu;
const CURRENT_EVIDENCE = /(?:^|\s)(?:اليوم|حاليا|الان|هسا|هسه|هلا|هلق)(?:\s|$)|(?:العرض|الخصم|المنتج|الخدمه|التوصيل|الشحن|متوفر|متاح)\s+الحالي(?:ه)?|(?:ساري|فعال|متوفر|متاح)\s+(?:اليوم|حاليا|الان)/u;
const CURRENT_STATE_UNPROVEN = /(?:لا\s+(?:توجد|يوجد|تتوفر|يتوفر).{0,80}(?:معلومات|بيانات|تثبت)|لا\s+تثبت|غير\s+(?:متوفره|موجوده)|بيانات.{0,30}غير\s+موجوده)/u;
const AMBIGUOUS_CURRENT_REFERENCE = /^(?:هل\s+)?(?:هو|هي)?\s*(?:متوفر|متاح|موجود)\s+(?:اليوم|حاليا|الان|هسا|هسه|هلا|هلق)$/u;
const FOLLOW_UP_OPERATION = /(?:بدي|اريد|حاب|حابب|ممكن|بقدر)?\s*(?:اغير|اعدل|الغي|احذف|انقل|اجل|اقدم|ارجع|استبدل)/u;
const REFERENT_NOUN = /(?:موعد|حجز|طلب|طلبيه|منتج|قطعه)/u;
const REFERENT_FILLER = new Set(['ال', 'هذا', 'هذه', 'هدا', 'هذي', 'تبع', 'تبعي', 'تبعنا', 'الي', 'اللي', 'المذكور']);
const UNRESOLVED_VALUE_QUESTION = /^(?:كم|قديش)\s+(?:بتاخد|بياخد|بتوخذ|بيوخذ|تاخذ|ياخذ|تستغرق|يستغرق)(?:\s+(?:وقت|زمن|مده))?$/u;
const CANDIDATE_FILLER = new Set([
    'تستغرق', 'يستغرق', 'تاخذ', 'ياخذ', 'بتاخد', 'بياخد',
    'مده', 'وقت', 'زمن', 'خلال', 'حوالي', 'الخدمه', 'خدمه', 'الباقه', 'باقه',
    'المشروع', 'مشروع', 'المنتج', 'منتج', 'من', 'في', 'على', 'الى'
]);

function referentPhrases(text) {
    const tokens = normalize(text).split(/\s+/).filter(Boolean);
    const phrases = [];
    tokens.forEach((token, index) => {
        if (!REFERENT_NOUN.test(token)) return;
        const descriptor = tokens.slice(index + 1, index + 5)
            .filter(value => !REFERENT_FILLER.has(value) && !FOLLOW_UP_OPERATION.test(value))
            .join(' ');
        if (descriptor) phrases.push(`${token} ${descriptor}`);
    });
    return phrases;
}

function followUpReferentStatus(query, history = []) {
    const normalizedQuery = normalize(query);
    if (!FOLLOW_UP_OPERATION.test(normalizedQuery) || !REFERENT_NOUN.test(normalizedQuery)) {
        return 'NOT_APPLICABLE';
    }
    if (referentPhrases(normalizedQuery).length) return 'EXPLICIT';
    const historyReferents = [...new Set((history || []).slice(-6)
        .filter(message => message?.role === 'user')
        .flatMap(message => referentPhrases(message.content)))];
    if (historyReferents.length === 1) return 'HISTORY_SINGLE';
    if (historyReferents.length > 1) return 'HISTORY_MULTIPLE';
    return 'UNRESOLVED';
}

function historyReferentCount(history = []) {
    const phrases = (history || []).slice(-6)
        .filter(message => message?.role === 'user')
        .flatMap(message => {
            const tokens = normalize(message.content).split(/\s+/).filter(Boolean);
            return tokens.flatMap((token, index) => {
                if (!REFERENCE_TERMS.test(token)) return [];
                const descriptor = tokens.slice(index + 1, index + 4)
                    .filter(value => !REFERENT_FILLER.has(value))
                    .join(' ');
                return descriptor ? [`${token} ${descriptor}`] : [];
            });
        });
    return new Set(phrases).size;
}

function normalizeForReference(text) {
    return String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/[^‌\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function explicitHistoryReferents(history = []) {
    const candidates = [];
    for (const message of (history || []).slice(-6)) {
        if (message?.role !== 'user') continue;
        const text = normalizeForReference(message.content);
        for (const match of text.matchAll(/(?:^|\s)(?:عن|وعن|حول|بخصوص)\s+(.+?)(?=\s+(?:وعن|او|لكن)\s+|$)/gu)) {
            if (match[1]) candidates.push(match[1]);
        }
    }
    return [...new Set(candidates.map(normalizeForReference).filter(Boolean))];
}

function genericHistoryReferenceState(history = []) {
    const count = Math.max(explicitHistoryReferents(history).length, historyReferentCount(history));
    if (count === 1) return 'HISTORY_SINGLE';
    if (count > 1) return 'HISTORY_MULTIPLE';
    return 'UNRESOLVED';
}

function hasUnresolvedPronoun(text) {
    const tokens = normalizeForReference(text).split(/\s+/).filter(Boolean);
    if (/^(?:هل\s+)?(?:هو|هي)(?:\s|$)/u.test(tokens.join(' '))) return true;
    const pronounIndex = tokens.findIndex(token => {
        if (/(?:ها|هم|هن)$/u.test(token) && token.length > 3) return true;
        // Keep taa-marbuta words (for example a generic entity noun) distinct
        // from a masculine attached pronoun before applying the final-heh rule.
        return /ه$/u.test(token) && !/^(?:ال|بال|لل)/u.test(token)
            && !/ة$/u.test(token) && token.length > 3;
    });
    if (pronounIndex < 0) return false;
    const pronoun = tokens[pronounIndex];
    const hasExplicitAntecedent = tokens.filter((_, index) => index !== pronounIndex)
        .some(token => /^(?:ال|وال|بال|لل)\p{L}{2,}$/u.test(token));
    // A named/definite argument earlier in the same utterance resolves the
    // attachment. The colloquial possessive particle itself still points to a
    // missing referent rather than naming one.
    if (hasExplicitAntecedent && !/^(?:تبع|الي|اللي)(?:ها|ه)$/u.test(pronoun)) return false;
    return tokens.length <= 4 || /^(?:تبع|الي|اللي)(?:ها|ه)$/u.test(pronoun);
}

function isShortEllipticalQuestion(text) {
    const tokens = normalizeForReference(text).split(/\s+/).filter(Boolean);
    if (tokens.length > 3) return false;
    if (/^(?:متي|وين)(?:\s+\p{L}+)?$/u.test(tokens.join(' '))) return true;
    return /^(?:كم|قديش)\s+(?:بتاخد|بياخد|بتوخذ|بيوخذ|تستغرق)(?:\s+(?:وقت|مده))?$/u.test(normalize(text));
}

function isActionWithMissingTarget(text) {
    const normalized = normalizeForReference(text);
    return /^(?:بدي|اريد|حاب|حابب|ممكن|بقدر)\s+\p{L}*(?:ها|ه)$/u.test(normalized);
}

function analyzeAmbiguity(query, history = []) {
    const normalizedQuery = normalize(query);
    const liveState = hasCurrentIntent(normalizedQuery);
    const historyState = genericHistoryReferenceState(history);
    const pronounMissing = hasUnresolvedPronoun(query);
    const elliptical = isShortEllipticalQuestion(query);
    const actionTarget = isActionWithMissingTarget(query);
    const referenceMissing = pronounMissing || elliptical || actionTarget;
    const resolvedByHistory = referenceMissing && historyState === 'HISTORY_SINGLE';
    const multipleCandidates = referenceMissing && historyState === 'HISTORY_MULTIPLE';
    if (referenceMissing && !resolvedByHistory) {
        const missingType = actionTarget ? AMBIGUITY_TYPE.ACTION_TARGET
            : elliptical && /^(?:كم|قديش)/u.test(normalizedQuery)
                ? AMBIGUITY_TYPE.ATTRIBUTE_TARGET : AMBIGUITY_TYPE.REFERENT;
        return {
            missingField: actionTarget ? 'actionTarget' : 'referent',
            missingType,
            canUserResolve: true,
            alreadySpecified: false,
            requiresLiveData: liveState,
            referentState: multipleCandidates ? 'MULTIPLE' : 'UNRESOLVED',
            reason: multipleCandidates ? 'multiple_candidate_referents' : 'user_resolvable_missing_reference'
        };
    }
    return {
        missingField: null,
        missingType: liveState ? AMBIGUITY_TYPE.LIVE_STATE : AMBIGUITY_TYPE.NONE,
        canUserResolve: false,
        alreadySpecified: true,
        requiresLiveData: liveState,
        referentState: resolvedByHistory ? 'HISTORY_SINGLE' : 'EXPLICIT_OR_NOT_REQUIRED',
        reason: liveState ? 'business_owned_live_state' : 'not_ambiguous'
    };
}

function evidenceValueCandidates(chunks = []) {
    // Reuse the validator's quantity extraction. This layer only associates an
    // already-extracted value with its nearest lexical referent.
    const { extractQuantities } = require('./answerValidator');
    const candidates = [];
    for (const chunk of chunks || []) {
        const text = String(chunk?.text || chunk?.payload?.text || '');
        for (const clause of text.split(/[\n.!?؟؛،]+|\s+و(?=[\p{L}])/u)) {
            const quantities = extractQuantities(clause);
            if (!quantities.length) continue;
            const firstNumber = normalize(clause).search(/\d/u);
            const prefix = normalize(clause).slice(0, firstNumber < 0 ? undefined : firstNumber);
            const anchor = prefix.split(/\s+/).filter(token => token && !CANDIDATE_FILLER.has(token)).at(-1);
            if (!anchor) continue;
            for (const quantity of quantities) {
                candidates.push({
                    anchor,
                    value: `${quantity.operator}:${quantity.value}:${quantity.unit}`
                });
            }
        }
    }
    return candidates;
}

function multipleCandidateReferentStatus(query, history = [], chunks = []) {
    if (!UNRESOLVED_VALUE_QUESTION.test(normalize(query))) return 'NOT_APPLICABLE';
    const historyCount = historyReferentCount(history);
    if (historyCount === 1) return 'HISTORY_SINGLE';
    if (historyCount > 1) return 'HISTORY_MULTIPLE';
    const candidates = evidenceValueCandidates(chunks);
    const anchors = new Set(candidates.map(candidate => candidate.anchor));
    const values = new Set(candidates.map(candidate => candidate.value));
    if (!anchors.size) return 'UNRESOLVED';
    return anchors.size > 1 && values.size > 1 ? 'MULTIPLE_CANDIDATES' : 'NOT_AMBIGUOUS';
}

// High-risk business attributes must be explicitly present in evidence. A broad
// shipping or store chunk is not evidence for a price, warranty, branch or policy.
const REQUIRED_EVIDENCE = [
    { query: /(?:فرع|فروع|عنوان|موقع)/, evidence: /(?:فرع|فروع|عنوان|موقع)/ },
    { query: /(?:كفال|ضمان)/, evidence: /(?:كفال|ضمان)/ },
    { query: /(?:تقسيط|اقساط)/, evidence: /(?:تقسيط|اقساط)/ },
    { query: /(?:مده|كم يوم|متى بوصل|وقت).*(?:توصيل|شحن)|(?:توصيل|شحن).*(?:مده|كم يوم|متى)/, evidence: /(?:مده|يوم|ساعه).*(?:توصيل|شحن)|(?:توصيل|شحن).*(?:مده|يوم|ساعه)/ },
    { query: /(?:رسوم|تكلف|سعر).*(?:توصيل|شحن)|(?:توصيل|شحن).*(?:رسوم|تكلف|سعر)/, evidence: /(?:رسوم|تكلف|سعر).*(?:توصيل|شحن)|(?:توصيل|شحن).*(?:رسوم|تكلف|سعر)/ },
    { query: /(?:طرق|طريقه).*(?:دفع)|(?:دفع عند الاستلام)/, evidence: /(?:دفع|نقد|بطاق|فيزا|استلام)/ },
    { query: /(?:دوام|فاتح|مفتوح|اغلاق|سكر)/, evidence: /(?:دوام|فاتح|مفتوح|اغلاق|سكر)/ },
    { query: /(?:ارجاع|استرجاع)/, evidence: /(?:ارجاع|استرجاع)/ },
    { query: /(?:رقم).*(?:خدمه|دعم|تواصل)|(?:هاتف|تلفون)/, evidence: /(?:رقم|هاتف|تلفون|\+\d)/ },
    { query: /(?:بريد|ايميل|email)/, evidence: /(?:بريد|ايميل|email|@)/ },
    { query: /(?:اردن|قمر|خارج البلاد|دولي)/, evidence: /(?:اردن|قمر|خارج البلاد|دولي)/ },
    { query: /(?:اصلي|اصليه|اصليه)/, evidence: /(?:اصلي|اصليه|اصليه)/ },
    { query: /(?:الغاء|الغي|الغي).*(?:طلب)/, evidence: /(?:الغاء|الغي|الغي)/ },
    { query: /(?:استبدال|تبديل).*(?:مقاس)/, evidence: /(?:استبدال|تبديل).*(?:مقاس)/ },
    { query: /(?:سعر|تكلف).*(?:باقه|اشتراك)|(?:باقه|اشتراك).*(?:سعر|تكلف)/, evidence: /(?:سعر|تكلف).*(?:باقه|اشتراك)|(?:باقه|اشتراك).*(?:سعر|تكلف)/ }
];

function requiredEvidenceSatisfied(rule, query, evidence) {
    if (rule.evidence.test(evidence)) return true;
    // A schedule can be stated as an entity "works/operates" followed by a
    // clock range without repeating the query noun "hours".
    const asksForHours = /(?:دوام|فاتح|مفتوح|اغلاق|سكر)/u.test(query);
    const provesHours = /(?:يعمل|تعمل|نعمل|العمل).{0,100}\d{1,2}\s+\d{2}.{0,12}\d{1,2}\s+\d{2}/u.test(evidence);
    return asksForHours && provesHours;
}

function historyHasReference(history) {
    return (history || []).slice(-3).some(message =>
        message?.role === 'user' && (REFERENCE_TERMS.test(normalize(message.content))
            || (Array.isArray(message.referents) && message.referents.length > 0)
            || (Array.isArray(message.metadata?.referents) && message.metadata.referents.length > 0))
    );
}

function needsClarification(query, history = [], chunks = []) {
    const normalizedQuery = normalize(query);
    const ambiguity = analyzeAmbiguity(query, history);
    const candidateStatus = multipleCandidateReferentStatus(normalizedQuery, history, chunks);
    const legacyFollowUpStatus = followUpReferentStatus(normalizedQuery, history);
    const resolvedBySingleCandidate = ambiguity.missingType === AMBIGUITY_TYPE.ATTRIBUTE_TARGET
        && ['NOT_AMBIGUOUS', 'HISTORY_SINGLE'].includes(candidateStatus);
    const resolvedByKnownHistory = ambiguity.canUserResolve
        && (ambiguity.referentState === 'HISTORY_SINGLE'
            || legacyFollowUpStatus === 'HISTORY_SINGLE');
    return ambiguity.canUserResolve && !resolvedBySingleCandidate && !resolvedByKnownHistory
        || AMBIGUOUS_WITHOUT_REFERENCE.some(pattern => pattern.test(normalizedQuery))
        && !historyHasReference(history)
        || ['UNRESOLVED', 'HISTORY_MULTIPLE'].includes(followUpReferentStatus(normalizedQuery, history))
        || ['UNRESOLVED', 'MULTIPLE_CANDIDATES', 'HISTORY_MULTIPLE'].includes(
            multipleCandidateReferentStatus(normalizedQuery, history, chunks)
        );
}

function hasCurrentIntent(query) {
    return CURRENT_INTENT.test(normalize(query));
}

function temporalNeedsClarification(query, history = []) {
    const normalizedQuery = normalize(query);
    return hasCurrentIntent(normalizedQuery)
        && AMBIGUOUS_CURRENT_REFERENCE.test(normalizedQuery)
        && !historyHasReference(history);
}

function parseTemporalBoundary(value, endOfDay = false) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value || '').trim();
    if (!raw) return null;
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
        const [, year, month, day] = dateOnly.map(Number);
        const date = new Date(year, month - 1, day, endOfDay ? 23 : 0,
            endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        return date.getTime();
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

function temporalMetadataState(chunk, nowMs) {
    const metadata = { ...(chunk?.payload || {}), ...(chunk?.metadata || {}), ...(chunk || {}) };
    const active = metadata.active;
    if (active === false || active === 0 || active === 'false') return 'INVALID';
    const fromRaw = metadata.validFrom ?? metadata.startDate;
    const toRaw = metadata.validTo ?? metadata.endDate;
    const hasRange = fromRaw != null || toRaw != null;
    const from = fromRaw == null ? null : parseTemporalBoundary(fromRaw, false);
    const to = toRaw == null ? null : parseTemporalBoundary(toRaw, true);
    if ((fromRaw != null && from == null) || (toRaw != null && to == null)) return 'INVALID';
    if (from != null && nowMs < from) return 'INVALID';
    if (to != null && nowMs > to) return 'INVALID';
    // Retrieval lifecycle "active" means the chunk may be searched; it does
    // not prove that a business fact is current. Only an explicit validity
    // range (or current wording in the same relevant sentence below) can do so.
    if (hasRange) return 'VALID';
    return 'ABSENT';
}

function temporalTopicMatches(query, evidence) {
    const topics = [
        /(?:خصم|خصومات|عرض|عروض)/u,
        /(?:متوفر|متاح|توفر|اتاح|شاغر|موعد)/u,
        /(?:نتيج|تحليل|جاهز)/u
    ];
    const requestedTopic = topics.find(pattern => pattern.test(query));
    return !requestedTopic || requestedTopic.test(evidence);
}

function hasCurrentEvidence(query, chunk, nowMs) {
    const text = normalize(chunk?.text || chunk?.payload?.text || '');
    if (!temporalTopicMatches(query, text)) return false;
    const metadataState = temporalMetadataState(chunk, nowMs);
    if (metadataState === 'INVALID') return false;
    if (metadataState === 'VALID') return true;
    // A large retrieved chunk can contain an unrelated phrase such as "صباح
    // اليوم التالي". Temporal validity and the requested topic must coexist in
    // the same evidence sentence; otherwise separate facts would be stitched.
    return String(chunk?.text || chunk?.payload?.text || '')
        .split(/\n+|(?<=[.!؟؛])\s+/u)
        .map(normalize)
        .filter(Boolean)
        .some(sentence => !CURRENT_STATE_UNPROVEN.test(sentence)
            && CURRENT_EVIDENCE.test(sentence)
            && temporalTopicMatches(query, sentence));
}

function clarificationForQuery(query) {
    const normalized = normalize(query);
    const referent = normalized.match(/(?:اغير|اعدل|الغي|احذف|انقل|اجل|اقدم|ارجع|استبدل)\s+(?:ال)?(\p{L}+)/u)?.[1];
    if (referent) return `أي ${referent} تقصد؟`;
    if (/(?:الدكتور|الطبيب)\s+(?:متوفر|متاح|موجود)/u.test(normalized)) return 'أي دكتور تقصد؟';
    if (/موعدي/u.test(normalized)) return 'أي موعد تقصد؟';
    if (/(?:التامين|تامين).*(?:ها|ه)/u.test(normalized)) return 'أي خدمة تقصد؟';
    return ARABIC_CLARIFY_MESSAGE;
}

function missingMembershipProof(query, evidence) {
    if (!/^(?:(?:هل\s+)?(?:تقبلون|بتقبلوا|عندكم|تتعاملون\s+مع|بتتعاملوا\s+مع)|هل\s+في\s+(?:فرع|فروع|منتج|خدمه|تأمين|تامين))/u.test(query)) return false;
    const tokens = query.split(/\s+/).filter(token => token.length > 2
        && !['هل', 'تقبلون', 'بتقبلوا', 'عندكم', 'تتعاملون', 'بتتعاملوا', 'تامين', 'التامين', 'مع'].includes(token));
    const member = tokens.at(-1);
    if (!member || evidence.includes(member)) return false;
    return !/(?:القائمه\s+(?:الكامله|الشامله)|هذه\s+(?:هي\s+)?(?:كل|جميع)|جميع\s+ال\p{L}+|complete\s+list|all\s+current)/iu.test(evidence);
}

function decideEvidence({ query, chunks = [], history = [], tenantId, now = new Date() }) {
    const startedAt = performance.now();
    const normalizedQuery = normalize(query);
    const scopedChunks = chunks.filter(chunk => {
        const chunkTenant = chunk?.tenantId || chunk?.payload?.tenantId;
        return !chunkTenant || String(chunkTenant) === String(tenantId);
    });
    const evidence = normalize(scopedChunks.map(chunk => chunk.text || chunk.payload?.text || '').join(' '));
    const currentIntent = hasCurrentIntent(normalizedQuery);
    const futureIntent = FUTURE_INTENT.test(normalizedQuery);
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const temporalEvidenceChunks = currentIntent
        ? scopedChunks.filter(chunk => hasCurrentEvidence(normalizedQuery, chunk, safeNowMs)) : [];
    const unmetEvidenceRule = REQUIRED_EVIDENCE.find(rule =>
        rule.query.test(normalizedQuery) && !requiredEvidenceSatisfied(rule, normalizedQuery, evidence)
    );

    let decision = DECISION.ANSWER;
    let reason = 'evidence_available';
    const ambiguity = analyzeAmbiguity(query, history);
    const candidateReferentStatus = multipleCandidateReferentStatus(normalizedQuery, history, scopedChunks);
    if (needsClarification(query, history, scopedChunks)
        || temporalNeedsClarification(normalizedQuery, history)) {
        decision = DECISION.CLARIFY;
        reason = ['MULTIPLE_CANDIDATES', 'HISTORY_MULTIPLE'].includes(candidateReferentStatus)
            ? 'multiple_candidate_referents'
            : ['UNRESOLVED', 'HISTORY_MULTIPLE'].includes(followUpReferentStatus(normalizedQuery, history))
                ? 'unresolved_referent' : 'missing_conversation_reference';
    } else if (!evidence) {
        decision = DECISION.NO_ANSWER;
        reason = 'no_scoped_evidence';
    } else if (futureIntent && !scopedChunks.some(chunk => FUTURE_INTENT.test(normalize(chunk.text || chunk.payload?.text || '')))) {
        decision = DECISION.NO_ANSWER;
        reason = 'requested_future_state_not_proven';
    } else if (currentIntent && !temporalEvidenceChunks.length) {
        decision = DECISION.NO_ANSWER;
        reason = 'current_state_not_proven';
    } else if (unmetEvidenceRule) {
        decision = DECISION.NO_ANSWER;
        reason = 'required_business_fact_not_in_evidence';
    } else if (missingMembershipProof(normalizedQuery, evidence)) {
        decision = DECISION.NO_ANSWER;
        reason = 'membership_not_proven';
    }

    return {
        decision,
        reason,
        ambiguity,
        consideredChunkIds: scopedChunks.map(chunk => chunk.chunkId || chunk.id).filter(Boolean),
        excludedTenantChunks: chunks.length - scopedChunks.length,
        currentIntent,
        temporalEvidenceChunkIds: temporalEvidenceChunks
            .map(chunk => chunk.chunkId || chunk.id).filter(Boolean),
        durationMs: Number((performance.now() - startedAt).toFixed(3))
    };
}

module.exports = {
    DECISION, AMBIGUITY_TYPE, ARABIC_CLARIFY_MESSAGE, normalize, needsClarification,
    analyzeAmbiguity, clarificationForQuery,
    hasCurrentIntent, temporalNeedsClarification,
    temporalMetadataState, followUpReferentStatus, multipleCandidateReferentStatus, decideEvidence
};
