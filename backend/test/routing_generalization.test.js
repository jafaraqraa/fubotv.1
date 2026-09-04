const test = require('node:test');
const assert = require('node:assert/strict');
const {
    MODE, ROUTE_KIND, classifyGenericIntent, classifyConversationMode
} = require('../src/services/conversationModeRouter');

test('domain-independent routing matrix', async t => {
    await t.test('information-seeking grammar enters tenant knowledge', () => {
        const messages = [
            'كم الرسوم؟', 'وين المكتب؟', 'متى بتفتحوا؟', 'هل متاح؟',
            'شو الشروط؟', 'قديش بتاخد المعاملة؟', 'في مركز قريب؟',
            'لأي ساعة الاستقبال؟', 'كشف الوثيقة كم بده وقت؟',
            'دخل الأسرة 1700، بتقدر تقدم؟', 'بدي أعرف التفاصيل',
            'احكيلي عن المتطلبات', 'What are the requirements?', 'Can I apply?'
        ];
        for (const message of messages) {
            assert.equal(classifyGenericIntent(message).kind,
                ROUTE_KIND.TENANT_KNOWLEDGE_REQUEST, message);
            assert.equal(classifyConversationMode(message).mode,
                MODE.COMPANY_KNOWLEDGE, message);
        }
    });

    await t.test('social and acknowledgements remain conversational', () => {
        for (const message of [
            'مرحبا', 'كيفك', 'شكراً', 'تمام', 'يسلمو', 'صباح الخير',
            'مع السلامة', 'hello', 'thanks', 'okay'
        ]) {
            assert.equal(classifyConversationMode(message).mode,
                MODE.GENERAL_CONVERSATION, message);
        }
    });

    await t.test('first-person operations are distinguished from policy questions', () => {
        for (const message of ['بدي ألغي المعاملة', 'بدي أغير الحجز', 'أريد أقدم طلباً']) {
            assert.equal(classifyGenericIntent(message).kind, ROUTE_KIND.ACTION_REQUEST, message);
            assert.equal(classifyConversationMode(message).mode, MODE.COMPANY_KNOWLEDGE, message);
        }
        for (const message of ['شو سياسة الإلغاء؟', 'كيف نظام التعديل؟']) {
            assert.equal(classifyGenericIntent(message).kind,
                ROUTE_KIND.TENANT_KNOWLEDGE_REQUEST, message);
        }
    });

    await t.test('non-question transcript placeholders stay out of RAG', () => {
        for (const transcript of [
            'النص المستخرج من الصوت', 'تفريغ التسجيل الصوتي',
            'audio transcription placeholder', 'محتوى المرفق'
        ]) {
            assert.equal(classifyGenericIntent(transcript).kind, ROUTE_KIND.UNKNOWN, transcript);
            assert.equal(classifyConversationMode(transcript, {
                inputType: 'transcribed_audio'
            }).mode,
                MODE.GENERAL_CONVERSATION, transcript);
        }
    });
});
