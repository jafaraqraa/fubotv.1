const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Initialize database connection for tests
const { initializeDatabase } = require('../src/database/initialize');
initializeDatabase();

const { normalizeArabic, normalizeQueryTokens } = require('../src/rag/processing/arabicNormalizer');
const { expandSynonyms, addSynonymRecord, getAllSynonyms } = require('../src/rag/intelligence/synonymEngine');
const { rewriteQuery } = require('../src/rag/intelligence/queryRewriter');
const { detectIntent, influenceRetrieval } = require('../src/rag/intelligence/intentDetector');
const { determineSmarterTopK } = require('../src/rag/intelligence/dynamicTopK');
const { optimizeContext, findOverlapLength } = require('../src/rag/intelligence/contextOptimizer');
const { validateAnswer, extractNumbers, splitIntoSentences } = require('../src/rag/intelligence/answerValidator');

// Phase 11 New Modules
const { generateMultiQueries } = require('../src/rag/intelligence/multiQueryGenerator');
const { generateHypotheticalAnswer } = require('../src/rag/intelligence/hydeRetriever');
const { reciprocalRankFusion } = require('../src/rag/intelligence/rrfScorer');
const { rerankWithCrossEncoder } = require('../src/rag/intelligence/crossEncoderReranker');

test('Retrieval Intelligence Engine Suite', async (t) => {

    await t.test('Arabic Normalizer & Preprocessing Improvements', () => {
        // Tatweel removal
        assert.strictEqual(normalizeArabic('كتـاب'), 'كتاب');

        // Alef normalization
        assert.strictEqual(normalizeArabic('أحمد إبراهيم آسر'), 'احمد ابراهيم اسر');

        // Ya / Alef Maqsura normalization
        assert.strictEqual(normalizeArabic('على في كبرى'), 'علي في كبري');

        // Ta Marbuta normalization
        assert.strictEqual(normalizeArabic('سياسة مكتبة'), 'سياسه مكتبه');

        // Optional diacritics (Harakat)
        assert.strictEqual(normalizeArabic('كِتَابٌ جَمِيلٌ'), 'كتاب جميل');

        // Collapse duplicate spaces
        assert.strictEqual(normalizeArabic('كتاب    جميل   جدا'), 'كتاب جميل جدا');

        // Preserve numbers in query tokenization
        const tokens = normalizeQueryTokens('سعر الشحن للقدس 30 شيكل و 2 طرود');
        assert.ok(tokens.includes('30'));
        assert.ok(tokens.includes('2'));
    });

    await t.test('Synonyms Expansion Engine', () => {
        // Verify default seeded synonyms
        const dict = getAllSynonyms();
        assert.ok(dict['الدفع']);
        assert.ok(dict['الدفع'].includes('السداد'));

        // Verify expansion token logic
        const queryTokens = ['الدفع', 'للطلب'];
        const expanded = expandSynonyms(queryTokens);
        assert.ok(expanded.includes('السداد'));
        assert.ok(expanded.includes('الدفع'));
        assert.ok(expanded.includes('فيزا'));

        // Verify CRUD addition
        addSynonymRecord('التجربة', ['الاختبار', 'المحاكاة']);
        const updatedDict = getAllSynonyms();
        assert.ok(updatedDict['التجربة']);
        assert.deepStrictEqual(updatedDict['التجربة'], ['الاختبار', 'المحاكاة']);
    });

    await t.test('Rule-Based Query Rewriting', () => {
        // Match a rule
        const original = 'كيف اشتري من الموقع؟';
        const rewritten = rewriteQuery(original);
        assert.ok(rewritten.includes('خطوات الشراء'));
        assert.ok(rewritten.includes('طريقة الطلب'));

        // No match rule
        const untouched = 'اين تقع المحافظة؟';
        assert.strictEqual(rewriteQuery(untouched), untouched);
    });

    await t.test('Intent Detection & Influence', () => {
        // Classification
        assert.strictEqual(detectIntent('كيف اشحن للقدس؟'), 'Shipping');
        assert.strictEqual(detectIntent('وسائل الدفع المتاحة'), 'Payment');
        assert.strictEqual(detectIntent('أريد ارجاع طرد'), 'Returns');
        assert.strictEqual(detectIntent('عندي مشكلة في الحساب'), 'Technical');
        assert.strictEqual(detectIntent('ما هي سياسة الاستبدال؟'), 'Returns');

        // Score Boosting
        const candidates = [
            { text: 'هنا تفاصيل شحن المنتجات وتكلفة التوصيل', source: 'shipping.txt', finalScore: 0.60, semanticScore: 0.60 },
            { text: 'شروط الخصوصية والاحكام العامة', source: 'policies.txt', finalScore: 0.55, semanticScore: 0.55 }
        ];

        const boosted = influenceRetrieval(candidates, 'Shipping');
        assert.strictEqual(boosted[0].intentBoosted, true);
        assert.ok(boosted[0].finalScore > 0.65); // Boosted
        assert.ok(!boosted[1].intentBoosted); // Untouched
    });

    await t.test('Smarter Dynamic Top-K Estimation', () => {
        // High complexity query -> larger Top-K
        const longQuery = 'أريد معرفة كافة التفاصيل المتعلقة بسياسة الاستبدال والارجاع في حال وجود خلل فني في المنتج';
        const kLarge = determineSmarterTopK(longQuery, ['الاستبدال', 'الارجاع', 'خلل'], 'Returns', []);
        assert.ok(kLarge >= 5);

        // Low complexity -> smaller Top-K
        const shortQuery = 'مرحبا';
        const kSmall = determineSmarterTopK(shortQuery, ['مرحبا'], 'General', [{ semanticScore: 0.90 }]);
        assert.ok(kSmall <= 4);
    });

    await t.test('Context Optimization (Overlap Merges & Deduplication)', () => {
        // Overlap finder
        const a = 'مرحبا بك في متجر فوشينغ التسوق الإلكتروني الرائد';
        const b = 'التسوق الإلكتروني الرائد يوفر شحن مجاني';
        const overlapLen = findOverlapLength(a, b);
        assert.strictEqual(overlapLen, 24); // length of 'التسوق الإلكتروني الرائد'

        // Clean merging
        const chunks = [
            { text: 'مرحبا بك في متجر فوشينغ التسوق الإلكتروني الرائد', source: 'docs.txt', finalScore: 0.90 },
            { text: 'التسوق الإلكتروني الرائد يوفر شحن مجاني', source: 'docs.txt', finalScore: 0.90 }
        ];
        const context = optimizeContext(chunks);
        assert.ok(context.includes('مرحبا بك في متجر فوشينغ التسوق الإلكتروني الرائد\nيوفر شحن مجاني'));
    });

    await t.test('Answer Validation & Hallucination Prevention', () => {
        const retrievedContext = 'سعر الشحن للضفة هو 20 شيكل، والقدس 30 شيكل.';

        // Valid Answer
        const goodAnswer = 'سعر شحن الضفة هو 20 شيكل وشحن القدس 30 شيكل.';
        const validatedGood = validateAnswer(goodAnswer, retrievedContext);
        assert.strictEqual(validatedGood, goodAnswer);

        // Hallucinated fact (unverified number)
        const badAnswer = 'سعر الشحن للضفة هو 20 شيكل، وشحن غزة هو 100 شيكل.';
        const validatedBad = validateAnswer(badAnswer, retrievedContext);
        assert.ok(!validatedBad.includes('100'));
        assert.ok(!validatedBad.includes('غزة'));

        // Hallucinated fact (zero semantic overlap)
        const completelyHallucinated = 'لدينا عروض خاصة على الساعات الذكية ماركة ابل بسعر 500 شيكل.';
        const fallback = validateAnswer(completelyHallucinated, retrievedContext);
        assert.ok(fallback.includes('تفاصيل لم يتم تأكيدها'));
    });

    // --- PHASE 11 ADVANCED RETRIEVAL INTELLIGENCE TESTS ---

    await t.test('Multi-Query Generator Variations', () => {
        const query = 'كم سأدفع حتى يصل الطلب إلى منزلي؟';
        const variations = generateMultiQueries(query);

        // Verify multiple search query variations are generated successfully
        assert.ok(variations.length > 1);
        assert.ok(variations.includes(query));
        assert.ok(variations.includes('رسوم التوصيل'));
        assert.ok(variations.includes('تكلفة الشحن'));
    });

    await t.test('HyDE Retrieval Mode', () => {
        const query = 'كيف يمكنني الشحن للقدس؟';
        const hypotDoc = generateHypotheticalAnswer(query);

        assert.ok(hypotDoc.includes('القدس'));
        assert.ok(hypotDoc.includes('الشحن'));
        assert.ok(hypotDoc.includes('30 شيكل')); // contains targeted hypothetical facts
    });

    await t.test('Reciprocal Rank Fusion (RRF) Scorer', () => {
        const listA = [
            { chunkId: 'c1', text: 'مستند الشحن الضفة الغربية', semanticScore: 0.90 },
            { chunkId: 'c2', text: 'مستند شحن القدس ورسوم التوصيل', semanticScore: 0.85 }
        ];
        const listB = [
            { chunkId: 'c2', text: 'مستند شحن القدس ورسوم التوصيل', semanticScore: 0.85 },
            { chunkId: 'c3', text: 'مستند شحن غزة والشمال', semanticScore: 0.80 }
        ];

        const fused = reciprocalRankFusion([listA, listB], 60);

        assert.ok(fused.length > 0);
        // c2 is ranked highly in both lists and should be prioritized by RRF
        assert.strictEqual(fused[0].chunkId, 'c2');
        assert.ok(fused[0].rrfScore > fused[1].rrfScore);
    });

    await t.test('Modular pluggable Cross-Encoder Scorer Interface', async () => {
        const candidates = [
            { text: 'مستند شحن القدس ورسوم التوصيل', semanticScore: 0.85 }
        ];
        const res = await rerankWithCrossEncoder('شحن القدس', candidates);

        // Defaults back gracefully to standard candidates if no microservice URL is configured
        assert.deepStrictEqual(res, candidates);
    });
});
