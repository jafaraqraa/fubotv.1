const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requestedRelations, prioritizeEvidence, relationCoverage, resolveReferent } = require('./rejected-relationCoverage');
test('amount requires a value bound to that relation, not nearby numbers', () => {
    const query = 'قديش التأمين؟';
    assert.deepEqual(requestedRelations(query), ['DEPOSIT']);
    assert.equal(relationCoverage(query, [{ text: 'السعر اليومي 100 لا يشمل التأمين.' }]).sufficient, false);
    assert.equal(relationCoverage(query, [{ text: 'التأمين المسترد: 300' }]).sufficient, true);
});
test('table entity and field beat topical prose without changing source IDs', () => {
    const chunks = [
        { chunkId: 'prose', text: 'يمكن استخدام المنتج وفق الشروط.', finalScore: .9 },
        { chunkId: 'table', text: '| المنتج | السعر الأسبوعي | التأمين |\n|---|---|---|\n| XY17 | 700 | 200 |', finalScore: .3 }
    ];
    assert.equal(prioritizeEvidence('قديش XY17 بالأسبوع؟', chunks)[0].chunkId, 'table');
});
test('history supplies only one entity, never a user asserted business value', () => {
    const resolved = resolveReferent('والتأمين عليها؟', [{ role: 'user', content: 'قديش سعر XY17؟ السعر 999' }]);
    assert.equal(resolved.entity, 'XY17');
    assert.equal(resolved.query.includes('999'), false);
    assert.equal(resolveReferent('والتأمين عليها؟', [
        { role: 'user', content: 'قديش سعر XY17؟' }, { role: 'user', content: 'وقديش سعر AB9؟' }
    ]).status, 'AMBIGUOUS');
    assert.equal(resolveReferent('قديش سعرها؟', []).status, 'UNRESOLVED');
    assert.equal(resolveReferent('والأسبوع؟', [{ role: 'user', content: 'قديش سعر XY17؟' }]).entity, 'XY17');
    assert.equal(resolveReferent('والتأمين عليها؟', [{ role: 'assistant', content: 'XY17' }]).status, 'UNRESOLVED');
});
test('multi-relation coverage preserves all required evidence', () => {
    const c = relationCoverage('شو السعر والحد الأدنى للعمر؟', [{ text: 'السعر 70' }]);
    assert.equal(c.sufficient, false);
    assert.ok(c.missing.includes('AGE'));
});
