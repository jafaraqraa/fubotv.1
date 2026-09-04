const test = require('node:test');
const assert = require('node:assert/strict');

const {
    CUSTOMER_SAFE_NO_ANSWER,
    renderCustomerResponse
} = require('../src/messaging/customerResponseRenderer');

test('customer response renderer hides internal decision/control output', async t => {
    await t.test('renders prefixed product clarification without its control prefix', () => {
        assert.equal(renderCustomerResponse({
            decision: 'CLARIFY',
            answer: 'CLARIFY: أي منتج تقصد بالكفالة؟'
        }), 'أي منتج تقصد بالكفالة؟');
    });

    await t.test('renders prefixed maintenance clarification without its control prefix', () => {
        assert.equal(renderCustomerResponse({
            decision: 'CLARIFY',
            clarificationQuestion: 'CLARIFY: أي نوع صيانة تقصد؟'
        }), 'أي نوع صيانة تقصد؟');
    });

    await t.test('renders NO_ANSWER as the Arabic safe fallback', () => {
        assert.equal(renderCustomerResponse({ answer: 'NO_ANSWER' }), CUSTOMER_SAFE_NO_ANSWER);
    });

    await t.test('renders the English technical fallback as the Arabic safe fallback', () => {
        assert.equal(renderCustomerResponse({
            answer: "I couldn't verify this information from the available knowledge."
        }), CUSTOMER_SAFE_NO_ANSWER);
    });

    await t.test('preserves a normal validated answer unchanged', () => {
        assert.equal(renderCustomerResponse({
            decision: 'ANSWER', answer: 'كفالة اللابتوبات سنتان.'
        }), 'كفالة اللابتوبات سنتان.');
    });

    await t.test('preserves a valid unprefixed clarification', () => {
        assert.equal(renderCustomerResponse({
            decision: 'CLARIFY', clarificationQuestion: 'أي منتج تقصد؟'
        }), 'أي منتج تقصد؟');
    });

    await t.test('decision controls rendering and input decision is not mutated', () => {
        const noAnswer = { decision: 'NO_ANSWER', answer: 'معلومة عمل' };
        const clarify = { decision: 'CLARIFY', answer: 'CLARIFY： أي منتج؟' };
        assert.equal(renderCustomerResponse(noAnswer), CUSTOMER_SAFE_NO_ANSWER);
        assert.equal(noAnswer.decision, 'NO_ANSWER');
        assert.equal(renderCustomerResponse(clarify), 'أي منتج؟');
        assert.equal(clarify.decision, 'CLARIFY');
    });

    await t.test('removes only known internal markers and evidence references', () => {
        const outputs = [
            renderCustomerResponse({ answer: 'NO_ANSWER:' }),
            renderCustomerResponse({ answer: 'CLARIFY: أي منتج؟' }),
            renderCustomerResponse({ answer: 'VERIFIED_EVIDENCE: كفالة سنتان. [chunk_id: chunk-42]' })
        ];
        for (const output of outputs) {
            assert.doesNotMatch(output, /NO_ANSWER|CLARIFY\s*[:：]|VERIFIED_EVIDENCE|\[(?:evidence|chunk|document)[_-]?(?:id)?\s*[:=]/iu);
        }
        assert.equal(outputs[2], 'كفالة سنتان.');
    });
});
