const test = require('node:test');
const assert = require('node:assert');
const {
    EvidenceMetadata,
    EvidenceIndex,
    EvidenceBuilder,
    CitationMapper,
    GroundingValidator
} = require('../src/rag/intelligence/citationGrounding');

test('Enterprise-Grade Citation Grounding and Evidence Tracking Suite', async (t) => {

    await t.test('EvidenceMetadata maps raw hybrid candidate and payloads cleanly', () => {
        const chunk = {
            chunkId: "KB-421",
            text: "Free delivery applies on orders above 150 ILS.",
            score: 0.95,
            semanticScore: 0.90,
            keywordScore: 0.15,
            rerankScore: 0.93,
            finalScore: 0.95,
            source: "delivery_fees.txt",
            payload: {
                documentId: "doc-delivery",
                title: "Delivery Policy",
                section: "Shipping Fees"
            }
        };

        const metadata = EvidenceMetadata.map(chunk, "Shipping", "Shipping fees");

        assert.strictEqual(metadata.chunkId, "KB-421");
        assert.strictEqual(metadata.documentId, "doc-delivery");
        assert.strictEqual(metadata.sourceName, "delivery_fees.txt");
        assert.strictEqual(metadata.title, "Delivery Policy");
        assert.strictEqual(metadata.section, "Shipping Fees");
        assert.strictEqual(metadata.finalScore, 0.95);
        assert.strictEqual(metadata.intent, "Shipping");
    });

    await t.test('EvidenceIndex registers active and discarded evidence separately', () => {
        const index = new EvidenceIndex();

        const metadata1 = { chunkId: "C1", title: "Active doc", sourceName: "doc1.txt", intent: "General", finalScore: 0.9 };
        const metadata2 = { chunkId: "C2", title: "Discarded doc", sourceName: "doc2.txt", intent: "Returns", finalScore: 0.5 };

        index.registerActive(metadata1, "Active content text");
        index.registerDiscarded(metadata2, "Discarded content text", "Filtered by low score.");

        const active = index.getActive();
        const discarded = index.getDiscarded();

        assert.strictEqual(active.length, 1);
        assert.strictEqual(active[0].metadata.chunkId, "C1");
        assert.strictEqual(active[0].text, "Active content text");

        assert.strictEqual(discarded.length, 1);
        assert.strictEqual(discarded[0].reference.metadata.chunkId, "C2");
        assert.strictEqual(discarded[0].reason, "Filtered by low score.");
    });

    await t.test('EvidenceBuilder builds serialized prompt context with identifiers', () => {
        const index = new EvidenceIndex();
        const metadata = { chunkId: "KB-782", title: "Returns Policy", sourceName: "returns.txt", section: "Refund Window", intent: "Returns" };
        index.registerActive(metadata, "We have a 14-day refund policy.");

        const groundingContext = EvidenceBuilder.buildGroundingContext(index.getActive());

        assert.ok(groundingContext.includes("Chunk #KB-782"));
        assert.ok(groundingContext.includes("Document: Returns Policy"));
        assert.ok(groundingContext.includes("Section: Refund Window"));
        assert.ok(groundingContext.includes("Intent: Returns"));
        assert.ok(groundingContext.includes("We have a 14-day refund policy."));
    });
});
