const test = require('node:test');
const assert = require('node:assert');
const { decomposeQuery } = require('../src/rag/intelligence/queryDecomposer');

test('Enterprise-Grade Query Decomposition Subsystem Suite', async (t) => {

    await t.test('Decomposes simple compound query into multiple atomic sub-queries', () => {
        const query = "What are the shipping fees, and how do I contact customer support?";
        const result = decomposeQuery(query);

        assert.ok(result.length >= 2, "Should decompose into at least 2 queries");

        const queries = result.map(r => r.query.toLowerCase());
        const intents = result.map(r => r.intent);

        assert.ok(queries.some(q => q.includes("shipping") || q.includes("fee")));
        assert.ok(queries.some(q => q.includes("support") || q.includes("contact")));

        assert.ok(intents.includes("Shipping"));
        assert.ok(intents.includes("Customer Support"));
    });

    await t.test('Decomposes Arabic complex query with dialect and separators', () => {
        const query = "أريد تعديل الطلب واسترجاع المنتج";
        const result = decomposeQuery(query);

        assert.ok(result.length >= 2);

        const queries = result.map(r => r.query);
        const intents = result.map(r => r.intent);

        assert.ok(queries.includes("Modify Order"));
        assert.ok(queries.includes("Return Product"));

        assert.ok(intents.includes("Order Modification"));
        assert.ok(intents.includes("Returns"));
    });

    await t.test('Decomposes implicit query "دفعت وما وصلني الطلب"', () => {
        const query = "دفعت وما وصلني الطلب";
        const result = decomposeQuery(query);

        assert.ok(result.length >= 2);

        const queries = result.map(r => r.query);
        const intents = result.map(r => r.intent);

        assert.ok(queries.includes("Payment Status"));
        assert.ok(queries.includes("Shipping Status"));

        assert.ok(intents.includes("Payment"));
        assert.ok(intents.includes("Shipping"));
    });

    await t.test('Deduplicates and merges equivalent queries cleanly', () => {
        const query = "كم تكلفة الشحن ورسوم التوصيل كمان";
        const result = decomposeQuery(query);

        // Both parts are about shipping fees and map to "Shipping" intent.
        // DuplicateRemover should merge them and keep the highest confidence.
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].intent, "Shipping");
    });
});
