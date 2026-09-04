const { detectIntent } = require('../rag/intelligence/intentDetector');

const MODE = Object.freeze({
    COMPANY_KNOWLEDGE: 'COMPANY_KNOWLEDGE',
    GENERAL_CONVERSATION: 'GENERAL_CONVERSATION'
});

const ROUTE_KIND = Object.freeze({
    TENANT_KNOWLEDGE_REQUEST: 'TENANT_KNOWLEDGE_REQUEST',
    SOCIAL: 'SOCIAL',
    ACTION_REQUEST: 'ACTION_REQUEST',
    UNKNOWN: 'UNKNOWN'
});

const COMPANY_MARKERS = /(?:\b(?:company|business|service|services|pricing|price|subscription|subscriptions|product|products|policy|policies|payment|shipping|delivery|support|warranty|refund|return|order|store|clinic|doctor|appointment|insurance|package|project|available)\b|شرك(?:ه|ة)|خدمات?|اشتراك|باقات?|منتج|منتجات|قطع(?:ه|ة)|خلص|خلصان(?:ه|ة)|سياس(?:ه|ة)|اسعار|سعر|تكلف(?:ه|ة)|دفع|شحن|توصيل|بتوصلوا|توزيع|دعم|ضمان|كفال(?:ه|تها|ته)|تقسيط|استرجاع|استبدال|رجع|بدل|طلب|متجر|محل|فاتح|فرع|فروع|دوام|متوفر|متاح|توفر|عرض|العرض|عروض?|كوبون|محافظات|تجهيز|تتبع|موقعكم|رقمكم|بتقدموا|تقدمون|طبيب|دكتور|عياد(?:ه|ة)|موعد|الغاء|الغي|تامين|فحص|دواء|طوارئ|تنظيف|رسوم|مقاس|الوان?|ائتمان|دين|شيكات?|غرام(?:ه|ة)|كرتون(?:ه|ة)|مستودع|مندوب|مشروع|ادار(?:ه|ة)|مد(?:ه|ة)|تعديل|جول(?:ه|ة)|استشار(?:ه|ة)|تصليح|نتيج|تحليل|جاهز|شاغر)/i;
const SOCIAL_ONLY = /^(?:(?:يا\s+)?(?:مرحبا|مرحبا بك|اهلا|اهلين|هلا|هلو|السلام عليكم|وعليكم السلام|صباح الخير|مساء الخير|يسعد صباحك|يسعد مساك|كيفك(?:\s+اليوم)?|كيف حالك(?:\s+اليوم)?|شو الاخبار|شو اخبارك|اخبارك|تمام|الحمد لله|شكرا|شكرا لك|يسلمو|يعطيك العافيه|الله يعطيك العافيه|مع السلامه|باي|الى اللقاء|hello|hi|hey|okay|ok|good morning|good evening|how are you|what'?s up|thanks|thank you|bye)[\s،,.!?؟]*)+$/i;
const KNOWLEDGE_MEDIA_REQUEST = /(?:(?:ابعث|ارسل|اعرض|ورجيني|فرجيني|شغل|بدي|اريد|مين|من|شو|ماذا|ما|send|show|play|who|what).{0,80}(?:صوره|صور|صوت|تسجيل|اغنيه|انشوده|image|photo|picture|audio|voice|recording)|(?:صوره|صور|صوت|تسجيل|اغنيه|انشوده|image|photo|picture|audio|voice|recording).{0,80}(?:ابعث|ارسل|اعرض|ورجيني|فرجيني|شغل|بدي|اريد|مين|من|شو|ماذا|ما|send|show|play|who|what))/i;
// Requests for diagnosis/treatment must not fall into open-domain chat where a
// model could invent high-impact advice. They enter the same tenant-grounded,
// fail-closed path as other factual support requests.
const HIGH_IMPACT_ADVICE = /(?:\b(?:diagnos(?:e|is)|treatment|medication|symptoms?)\b|تشخيص|شخّص|اعراض|وجع|الم|علاج|وصفه\s+طبيه)/iu;
const SCHEDULE_ATTRIBUTE = /(?:الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس|الجمعه|السبت).*(?:اي\s+ساعه|لاي\s+ساعه|متي)|(?:اي\s+ساعه|لاي\s+ساعه|متي).*(?:الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس|الجمعه|السبت)/iu;
// These are grammatical interrogatives and information-request constructions,
// not business-domain vocabulary. They therefore generalize to unseen tenants.
const ARABIC_INTERROGATIVE = /(?:^|\s)(?:شو|ماذا|متى|مين|وين|اين|كم|قديش|هل|ليش|كيف|اي|لاي)(?:\s|$)|^(?:من|في)\s/u;
const LATIN_INTERROGATIVE = /(?:^|\s)(?:what|when|where|who|which|how|is|are|do|does|can)(?:\s|$)/i;
const INFORMATION_REQUEST = /(?:^|\s)(?:بدي|بدنا|اريد|نريد)\s+(?:اعرف|معلومات)|(?:^|\s)(?:احكيلي|خبرني)\s+عن(?:\s|$)/u;
const ACTION_REQUEST = /(?:^|\s)(?:بدي|بدنا|اريد|نريد)\s+(?!(?:اعرف|معلومات)(?:\s|$))\S+/u;

function normalizeForRouting(text) {
    return String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, ' ')
        .trim();
}

function classifyGenericIntent(text) {
    const normalized = normalizeForRouting(text);
    if (!normalized) return { kind: ROUTE_KIND.UNKNOWN, confidence: 1, reason: 'empty' };
    if (SOCIAL_ONLY.test(normalized)) {
        return { kind: ROUTE_KIND.SOCIAL, confidence: 1, reason: 'social_form' };
    }
    if (ACTION_REQUEST.test(normalized)) {
        return { kind: ROUTE_KIND.ACTION_REQUEST, confidence: 0.9, reason: 'first_person_action_form' };
    }
    if (INFORMATION_REQUEST.test(normalized)
        || ARABIC_INTERROGATIVE.test(normalized)
        || LATIN_INTERROGATIVE.test(normalized)
        || /[?؟]\s*$/u.test(normalized)) {
        return { kind: ROUTE_KIND.TENANT_KNOWLEDGE_REQUEST, confidence: 0.9, reason: 'information_seeking_form' };
    }
    return { kind: ROUTE_KIND.UNKNOWN, confidence: 0.5, reason: 'no_structural_signal' };
}

function classifyConversationMode(text, options = {}) {
    const normalized = normalizeForRouting(text);
    if (!normalized) {
        return { mode: MODE.GENERAL_CONVERSATION, intent: 'General', reason: 'empty_or_nonverbal' };
    }

    const genericIntent = classifyGenericIntent(text);
    if (genericIntent.kind === ROUTE_KIND.SOCIAL) {
        return { mode: MODE.GENERAL_CONVERSATION, intent: 'General', reason: genericIntent.reason };
    }
    if (options.inputType === 'transcribed_audio'
        && genericIntent.kind === ROUTE_KIND.UNKNOWN) {
        return {
            mode: MODE.GENERAL_CONVERSATION,
            intent: 'General',
            reason: 'transcribed_audio_without_text_intent'
        };
    }

    // Business evidence wins over a greeting in mixed messages such as
    // "مرحبا، كم سعر الاشتراك؟".
    const detectedIntent = detectIntent(text);
    if (detectedIntent !== 'General' || COMPANY_MARKERS.test(normalized)
        || KNOWLEDGE_MEDIA_REQUEST.test(normalized) || HIGH_IMPACT_ADVICE.test(normalized)
        || SCHEDULE_ATTRIBUTE.test(normalized)) {
        return {
            mode: MODE.COMPANY_KNOWLEDGE,
            intent: detectedIntent,
            reason: detectedIntent !== 'General' ? 'business_intent' : 'business_marker'
        };
    }

    if ([ROUTE_KIND.TENANT_KNOWLEDGE_REQUEST, ROUTE_KIND.ACTION_REQUEST]
        .includes(genericIntent.kind)) {
        return {
            mode: MODE.COMPANY_KNOWLEDGE,
            intent: detectedIntent,
            reason: genericIntent.reason
        };
    }

    if (SOCIAL_ONLY.test(normalized)) {
        return { mode: MODE.GENERAL_CONVERSATION, intent: 'General', reason: 'social_conversation' };
    }

    return { mode: MODE.GENERAL_CONVERSATION, intent: 'General', reason: 'no_business_signal' };
}

module.exports = {
    MODE,
    ROUTE_KIND,
    classifyGenericIntent,
    classifyConversationMode,
    normalizeForRouting
};
