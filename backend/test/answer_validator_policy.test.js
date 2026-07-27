const test = require('node:test');
const assert = require('node:assert');
const { validateAnswer, getLastValidationMetadata } = require('../src/rag/intelligence/answerValidator');

test('Enterprise-Grade Conservative Answer Validation Policy Suite', async (t) => {

    await t.test('PASS: Factual claims are fully supported by the retrieved context', () => {
        const response = "Our shipping fee is 15 ILS.";
        const context = "Our shipping fee is 15 ILS.";

        const validated = validateAnswer(response, context);

        assert.strictEqual(validated, response, "Original answer must remain character-for-character identical!");
        const metadata = getLastValidationMetadata();
        assert.strictEqual(metadata.validationState, "PASS");
        assert.strictEqual(metadata.evidenceCoverage, 1.0);
    });

    await t.test('WARN: Evidence coverage is partial (40-69%) but no direct contradictions exist', () => {
        const response = "Our shipping fee is 15 ILS and standard delivery takes 3 days.";
        const context = "Standard delivery takes 3 days.";

        const validated = validateAnswer(response, context);

        assert.strictEqual(validated, response, "WARN state MUST NOT modify the original response text!");
        const metadata = getLastValidationMetadata();
        assert.strictEqual(metadata.validationState, "WARN");
    });

    await t.test('UNSUPPORTED: Evidence coverage is low (<40%) but no alternative contradicting facts exist', () => {
        const response = "Standard delivery takes 3 days and refund takes 14 days.";
        const context = "We have a standard shipping method.";

        const validated = validateAnswer(response, context);

        assert.strictEqual(validated, response, "UNSUPPORTED state MUST NOT modify the original response text!");
        const metadata = getLastValidationMetadata();
        assert.strictEqual(metadata.validationState, "UNSUPPORTED");
        assert.ok(metadata.unsupportedClaims.length > 0);
    });

    await t.test('FAIL: Claims explicitly contradict retrieved context facts (triggering localized minimal correction)', () => {
        const response = "Our delivery fee is 999 ILS and standard delivery takes 3 days.";
        const context = "Standard delivery takes 3 days. Shipping fee is 15 ILS.";

        const validated = validateAnswer(response, context);

        assert.notStrictEqual(validated, response, "FAIL state must trigger corrections!");
        assert.ok(validated.includes("[تفاصيل لم يتم تأكيدها بموجب مستندات السياق المتوفرة]"));
        assert.ok(validated.includes("standard delivery takes 3 days"), "Unrelated valid clauses must remain untouched!");

        const metadata = getLastValidationMetadata();
        assert.strictEqual(metadata.validationState, "FAIL");
        assert.ok(metadata.contradictedClaims.length > 0);
    });
});
