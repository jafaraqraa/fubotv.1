const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardJs = path.join(__dirname, '..', 'public', 'js', 'dashboard');

test('conversation composer contains no simulated media delivery or false-success catch', () => {
    const source = fs.readFileSync(path.join(dashboardJs, 'composer.js'), 'utf8');
    assert.doesNotMatch(source, /futh-storage\.com/);
    assert.doesNotMatch(source, /simulation dispatched successfully/i);
    assert.match(source, /readAsDataURL/);
    assert.match(source, /mediaData/);
    assert.match(source, /result\.success/);
});

test('RAG controls contain no random simulated progress or unconditional operation success', () => {
    const source = fs.readFileSync(path.join(dashboardJs, 'rag.js'), 'utf8');
    assert.doesNotMatch(source, /simulateIndexingProgress/);
    assert.doesNotMatch(source, /Math\.random\(\)\s*\*\s*12/);
    assert.doesNotMatch(source, /تم تنفيذ الإجراء.*بنجاح/);
    assert.match(source, /reconciliation\/run/);
    assert.match(source, /هذه العملية غير منفذة في الخادم حالياً/);
    assert.match(source, /runBulkRequests/);
});
