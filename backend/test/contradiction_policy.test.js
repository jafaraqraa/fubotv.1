const test = require('node:test');
const assert = require('node:assert');
const { validateAnswer, getLastValidationMetadata } = require('../src/rag/intelligence/answerValidator');

test('Enterprise-Grade Positive Contradiction Detection Policy Suite', async (t) => {

    await t.test('PASS: Factual claim matches retrieved context exactly', () => {
        const response = "Returns are allowed for 14 days.";
        const context = "Our policy states that returns are allowed for 14 days.";

        const validated = validateAnswer(response, context);

        assert.strictEqual(validated, response, "Must remain character-for-character identical!");
        assert.strictEqual(getLastValidationMetadata().validationState, "PASS");
    });

    await t.test('UNSUPPORTED: Missing evidence must never be treated as contradiction (no modification)', () => {
        const response = "Changing delivery address is possible.";
        const context = "No information about changing delivery address is present.";

        const validated = validateAnswer(response, context);

        assert.strictEqual(validated, response, "Missing evidence must NEVER alter or modify the response text!");
        assert.strictEqual(getLastValidationMetadata().validationState, "UNSUPPORTED");
    });

    await t.test('FAIL: Factual conflict with explicit alternative positive evidence triggers correction', () => {
        const response = "Returns are allowed for 60 days.";
        const context = "Our policy states that returns are allowed for 14 days.";

        const validated = validateAnswer(response, context);

        assert.notStrictEqual(validated, response, "Explicit contradictions must trigger corrections!");
        assert.ok(validated.includes("[تفاصيل لم يتم تأكيدها بموجب مستندات السياق المتوفرة]"));
        assert.strictEqual(getLastValidationMetadata().validationState, "FAIL");
    });
});
