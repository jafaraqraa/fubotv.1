const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup(pages, failedId) {
 const calls = [];
 const window = { Dashboard: { api: { request: async (url, options = {}) => {
  calls.push({ url, method: options.method || 'GET' });
  if (!options.method) {
   const page = Number(new URL(url, 'http://localhost').searchParams.get('page'));
   return { ok: true, json: async () => pages[page - 1] };
  }
  const failed = url.includes(`/${failedId}/`);
  return { ok: !failed, status: failed ? 500 : 200,
   json: async () => failed ? { success: false, error: 'index failed' } : { success: true, document: { status: 'active' } } };
 } } } };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/dashboard/rag.js'), 'utf8'), { window, console, Set });
 return { rag: window.Dashboard.rag, calls };
}
const page = (ids, total) => ({ success: true, documents: ids.map(documentId => ({ documentId })), pagination: { total } });
test('uploaded-only library reindexes uploads without requiring knowledge.txt', async () => {
 const { rag, calls } = setup([page(['uploaded-docx'], 1)]);
 const result = await rag.reindexAllDocuments();
 assert.equal(result.total, 1);
 assert.equal(result.failures.length, 0);
 assert.deepEqual(calls.filter(c => c.method === 'POST').map(c => c.url), ['/api/rag/documents/uploaded-docx/reindex']);
});
test('all pages are read before indexing; repeated manual document is deduplicated', async () => {
 const { rag, calls } = setup([page(['manual_text', 'a'], 3), page(['manual_text', 'b'], 3)]);
 assert.equal((await rag.reindexAllDocuments()).total, 3);
 assert.deepEqual(calls.map(c => c.method), ['GET', 'GET', 'POST', 'POST', 'POST']);
 assert.equal(calls.filter(c => c.url === '/api/rag/documents/manual_text/reindex').length, 1);
});
test('partial failure is retained and other documents are attempted', async () => {
 const { rag, calls } = setup([page(['a', 'b'], 2)], 'a');
 const result = await rag.reindexAllDocuments();
 assert.equal(result.failures.length, 1);
 assert.equal(result.failures[0].id, 'a');
 assert.equal(calls.filter(c => c.method === 'POST').length, 2);
});
test('empty library does not call legacy reindex', async () => {
 const { rag, calls } = setup([page([], 0)]);
 await assert.rejects(rag.reindexAllDocuments(), /لا توجد مستندات/);
 assert.equal(calls.length, 1);
});
test('incomplete pagination fails before any mutation', async () => {
 const { rag, calls } = setup([page(['a'], 2), page(['a'], 2)]);
 await assert.rejects(rag.reindexAllDocuments(), /بقية المستندات/);
 assert.ok(calls.every(c => c.method === 'GET'));
});
