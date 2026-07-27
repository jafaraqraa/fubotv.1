const test = require('node:test');
const assert = require('node:assert');
const {
    RetrievalAllocator,
    ChunkDeduplicator,
    ContextDiversifier,
    MergedContextBuilder
} = require('../src/rag/intelligence/intentRetriever');

test('Enterprise-Grade Intent-Aware Retrieval Strategy Suite', async (t) => {

    await t.test('RetrievalAllocator allocates dynamic limits based on intent confidence', () => {
        const decomposed = [
            { query: "shipping", intent: "Shipping", confidence: 0.95 },
            { query: "returns", intent: "Returns", confidence: 0.81 },
            { query: "support", intent: "Customer Support", confidence: 0.55 },
            { query: "low confidence", intent: "General", confidence: 0.22 }
        ];

        const allocated = RetrievalAllocator.allocate(decomposed);

        assert.strictEqual(allocated[0].allocatedLimit, 4, "High confidence should allocate up to 4 chunks");
        assert.strictEqual(allocated[1].allocatedLimit, 3, "Mid-high confidence should allocate up to 3 chunks");
        assert.strictEqual(allocated[2].allocatedLimit, 2, "Mid-low confidence should allocate up to 2 chunks");
        assert.strictEqual(allocated[3].allocatedLimit, 1, "Low confidence should allocate 1 chunk");
    });

    await t.test('ChunkDeduplicator removes near-duplicate text chunks correctly', () => {
        const chunks = [
            { chunkId: "1", text: "This is a very specific sentence about orders." },
            { chunkId: "2", text: "This is a very specific sentence about orders." }, // Exact duplicate
            { chunkId: "3", text: "This is a very specific sentence about orders and products." } // Near duplicate (Jaccard > 0.85)
        ];

        const { unique, removedCount } = ChunkDeduplicator.deduplicate(chunks);

        assert.strictEqual(unique.length, 1, "Duplicates and near-duplicates must be merged");
        assert.strictEqual(removedCount, 2, "2 duplicate items should be removed");
    });

    await t.test('ContextDiversifier caps chunks per intent to guarantee context diversity', () => {
        const chunks = [
            { intentLabel: "Shipping", text: "Ship 1" },
            { intentLabel: "Shipping", text: "Ship 2" },
            { intentLabel: "Shipping", text: "Ship 3" },
            { intentLabel: "Shipping", text: "Ship 4" }, // Should be capped
            { intentLabel: "Returns", text: "Return 1" }
        ];

        // Cap at max 2 per intent
        const diversified = ContextDiversifier.diversify(chunks, 2);

        const shippingCount = diversified.filter(c => c.intentLabel === "Shipping").length;
        const returnsCount = diversified.filter(c => c.intentLabel === "Returns").length;

        assert.strictEqual(shippingCount, 2, "Shipping should be capped at 2 chunks");
        assert.strictEqual(returnsCount, 1, "Returns should have 1 chunk");
    });

    await t.test('MergedContextBuilder formats metadata annotations and merges cleanly', () => {
        const chunks = [
            { intentLabel: "Shipping", text: "We deliver in 3 days.", source: "delivery.txt", semanticScore: 0.90, keywordScore: 0.30, finalScore: 0.95 }
        ];

        const merged = MergedContextBuilder.build(chunks);

        assert.ok(merged.includes("[المصدر: delivery.txt"));
        assert.ok(merged.includes("التصنيف: Shipping"));
        assert.ok(merged.includes("تطابق هجين: 0.95"));
        assert.ok(merged.includes("We deliver in 3 days."));
    });
});
