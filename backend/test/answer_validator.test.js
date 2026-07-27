const test = require('node:test');
const assert = require('node:assert');
const { validateAnswer } = require('../src/rag/intelligence/answerValidator');

test('Enterprise-Grade Non-Destructive Answer Validation Subsystem Suite', async (t) => {

    await t.test('Gives strict character-by-character match for perfectly valid responses (PASS)', () => {
        const response = `
# Shipping Information
Thank you for asking!

Our delivery details are:
1. Standard shipping: 15 ILS.
2. Fast delivery: 30 ILS.

* Note: Prices may change.
Check more at https://example.com/shipping or contact support@example.com.

| Method | Fee |
|---|---|
| Regular | 15 ILS |
| Express | 30 ILS |

\`\`\`json
{
  "currency": "ILS",
  "methods": ["Regular", "Express"]
}
\`\`\`
        `.trim();

        // Standard context with matched numbers (15, 30)
        const context = "Our delivery standard shipping costs 15 ILS and fast delivery is 30 ILS.";

        const validated = validateAnswer(response, context);

        assert.strictEqual(validated, response, "Original response must remain 100% untouched character-for-character!");
        assert.ok(validated === response);
    });

    await t.test('Preserves markdown elements, lists, and formatting perfectly', () => {
        const response = `
## Return Rules
- Item must be unused.
* Proof of purchase required.
***
More rules...
        `.trim();

        const context = "Rules for return: Item must be unused and have proof of purchase.";
        const validated = validateAnswer(response, context);

        assert.strictEqual(validated, response);
    });

    await t.test('Protects email addresses, URLs, and code blocks from being mangled', () => {
        const response = "For help, email info@business.com or visit https://business.com/faq. Use path /data/help.md.";
        const context = "Email is info@business.com and website is https://business.com/faq.";

        const validated = validateAnswer(response, context);
        assert.strictEqual(validated, response);
    });

    await t.test('Correctly processes Arabic, English, and mixed paragraphs without destructively flatting or merging them', () => {
        const response = `
أهلاً بك! سياسة الاسترجاع لدينا مرنة جداً.

We support returns up to 14 days.
        `.trim();
        const context = "سياسة الاسترجاع مرنة جداً. We support returns up to 14 days.";

        const validated = validateAnswer(response, context);
        assert.strictEqual(validated, response);
    });

    await t.test('Applies minimal claim-level corrections only when hallucination is detected', () => {
        const response = "The delivery fee is 999 ILS and standard delivery takes 3 days.";
        // Context contains "3 days" but does NOT contain "999 ILS"
        const context = "Standard delivery takes 3 days. Shipping fee is 15 ILS.";

        const validated = validateAnswer(response, context);

        assert.notStrictEqual(validated, response, "Failed validation must apply minimal correction");
        assert.ok(validated.includes("[تفاصيل لم يتم تأكيدها بموجب مستندات السياق المتوفرة]"));
        assert.ok(validated.includes("standard delivery takes 3 days"));
    });

    await t.test('Handles empty and null responses gracefully', () => {
        assert.strictEqual(validateAnswer("", "some context"), "");
        assert.strictEqual(validateAnswer(null, "some context"), "");
    });
});
