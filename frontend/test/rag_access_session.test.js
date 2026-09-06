const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function client(body, status = 401) {
 const window = { location: { href: 'http://localhost/dashboard' } };
 const context = { window, URL, console, localStorage: { getItem: () => null },
  fetch: async () => new Response(JSON.stringify(body), { status }) };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/dashboard/api.js'), 'utf8'), context);
 window.Dashboard.api.csrfToken = 'test-only';
 return window;
}
test('legacy RAG wrong password stays in dialog and body remains readable', async () => {
 const w = client({ success: false, error: 'كلمة المرور غير صحيحة.' });
 const r = await w.Dashboard.api.request('/api/v1/rag/access/unlock', { method: 'POST' });
 assert.equal(w.location.href, 'http://localhost/dashboard');
 assert.equal((await r.json()).error, 'كلمة المرور غير صحيحة.');
});
test('expired session on unlock still redirects to login', async () => {
 const w = client({ error: 'Authentication required' });
 await assert.rejects(w.Dashboard.api.request('/api/v1/rag/access/unlock', { method: 'POST' }), /Unauthorized session/);
 assert.equal(w.location.href, '/login');
});
test('other endpoints never treat secondary password error as authenticated', async () => {
 const w = client({ error: 'كلمة المرور غير صحيحة.' });
 await assert.rejects(w.Dashboard.api.request('/api/v1/settings', { method: 'POST' }), /Unauthorized session/);
 assert.equal(w.location.href, '/login');
});
test('new secondary-password 403 stays in dialog', async () => {
 const w = client({ code: 'RAG_PASSWORD_INVALID' }, 403);
 assert.equal((await w.Dashboard.api.request('/api/v1/rag/access/unlock', { method: 'POST' })).status, 403);
 assert.equal(w.location.href, 'http://localhost/dashboard');
});
