const test = require('node:test');
const assert = require('node:assert');
const { getRetrievalPlan } = require('../src/rag/intelligence/retrievalPlanner');

test('Enterprise-Grade Retrieval Planning Engine Suite', async (t) => {

    await t.test('Correctly routes specific concrete term queries to SimpleRetrieval or FocusedSearch', () => {
        const query = "Shipping cost";
        const plan = getRetrievalPlan(query);

        assert.ok(plan.strategy === "SimpleRetrieval" || plan.strategy === "FocusedSearch");
        assert.ok(plan.confidence >= 0.80);
        assert.strictEqual(plan.estimatedQueries, 1);
    });

    await t.test('Correctly routes complex multi-question queries to Multi-Intent Retrieval', () => {
        const query = "What are shipping fees and return policy?";
        const plan = getRetrievalPlan(query);

        assert.strictEqual(plan.strategy, "MultiIntentRetrieval");
        assert.ok(plan.confidence >= 0.90);
        assert.strictEqual(plan.estimatedQueries, 2);
    });

    await t.test('Correctly routes comparative queries to ComparativeRetrieval', () => {
        const query = "Compare return policy with warranty.";
        const plan = getRetrievalPlan(query);

        assert.strictEqual(plan.strategy, "ComparativeRetrieval");
        assert.ok(plan.confidence >= 0.90);
    });

    await t.test('Correctly routes procedural queries to ProceduralRetrieval', () => {
        const query = "How do I connect WhatsApp?";
        const plan = getRetrievalPlan(query);

        assert.strictEqual(plan.strategy, "ProceduralRetrieval");
        assert.ok(plan.confidence >= 0.90);
    });

    await t.test('Correctly routes situational stories to ConversationalRetrieval', () => {
        const query = "I paid but my order didn't arrive.";
        const plan = getRetrievalPlan(query);

        assert.strictEqual(plan.strategy, "ConversationalRetrieval");
        assert.ok(plan.confidence >= 0.80);
    });
});
