const { detectIntent } = require('../rag/intelligence/intentDetector');

const MODE = Object.freeze({
    COMPANY_KNOWLEDGE: 'COMPANY_KNOWLEDGE',
    GENERAL_CONVERSATION: 'GENERAL_CONVERSATION'
});

const COMPANY_MARKERS = /(?:\b(?:company|business|service|services|pricing|price|subscription|subscriptions|product|products|policy|policies|payment|shipping|delivery|support|warranty|refund|return|order|store)\b|شرك(?:ه|ة)|خدمات?|اشتراك|باقات?|منتجات?|سياس(?:ه|ة)|اسعار|سعر|تكلف(?:ه|ة)|دفع|شحن|توصيل|دعم|ضمان|استرجاع|استبدال|طلب|متجر|فروع?|دوام|موقعكم|رقمكم|بتقدموا|تقدمون)/i;
const SOCIAL_ONLY = /^(?:(?:يا\s+)?(?:مرحبا|مرحبا بك|اهلا|اهلين|هلا|هلو|السلام عليكم|وعليكم السلام|صباح الخير|مساء الخير|يسعد صباحك|يسعد مساك|كيفك|كيف حالك|شو الاخبار|شو اخبارك|اخبارك|تمام|الحمد لله|شكرا|شكرا لك|يسلمو|يعطيك العافيه|الله يعطيك العافيه|مع السلامه|باي|الى اللقاء|hello|hi|hey|good morning|good evening|how are you|what'?s up|thanks|thank you|bye)[\s،,.!?؟]*)+$/i;

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

function classifyConversationMode(text) {
    const normalized = normalizeForRouting(text);
    if (!normalized) {
        return { mode: MODE.GENERAL_CONVERSATION, intent: 'General', reason: 'empty_or_nonverbal' };
    }

    // Business evidence wins over a greeting in mixed messages such as
    // "مرحبا، كم سعر الاشتراك؟".
    const detectedIntent = detectIntent(text);
    if (detectedIntent !== 'General' || COMPANY_MARKERS.test(normalized)) {
        return {
            mode: MODE.COMPANY_KNOWLEDGE,
            intent: detectedIntent,
            reason: detectedIntent !== 'General' ? 'business_intent' : 'business_marker'
        };
    }

    if (SOCIAL_ONLY.test(normalized)) {
        return { mode: MODE.GENERAL_CONVERSATION, intent: 'General', reason: 'social_conversation' };
    }

    return { mode: MODE.GENERAL_CONVERSATION, intent: 'General', reason: 'no_business_signal' };
}

module.exports = { MODE, classifyConversationMode, normalizeForRouting };
