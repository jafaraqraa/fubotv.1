const test = require('node:test');
const assert = require('node:assert');
const { detectIntent, detectIntents } = require('../src/rag/intelligence/intentDetector');

test('Enterprise-Grade Multi-Intent Detection Engine Suite', async (t) => {

    await t.test('Detects single intent in Arabic with dialect', () => {
        const query = "كم رسوم التوصيل";
        const result = detectIntents(query);

        assert.ok(result.intents.length > 0);
        assert.strictEqual(result.intents[0].name, "Shipping");
        assert.ok(result.intents[0].confidence > 0.5);
    });

    await t.test('Detects single intent in English', () => {
        const query = "where is customer support contact info?";
        const result = detectIntents(query);

        assert.ok(result.intents.length > 0);
        assert.strictEqual(result.intents[0].name, "Customer Support");
    });

    await t.test('Detects MULTIPLE intents concurrently for mixed input', () => {
        const query = "I want to know shipping cost, return policy, customer support contact and whether I can modify my order.";
        const result = detectIntents(query);

        assert.ok(result.intents.length >= 4, "Should detect at least 4 intents");

        const intentNames = result.intents.map(i => i.name);
        assert.ok(intentNames.includes("Shipping"));
        assert.ok(intentNames.includes("Returns"));
        assert.ok(intentNames.includes("Customer Support"));
        assert.ok(intentNames.includes("Order Modification"));
    });

    await t.test('Handles spelling mistakes and synonyms in Arabic dialects', () => {
        // "بدي ارجع المنتج" is a return request
        const query = "بدي ارجع المنتج";
        const result = detectIntents(query);

        assert.ok(result.intents.length > 0);
        assert.strictEqual(result.intents[0].name, "Returns");
    });

    await t.test('Handles implicit and complex combined intents in Arabic', () => {
        // "دفعت وما وصلني الطلب" indicates Payment, Orders, and Shipping
        const query = "دفعت وما وصلني الطلب";
        const result = detectIntents(query);

        assert.ok(result.intents.length >= 2);
        const intentNames = result.intents.map(i => i.name);
        assert.ok(intentNames.includes("Payment"));
        assert.ok(intentNames.includes("Shipping") || intentNames.includes("Delivery"));
    });

    await t.test('Backward compatibility for detectIntent() returning the top-scoring intent name', () => {
        const query1 = "كم سعر المنتج؟";
        const top1 = detectIntent(query1);
        assert.strictEqual(top1, "Pricing");

        const query2 = "اهلين وسهلين";
        const top2 = detectIntent(query2);
        // Falls back to General if no specific intent matches
        assert.strictEqual(top2, "General");
    });
});
