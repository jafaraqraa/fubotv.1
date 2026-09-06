'use strict';
const RX = {
    casual: /^(?:hello|hi|hey|thanks|thank you|ok|okay|مرحبا|اهلا|هلا|شكرا|شكراً|يعطيك العافية|تمام|يسلمو|👍)[!.؟? ]*$/iu,
    recall: /(?:what did i (?:ask|say)|what was my (?:last|previous) question|what were we talking about|what did you tell me|عن شو سألتك|شو حكيتلك قبل|شو كنا نحكي|شو كان آخر سؤال|قبل سألت)/iu,
    correction: /(?:no,? i meant|that is not what i asked|go back|لا[,،]?ش? قصدي|مش هيك|انا سألتك|ارجع|اللي قبله)/iu,
    purchase: /(?:i (?:want|wanna|would like) (?:to buy|it|one|two)|buy it|بدي (?:اشتري|اياه|منه|واحد|وحدتين|ثنتين)|بدنا نشتري)/iu,
    booking: /(?:book|appointment|reserve|احجز|حجز|موعد)/iu,
    cancellation: /(?:cancel|cancellation|الغي|إلغاء|مش بدي الطلب)/iu,
    complaint: /(?:complaint|complain|bad service|شكوى|اشتكي|خدمة سيئة)/iu,
    support: /(?:support|not working|broken|problem|دعم|عطلان|مش شغال|مشكلة)/iu,
    comparison: /(?:compare|difference between|versus|\bvs\b|قارن|الفرق بين)/iu,
    followUp: /(?:how much is it|is it available|does it include|what about|and installation|قديش حقه|شو وضعه|متوفر|وفي تركيب|طيب الثاني)/iu
};
function resolveIntent(message) {
    const value=String(message||'').trim();
    if (RX.casual.test(value)) return { intent:'CASUAL', message_type:'casual' };
    if (RX.recall.test(value)) return { intent:'CONVERSATION_RECALL', message_type:'conversation_recall' };
    if (RX.correction.test(value)) return { intent:'CORRECTION', message_type:'correction' };
    if (RX.purchase.test(value)) return { intent:'PURCHASE_INTENT', message_type:'transactional' };
    if (RX.booking.test(value)) return { intent:'BOOKING_INTENT', message_type:'transactional' };
    if (RX.cancellation.test(value)) return { intent:'CANCELLATION_INTENT', message_type:'transactional' };
    if (RX.complaint.test(value)) return { intent:'COMPLAINT', message_type:'transactional' };
    if (RX.support.test(value)) return { intent:'SUPPORT_REQUEST', message_type:'transactional' };
    if (RX.comparison.test(value)) return { intent:'COMPARISON', message_type:'knowledge' };
    if (RX.followUp.test(value)) return { intent:'FOLLOW_UP', message_type:'follow_up' };
    return { intent:'KNOWLEDGE_QUERY', message_type:'knowledge' };
}
module.exports={ resolveIntent, RX };
