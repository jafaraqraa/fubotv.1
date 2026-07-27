const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Force isolated test DB for RAG tests
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_rag_app.db');
process.env.SQLITE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test_rag_session_secret_123';
process.env.NODE_ENV = 'development';

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');

// Import our RAG modules
const {
    normalizeArabic,
    cleanText,
    chunkDocument,
    getConfig,
    validateSetting,
    validateAllSettings,
    reindexKnowledgeBase,
    getRAGSystemStatus,
    getIndexingState
} = require('../src/rag');

const { normalizeQueryTokens } = require('../src/rag/processing/arabicNormalizer');
const { computeKeywordScore, determineDynamicTopK, retrieveHybridContext } = require('../src/rag/services/hybridRetrievalService');
const { rerankCandidates } = require('../src/rag/services/rerankingService');
const { retrieveContextAsync } = require('../src/services/knowledge');
const { stringToDeterministicUUID, getPointsByIds } = require('../src/rag/vector/qdrantVectorStore');

test('RAG Core, Processing, and Vector Infrastructure Suite', async (t) => {

    await t.test('Initialize DB for RAG Tests', () => {
        initializeDatabase();
        const row = db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get();
        assert.ok(row.count >= 1, "Database should migrate successfully");
    });

    // ----------------------------------------------------
    // 1. ARABIC NORMALIZATION TESTS
    // ----------------------------------------------------
    await t.test('Arabic Normalization & Query Token Tests', async (t) => {
        await t.test('Arabic diacritic removal', () => {
            const input = 'الْكُتُبُ وَالدَّفَاتِرُ';
            const expected = 'الكتب والدفاتر';
            assert.strictEqual(normalizeArabic(input), expected);
        });

        await t.test('Tatweel removal', () => {
            const input = 'كـتـاب';
            const expected = 'كتاب';
            assert.strictEqual(normalizeArabic(input), expected);
        });

        await t.test('Alef normalization', () => {
            const input = 'أحمد إبراهيم آسر';
            const expected = 'احمد ابراهيم اسر';
            assert.strictEqual(normalizeArabic(input), expected);
        });

        await t.test('Alef Maqsura normalization', () => {
            const input = 'على هدى مستشفى';
            const expected = 'علي هدي مستشفي';
            assert.strictEqual(normalizeArabic(input), expected);
        });

        await t.test('Excessive whitespace normalization', () => {
            const input = '   أحمد   إبراهيم \n\n  آسر ';
            const expected = 'احمد ابراهيم اسر';
            assert.strictEqual(normalizeArabic(input), expected);
        });

        await t.test('Preserve Latin terms and numbers', () => {
            const input = 'موديل Llama-3 سعر 500$';
            const expected = 'موديل Llama-3 سعر 500$';
            assert.strictEqual(normalizeArabic(input), expected);
        });

        await t.test('Query tokenization and Arabic stopword filtering', () => {
            const input = 'ما هو سعر الشحن في مصر؟';
            const tokens = normalizeQueryTokens(input);
            // 'ما', 'هو', 'في' are stopwords and should be filtered out.
            // Punctuation like '؟' should be removed.
            assert.ok(!tokens.includes('ما'));
            assert.ok(!tokens.includes('هو'));
            assert.ok(!tokens.includes('في'));
            assert.ok(tokens.includes('سعر'));
            assert.ok(tokens.includes('الشحن'));
            assert.ok(tokens.includes('مصر'));
        });
    });

    // ----------------------------------------------------
    // 2. TEXT CLEANING TESTS
    // ----------------------------------------------------
    await t.test('Text Cleaning Tests', async (t) => {
        await t.test('Line-ending normalization & collapse empty lines', () => {
            const input = 'Line 1\r\n\r\n\r\nLine 2';
            const expected = 'Line 1\n\nLine 2';
            assert.strictEqual(cleanText(input), expected);
        });

        await t.test('Paragraph, headings, and list preservation', () => {
            const input = '# Heading 1\n- List item 1\n- List item 2\n\nParagraph text.';
            const expected = '# Heading 1\n- List item 1\n- List item 2\n\nParagraph text.';
            assert.strictEqual(cleanText(input), expected);
        });
    });

    // ----------------------------------------------------
    // 3. STRUCTURE-AWARE CHUNKING TESTS
    // ----------------------------------------------------
    await t.test('Structure-Aware Chunking Tests', async (t) => {
        const doc = {
            documentId: 'test_doc',
            source: 'knowledge.txt',
            sourceType: 'text',
            originalText: 'س: ما هو سعر الشحن لجميع العملاء؟\nج: سعر الشحن مجاني لكافة محافظات جمهورية مصر العربية في كل الأوقات ولجميع المستخدمين المسجلين بالموقع.\n\n# سياسة الاسترجاع\nيمكن استرجاع السلع خلال 14 يوماً من الاستلام بشرط أن تكون في حالتها الأصلية مع التغليف الأصلي والتحقق الكامل من سلامة المنتج.',
            documentHash: 'some_hash'
        };

        await t.test('Chunk size and overlap validation', () => {
            assert.throws(() => chunkDocument(doc, 100, 50), /حجم المقطع غير صالح/);
            assert.throws(() => chunkDocument(doc, 800, 900), /يجب أن يكون تداخل المقاطع أصغر/);
            assert.throws(() => chunkDocument(doc, 800, -10), /تداخل المقاطع غير صالح/);
        });

        await t.test('Q&A and Heading split preservation', () => {
            const chunks = chunkDocument(doc, 200, 10);
            assert.ok(chunks.length >= 2, "Should divide into multiple chunks");

            // Check linkages
            assert.strictEqual(chunks[0].previousChunkId, null, "First chunk previous ID should be null");
            assert.strictEqual(chunks[chunks.length - 1].nextChunkId, null, "Final chunk next ID should be null");
            assert.strictEqual(chunks[0].nextChunkId, chunks[1].chunkId);
            assert.strictEqual(chunks[1].previousChunkId, chunks[0].chunkId);
        });
    });

    // ----------------------------------------------------
    // 4. PERSISTENCE & SETTINGS VALIDATION TESTS
    // ----------------------------------------------------
    await t.test('RAG Settings Validation Bounds', () => {
        // Validation single checks
        assert.deepStrictEqual(validateSetting('RAG_CHUNK_SIZE', '800'), { valid: true });
        assert.deepStrictEqual(validateSetting('RAG_CHUNK_SIZE', '150'), { valid: false, error: 'حجم المقطع يجب أن يكون رقماً صحيحاً بين 200 و 4000.' });
        assert.deepStrictEqual(validateSetting('RAG_CHUNK_SIZE', '5000'), { valid: false, error: 'حجم المقطع يجب أن يكون رقماً صحيحاً بين 200 و 4000.' });

        assert.deepStrictEqual(validateSetting('RAG_CHUNK_OVERLAP', '120'), { valid: true });
        assert.deepStrictEqual(validateSetting('RAG_CHUNK_OVERLAP', '-20'), { valid: false, error: 'التداخل يجب أن يكون رقماً صحيحاً بين 0 و 1000.' });

        assert.deepStrictEqual(validateSetting('QDRANT_COLLECTION', 'futhing_collection_123'), { valid: true });
        assert.deepStrictEqual(validateSetting('QDRANT_COLLECTION', 'invalid-collection-#$'), { valid: false, error: 'اسم مجموعة Qdrant غير صالح. يجب أن يحتوي فقط على أحرف، أرقام، شرطة سفلية أو شرطة عادية.' });
    });

    // ----------------------------------------------------
    // 5. HYBRID SCORE FUSION, DYNAMIC TOP-K & RE-RANKING TESTS
    // ----------------------------------------------------
    await t.test('Hybrid Score Fusion & Re-ranking Logic', async (t) => {
        await t.test('Compute Keyword Score', () => {
            const chunk = 'ما هو سعر الشحن المجاني؟';
            const tokens = ['سعر', 'الشحن', 'المجاني', 'مصر'];
            const score = computeKeywordScore(chunk, tokens);
            // Matches: 'سعر', 'الشحن', 'المجاني' -> 3 out of 4 -> 0.75
            assert.strictEqual(score, 0.75);
        });

        await t.test('Determine Dynamic Top-K', () => {
            // Simple query
            const simpleK = determineDynamicTopK('سؤال سهل', ['سؤال', 'سهل']);
            assert.strictEqual(simpleK, 3); // MIN_TOP_K default is 3

            // Complex query containing complex keyword
            const complexK = determineDynamicTopK('ما هي سياسة الاسترجاع المتبعة بالتفصيل؟', ['سياسة', 'الاسترجاع', 'المتبعة', 'بالتفصيل']);
            assert.strictEqual(complexK, 7); // MAX_TOP_K default is 7
        });

        await t.test('Re-ranking with phrase match boost and token rewards', () => {
            const candidates = [
                {
                    text: 'سياسة الاسترجاع هنا',
                    source: 'knowledge.txt',
                    chunkId: 'c1',
                    semanticScore: 0.5,
                    keywordScore: 0.5,
                    finalScore: 0.5
                },
                {
                    text: 'تفاصيل سياسة الاسترجاع للمنتجات هي كذا',
                    source: 'knowledge.txt',
                    chunkId: 'c2',
                    semanticScore: 0.6,
                    keywordScore: 0.6,
                    finalScore: 0.6
                }
            ];

            const query = 'سياسة الاسترجاع';
            const threshold = 0.3;
            const topK = 5;

            const reranked = rerankCandidates(candidates, query, topK, threshold);
            assert.strictEqual(reranked.length, 2);
            // 'سياسة الاسترجاع' is an exact phrase match. It should be rewarded.
            // Let's verify sorting is deterministic and correct.
            assert.ok(reranked[0].finalScore >= reranked[1].finalScore);
        });

        await t.test('Re-ranking filter out duplicates and low similarity', () => {
            const candidates = [
                {
                    text: 'مقطع مكرر',
                    source: 'knowledge.txt',
                    chunkId: 'c1',
                    semanticScore: 0.8,
                    keywordScore: 0.8,
                    finalScore: 0.8
                },
                {
                    text: 'مقطع مكرر',
                    source: 'knowledge.txt',
                    chunkId: 'c2',
                    semanticScore: 0.81,
                    keywordScore: 0.8,
                    finalScore: 0.81
                },
                {
                    text: 'مقطع ضعيف جداً',
                    source: 'knowledge.txt',
                    chunkId: 'c3',
                    semanticScore: 0.1,
                    keywordScore: 0.1,
                    finalScore: 0.1
                }
            ];

            const query = 'مكرر';
            const threshold = 0.4;
            const topK = 5;

            const reranked = rerankCandidates(candidates, query, topK, threshold);
            // One duplicate should be removed, and c3 should be below threshold
            assert.strictEqual(reranked.length, 1);
            assert.strictEqual(reranked[0].text, 'مقطع مكرر');
        });
    });

    // ----------------------------------------------------
    // 6. GLOBAL FETCH MOCK FOR VECTOR/EMBEDDING INTEGRATION
    // ----------------------------------------------------
    await t.test('End-to-End Mocked Reindexing & Health Checks', async (t) => {
        // Save original fetch
        const originalFetch = globalThis.fetch;

        // Override fetch
        globalThis.fetch = async (url, options) => {
            const urlStr = String(url);

            // Mock Ollama tags endpoint
            if (urlStr.includes('/api/tags')) {
                return {
                    ok: true,
                    json: async () => ({
                        models: [{ name: 'nomic-embed-text' }]
                    })
                };
            }

            // Mock Ollama embeddings endpoint
            if (urlStr.includes('/api/embeddings')) {
                return {
                    ok: true,
                    json: async () => ({
                        embedding: [0.1, 0.2, -0.5, 0.99] // 4-dimensional vector
                    })
                };
            }

            // Mock Qdrant ready check
            if (urlStr.includes('/readyz')) {
                return { ok: true };
            }

            // Mock Qdrant collection check
            if (urlStr.includes('/collections/futhing_knowledge') && (!options || (options.method !== 'PUT' && options.method !== 'POST'))) {
                return {
                    ok: true,
                    json: async () => ({
                        result: {
                            config: {
                                params: {
                                    vectors: { size: 4 }
                                }
                            },
                            vectors_count: 5
                        }
                    })
                };
            }

            // Mock search endpoint for retrieveHybridContext
            if (urlStr.includes('/points/search')) {
                return {
                    ok: true,
                    json: async () => ({
                        result: [
                            {
                                id: stringToDeterministicUUID('test_chunk_1'),
                                score: 0.85,
                                payload: {
                                    chunkId: 'test_chunk_1',
                                    documentId: 'test_doc',
                                    text: 'هذا مقطع تجريبي عن سياسة الشحن والدفع بالموقع.',
                                    previousChunkId: null,
                                    nextChunkId: 'test_chunk_2'
                                }
                            }
                        ]
                    })
                };
            }

            // Mock points fetch by IDs (neighbor expansion)
            if (urlStr.includes('/collections/futhing_knowledge/points') && options && options.method === 'POST') {
                return {
                    ok: true,
                    json: async () => ({
                        result: [
                            {
                                id: stringToDeterministicUUID('test_chunk_2'),
                                payload: {
                                    chunkId: 'test_chunk_2',
                                    documentId: 'test_doc',
                                    text: 'هذا مقطع مكمل تالٍ لسياسة الشحن والدفع.'
                                }
                            }
                        ]
                    })
                };
            }

            // Mock Qdrant PUT/POST endpoints
            if (options && (options.method === 'PUT' || options.method === 'POST')) {
                return {
                    ok: true,
                    json: async () => ({ result: { status: 'acknowledged' } })
                };
            }

            return { ok: false, status: 404 };
        };

        await t.test('Successful mock indexing execution', async () => {
            // Write a temporary test_knowledge.txt for testing
            const testKbPath = path.resolve(__dirname, '..', 'test_knowledge.txt');
            fs.writeFileSync(testKbPath, 'س: ما هو سعر الشحن؟\nج: سعر الشحن مجاني.', 'utf8');
            process.env.RAG_TEST_KB_PATH = testKbPath;

            const result = await reindexKnowledgeBase(true);
            assert.strictEqual(result.status, 'indexed');
            assert.ok(result.totalVectors > 0);

            // Unchanged skip indexing check
            const skipResult = await reindexKnowledgeBase(false);
            assert.strictEqual(skipResult.status, 'unchanged');
            assert.strictEqual(skipResult.chunksCreated, 0);

            // Clean up temporary text file
            if (fs.existsSync(testKbPath)) fs.unlinkSync(testKbPath);
            delete process.env.RAG_TEST_KB_PATH;
        });

        await t.test('Authenticated status health service returns valid model', async () => {
            const h = await getRAGSystemStatus();
            assert.strictEqual(h.qdrantReachable, true);
            assert.strictEqual(h.ollamaReachable, true);
            assert.strictEqual(h.modelAvailable, true);
            assert.strictEqual(h.retrievalMode, 'vector-ready');
            assert.strictEqual(h.infrastructureMode, 'healthy');
        });

        await t.test('Retrieve Context Async with Neighbor Expansion & Context Budget', async () => {
            const { saveSetting } = require('../src/database/repositories/settingsRepository');
            saveSetting('RAG_NEIGHBOR_EXPANSION', 'true');

            // Retrieve context
            const ctxText = await retrieveContextAsync('ما هو سعر الشحن؟');
            assert.ok(ctxText.includes('هذا مقطع تجريبي'));
            assert.ok(ctxText.includes('هذا مقطع مكمل تالٍ')); // verified neighbor expansion
        });

        // Restore original fetch
        globalThis.fetch = originalFetch;
    });

    t.after(() => {
        db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
        console.log("🧹 Cleaned up isolated test database for RAG tests successfully!");
    });
});
