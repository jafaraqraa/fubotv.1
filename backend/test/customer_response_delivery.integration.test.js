const test = require('node:test');
const assert = require('node:assert/strict');

const sentContents = [];
const stubs = new Map([
    ['../src/channels/telegram', { getBot: () => null }],
    ['../src/channels/whatsapp-providers/WhatsAppProviderManager', {
        getOrLoadProvider: async () => ({
            getStatus: () => 'متصل',
            sendMessage: async payload => {
                sentContents.push(payload.content);
                return { success: true, externalMessageId: `mock-${sentContents.length}` };
            }
        })
    }],
    ['../src/channels/meta', { sendMetaMessage: async () => ({ success: true, messageId: 'mock-meta' }) }],
    ['../src/database/repositories/messageRepository', {
        saveMessage: () => 1,
        updateMessageDelivery: () => undefined
    }],
    ['../src/services/logger', { reportError: () => undefined }],
    ['../src/database/repositories/mediaAttachmentRepository', { updateAttachment: () => undefined }]
]);

for (const [request, exports] of stubs) {
    const resolved = require.resolve(request);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const { sendOutgoingMessage } = require('../src/messaging/outgoingMessageService');

async function deliver(content, senderType = 'ai') {
    const result = await sendOutgoingMessage({
        channel: 'whatsapp',
        externalUserId: 'customer-1',
        senderType,
        messageType: 'text',
        content,
        tenantId: 'tenant-a'
    });
    assert.equal(result.success, true);
    return sentContents.at(-1);
}

test('actual outgoing WhatsApp choke point renders every AI-authored message', async () => {
    assert.equal(
        await deliver("I couldn't verify this information from the available knowledge."),
        'المعلومة مش متوفرة عندي حاليًا.'
    );
    assert.equal(await deliver('NO_ANSWER'), 'المعلومة مش متوفرة عندي حاليًا.');
    assert.equal(await deliver('CLARIFY: أي منتج تقصد بالكفالة؟'), 'أي منتج تقصد بالكفالة؟');
    assert.equal(await deliver('كفالة اللابتوبات سنتان.'), 'كفالة اللابتوبات سنتان.');

    const humanText = "I couldn't verify this information from the available knowledge.";
    assert.equal(await deliver(humanText, 'admin'), humanText);

    for (const delivered of sentContents.slice(0, 4)) {
        assert.doesNotMatch(delivered, /NO_ANSWER|CLARIFY\s*[:：]|I couldn't verify this information from the available knowledge|VERIFIED_EVIDENCE/iu);
    }
});
