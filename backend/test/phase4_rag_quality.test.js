const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { chunkDocument } = require('../src/rag/processing/documentChunker');
const { rerankCandidates } = require('../src/rag/services/rerankingService');
const { classifyConversationMode, MODE } = require('../src/services/conversationModeRouter');
const PromptBuilder = require('../src/services/PromptBuilder');
const { EvidenceMetadata, EvidenceIndex } = require('../src/rag/intelligence/citationGrounding');
const { buildBudgetedEvidenceContext } = require('../src/services/knowledge');
const { parseSerializedChunks } = require('../src/rag/security/promptInjectionGuard');
const {
    validateAnswer,
    ARABIC_UNVERIFIED_MESSAGE
} = require('../src/rag/intelligence/answerValidator');
const {
    validateFilenameSecurity,
    extractTextFromBuffer
} = require('../src/rag/loaders/documentExtractionService');

const evaluation = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'rag-evaluation.json'), 'utf8'
));

test('Phase 4 deterministic RAG quality evaluation', async (t) => {
    await t.test('evaluation routes casual and company queries correctly', () => {
        for (const item of evaluation) {
            assert.equal(classifyConversationMode(item.input).mode, MODE[item.expectedRoute], item.id);
        }
    });

    await t.test('Arabic chunking preserves headings, metadata, and uniqueness', () => {
        const paragraph = 'الباقة الأساسية متاحة وتشمل الدعم الفني طوال أيام الأسبوع. '.repeat(5);
        const chunks = chunkDocument({
            documentId: 'doc-ar',
            source: 'pricing.md',
            sourceType: 'uploaded_document',
            originalText: `# الأسعار\n\n${paragraph}\n\n${paragraph}`,
            documentHash: 'hash',
            ingestionVersion: 'version-7'
        }, 400, 0);
        assert.ok(chunks.length >= 1);
        assert.equal(chunks[0].heading, 'الأسعار');
        assert.equal(chunks[0].section, 'الأسعار');
        assert.equal(chunks[0].textLength, chunks[0].text.length);
        assert.equal(chunks[0].ingestionVersion, 'version-7');
        assert.equal(new Set(chunks.map(chunk => chunk.contentHash)).size, chunks.length);
    });

    await t.test('reranking is deterministic and rejects misleading weak matches', () => {
        const candidates = [
            { chunkId: 'irrelevant', text: 'اسم المنتج شحن سريع ولا توجد سياسة توصيل.', semanticScore: 0.2, keywordScore: 1, finalScore: 0.36 },
            { chunkId: 'policy', text: 'رسوم توصيل الطلب إلى رام الله هي 20 شيكل.', semanticScore: 0.82, keywordScore: 0.5, finalScore: 0.756 }
        ];
        const first = rerankCandidates(candidates, 'ما رسوم الشحن إلى رام الله؟', 5, 0.4);
        const second = rerankCandidates(candidates, 'ما رسوم الشحن إلى رام الله؟', 5, 0.4);
        assert.deepEqual(first.map(item => item.chunkId), second.map(item => item.chunkId));
        assert.deepEqual(first.map(item => item.chunkId), ['policy']);
    });

    await t.test('prompt includes current question once and bounds history', () => {
        const question = 'كم سعر الباقة؟';
        const messages = PromptBuilder.buildMessages({
            systemPrompt: 'تعليمات النظام',
            conversationHistory: [
                ...Array.from({ length: 8 }, (_, index) => ({
                    role: index % 2 ? 'assistant' : 'user',
                    content: `رسالة ${index}`
                })),
                { role: 'user', content: question }
            ],
            knowledgeContext: '',
            userQuestion: question
        });
        assert.equal(messages.filter(message => message.content.includes(question)).length, 1);
        assert.ok(messages.length <= 8);
        assert.equal(messages.filter(message => message.role === 'system').length, 1);
    });

    await t.test('context budget retains valid serialized citations', () => {
        const evidence = new EvidenceIndex();
        for (let index = 0; index < 4; index++) {
            const candidate = {
                chunkId: `chunk-${index}`,
                documentId: `doc-${index}`,
                source: `source-${index}.txt`,
                text: `معلومة موثقة رقم ${index}. `.repeat(80),
                finalScore: 0.9 - index * 0.05,
                payload: { tenantId: 'default', sourceType: 'uploaded_document' }
            };
            evidence.registerActive(EvidenceMetadata.map(candidate), candidate.text);
        }
        const context = buildBudgetedEvidenceContext(evidence, 900);
        assert.ok(context.length <= 900);
        const parsed = parseSerializedChunks(context);
        assert.ok(Array.isArray(parsed) && parsed.length >= 1);
        assert.equal(evidence.getActive().length, parsed.length);
    });

    await t.test('unsupported facts produce approved fallback once', () => {
        const result = validateAnswer(
            'لدينا فرع على القمر. والاشتراك هناك مجاني.',
            [{ chunkId: 'earth', text: 'مقر الشركة موجود في رام الله فقط.' }]
        );
        assert.equal(result.split(ARABIC_UNVERIFIED_MESSAGE).length - 1, 1);
        assert.ok(!result.includes('القمر'));
        assert.ok(!result.includes('مجاني'));
    });

    await t.test('fallback citation identifiers are stable', () => {
        const candidate = { documentId: 'doc', text: 'دليل ثابت', payload: {} };
        assert.equal(EvidenceMetadata.map(candidate).chunkId, EvidenceMetadata.map(candidate).chunkId);
    });

    await t.test('supported formats are explicit and empty extraction fails', async () => {
        assert.equal(validateFilenameSecurity('knowledge.txt'), 'txt');
        assert.equal(validateFilenameSecurity('knowledge.md'), 'md');
        assert.equal(validateFilenameSecurity('knowledge.pdf'), 'pdf');
        assert.equal(validateFilenameSecurity('knowledge.docx'), 'docx');
        assert.throws(() => validateFilenameSecurity('knowledge.csv'), /غير مدعوم/);
        await assert.rejects(extractTextFromBuffer('txt', Buffer.alloc(0)), /فارغ/);
        await assert.rejects(extractTextFromBuffer('txt', Buffer.from('   ')), /تعذر استخراج/);
    });
});
