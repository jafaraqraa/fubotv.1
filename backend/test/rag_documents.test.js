const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Force isolated test DB for RAG documents library tests
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_rag_docs.db');
process.env.SQLITE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test_rag_docs_session_secret_123';
process.env.NODE_ENV = 'development';

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');

// Import our RAG modules
const docRepo = require('../src/database/repositories/knowledgeDocumentRepository');
const kbDocService = require('../src/rag/services/knowledgeDocumentService');
const {
    validateFilenameSecurity,
    validateMimeAndMagicBytes,
    extractTextFromBuffer,
    computeSHA256,
    computeNormalizedTextHash
} = require('../src/rag/loaders/documentExtractionService');
const { stringToDeterministicUUID } = require('../src/rag/vector/qdrantVectorStore');

test('RAG Knowledge Documents and Secure Library Suite', async (t) => {

    await t.test('Initialize DB for RAG Document Tests', () => {
        initializeDatabase();
        const row = db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get();
        assert.ok(row.count >= 1, "Database should migrate successfully");
    });

    // ----------------------------------------------------
    // 1. FILE & EXTENSION SECURITY VALIDATION TESTS
    // ----------------------------------------------------
    await t.test('Secure Upload Filename and Extension Validation', async (t) => {
        await t.test('Reject null-byte filename', () => {
            assert.throws(() => validateFilenameSecurity('exploit\0.txt'), /يحتوي على محارف غير آمنة/);
        });

        await t.test('Reject path traversal filename', () => {
            assert.throws(() => validateFilenameSecurity('../../../etc/passwd.txt'), /يحتوي على مسارات غير مصرح بها/);
        });

        await t.test('Reject dangerous double extensions', () => {
            assert.throws(() => validateFilenameSecurity('document.php.txt'), /غير آمن ومرفوض تماماً/);
        });

        await t.test('Reject executable files', () => {
            assert.throws(() => validateFilenameSecurity('run.sh'), /غير آمن ومرفوض تماماً/);
            assert.throws(() => validateFilenameSecurity('virus.exe'), /غير آمن ومرفوض/);
        });

        await t.test('Allow safe supported extensions', () => {
            assert.strictEqual(validateFilenameSecurity('policies.pdf'), 'pdf');
            assert.strictEqual(validateFilenameSecurity('prices.txt'), 'txt');
            assert.strictEqual(validateFilenameSecurity('faq.md'), 'md');
            assert.strictEqual(validateFilenameSecurity('store.docx'), 'docx');
        });
    });

    // ----------------------------------------------------
    // 2. MIME AND MAGIC BYTES VALIDATION TESTS
    // ----------------------------------------------------
    await t.test('MIME and Magic Bytes Validation', async (t) => {
        await t.test('Reject fake PDF with text content', () => {
            const buffer = Buffer.from('Fake PDF content');
            assert.throws(() => validateMimeAndMagicBytes('pdf', 'application/pdf', buffer), /بنية ملف PDF غير صالحة/);
        });

        await t.test('Accept valid PDF with %PDF magic signature', () => {
            const buffer = Buffer.from('%PDF-1.4 header contents...');
            assert.doesNotThrow(() => validateMimeAndMagicBytes('pdf', 'application/pdf', buffer));
        });

        await t.test('Reject fake DOCX without zip PK signature', () => {
            const buffer = Buffer.from('Not a zip file');
            assert.throws(() => validateMimeAndMagicBytes('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer), /بنية ملف DOCX غير صالحة/);
        });

        await t.test('Accept valid DOCX with PK zip signature (504b0304)', () => {
            const buffer = Buffer.from('504b030400000000', 'hex');
            assert.doesNotThrow(() => validateMimeAndMagicBytes('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer));
        });
    });

    // ----------------------------------------------------
    // 3. TEXT EXTRACTION TESTS
    // ----------------------------------------------------
    await t.test('Text Extraction from Buffers', async (t) => {
        await t.test('Extract plain text UTF-8 Arabic', async () => {
            const text = 'طرق الدفع المتاحة: نقداً عند الاستلام.';
            const buffer = Buffer.from(text, 'utf8');
            const extracted = await extractTextFromBuffer('txt', buffer);
            assert.strictEqual(extracted, text);
        });

        await t.test('Extract Markdown text', async () => {
            const markdown = '# سياسة المتجر\n\n- الشحن مجاني لجميع المناطق.';
            const buffer = Buffer.from(markdown, 'utf8');
            const extracted = await extractTextFromBuffer('md', buffer);
            assert.strictEqual(extracted, markdown);
        });

        await t.test('Reject empty extracted content', async () => {
            const buffer = Buffer.from('    \n\n   ');
            await assert.rejects(extractTextFromBuffer('txt', buffer), /تعذر استخراج أي نصوص صالحة/);
        });
    });

    // ----------------------------------------------------
    // 4. DUPLICATE DETECTION & SQLITE REGISTRY
    // ----------------------------------------------------
    await t.test('SQLite Registry and Duplicate Detection Tests', async (t) => {
        const docKey = 'doc_test_123_unique';
        const contentHash = 'hash_original_content_xxxx';
        const textHash = 'hash_extracted_text_yyyy';

        await t.test('Create and retrieve document record in SQLite', () => {
            const id = docRepo.insertDocument({
                document_key: docKey,
                original_name: 'test_doc.txt',
                display_name: 'test_doc.txt',
                source_type: 'txt',
                mime_type: 'text/plain',
                storage_name: 'doc_uuid_1.txt',
                storage_path: '/path/to/storage/doc_uuid_1.txt',
                file_size: 100,
                content_hash: contentHash,
                extracted_text_hash: textHash,
                language: 'ar',
                status: 'uploaded',
                is_enabled: 1,
                chunk_count: 0,
                vector_count: 0,
                index_fingerprint: null,
                tenant_id: 'default',
                logical_document_id: docKey,
                version_id: `${docKey}:v1`
            });

            assert.ok(id > 0, "Should insert record successfully");

            const doc = docRepo.getDocumentByKey('default', docKey);
            assert.strictEqual(doc.original_name, 'test_doc.txt');
            assert.strictEqual(doc.content_hash, contentHash);
            assert.strictEqual(doc.status, 'uploaded');
        });

        await t.test('Detect identical content hash', () => {
            const duplicate = docRepo.getDocumentByContentHash('default', contentHash);
            assert.ok(duplicate !== null, "Should locate duplicate document by content hash");
            assert.strictEqual(duplicate.document_key, docKey);
        });

        await t.test('Detect identical text hash', () => {
            const duplicate = docRepo.getDocumentByExtractedTextHash('default', textHash);
            assert.ok(duplicate !== null, "Should locate duplicate document by text hash");
            assert.strictEqual(duplicate.document_key, docKey);
        });

        await t.test('Soft delete/Full delete record', () => {
            const doc = docRepo.getDocumentByKey('default', docKey);
            const deleted = docRepo.deleteDocument('default', doc.id);
            assert.strictEqual(deleted, true);

            const check = docRepo.getDocumentByKey('default', docKey);
            assert.strictEqual(check, undefined, "Document should be deleted from SQLite");
        });
    });

    // ----------------------------------------------------
    // 5. ATOMIC EMBEDDING & PIPELINE RETRY & DELETION TESTS
    // ----------------------------------------------------
    await t.test('Atomic RAG Indexing Pipeline and Vector Deletion', async (t) => {
        // Save original fetch
        const originalFetch = globalThis.fetch;

        // Override fetch to mock Ollama and Qdrant connections
        globalThis.fetch = async (url, options) => {
            const urlStr = String(url);

            if (urlStr.includes('/api/tags')) {
                return {
                    ok: true,
                    json: async () => ({
                        models: [{ name: 'nomic-embed-text' }]
                    })
                };
            }

            if (urlStr.includes('/api/embeddings')) {
                return {
                    ok: true,
                    json: async () => ({
                        embedding: Array.from({ length: 768 }, (_, index) => index === 0 ? 0.1 : 0.001)
                    })
                };
            }

            if (urlStr.includes('/readyz')) {
                return { ok: true };
            }

            if (urlStr.includes('/collections/futhing_knowledge')) {
                return {
                    ok: true,
                    json: async () => ({
                        result: {
                            config: { params: { vectors: { size: 768 } } },
                            vectors_count: 5
                        }
                    })
                };
            }

            if (options && (options.method === 'PUT' || options.method === 'POST' || options.method === 'DELETE')) {
                return {
                    ok: true,
                    json: async () => ({ result: { status: 'acknowledged' } })
                };
            }

            return { ok: false, status: 404 };
        };

        await t.test('End-to-End Pipeline Indexing Workflow', async () => {
            const originalFilename = 'payment-policy.txt';
            const buffer = Buffer.from('طرق الدفع المتاحة: يقبل متجر FUThing الدفع نقداً عند الاستلام داخل فلسطين.', 'utf8');
            let uploaded = [];

            const doc = await kbDocService.uploadAndRegisterDocument(
                originalFilename, 'text/plain', buffer, {
                    tenantId: 'default',
                    _testDependencies: {
                        upsertVectors: async (chunks, vectors) => {
                            uploaded = chunks.map((chunk, index) => ({
                                payload: chunk,
                                vector: vectors[index]
                            }));
                        },
                        getPointsByDocument: async () => uploaded,
                        deleteVectorsByDocument: async () => { uploaded = []; }
                    }
                }
            );
            assert.strictEqual(doc.status, 'active');
            assert.strictEqual(doc.chunk_count, 1);
            assert.strictEqual(doc.vector_count, 1);

            // Verify duplicate detection rejects identical upload
            await assert.rejects(
                kbDocService.uploadAndRegisterDocument(
                    originalFilename, 'text/plain', buffer, { tenantId: 'default' }
                ),
                /موجود مسبقاً/
            );

            // Clean up and delete
            const deleted = await kbDocService.deleteDocument(doc.document_key, { tenantId: 'default' });
            assert.strictEqual(deleted, true);
        });

        // Restore original fetch
        globalThis.fetch = originalFetch;
    });

    t.after(() => {
        db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
        console.log("🧹 Cleaned up isolated test database for RAG document library tests!");
    });
});
