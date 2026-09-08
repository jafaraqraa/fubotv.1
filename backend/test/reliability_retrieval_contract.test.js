const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveReferent } = require('../src/rag/intelligence/conversationReferent');
const { prioritize, missingAmountEvidence } = require('../src/rag/intelligence/retrievalRelevance');
const { chunkDocument } = require('../src/rag/processing/documentChunker');
const { validateDetailed } = require('../src/rag/intelligence/answerValidator');
const { tableRows } = require('../src/rag/processing/tableStructure');
const table = '| المنتج | سعر يومي شيكل | سعر أسبوعي شيكل | تأمين شيكل |\n|---|---|---|---|\n| MX20 | 420 | 2450 | 1500 |\n| G8 | 140 | 800 | 500 |';
const chunk = { id:'prices',text:table,tenantId:'synthetic',retrievalScore:.9 };
test('reference transports entity only, across six-message prompt limit', () => {
 const history = [{role:'user',content:'قديش إيجار الحفارة الصغيرة لليوم؟'}, ...Array.from({length:8},()=>({role:'assistant',content:'قيمة مختلقة 999'}))];
 const result = resolveReferent('والأسبوع؟',history);
 assert.equal(result.status,'RESOLVED'); assert.equal(result.entity,'الحفارة الصغيرة');
 assert.doesNotMatch(result.query,/999/);
});
test('warranty follow-up resolves to the product from user history', () => {
 const result = resolveReferent('وقديش كفالتها؟', [
  {role:'user',content:'قديش سعر بطارية Atlas Home 5K؟'},
  {role:'assistant',content:'سعرها 18,700 شيكل.'}
 ]);
 assert.equal(result.status,'RESOLVED');
 assert.match(result.query,/HOME 5K/i);
});
test('warranty follow-up ignores stale products outside the active conversation window', () => {
 const stale = Array.from({length:7},(_,index)=>({role:'user',content:`قديش سعر OLD-${index}؟`}));
 const result = resolveReferent('كم كفالتها طيب؟', [
  ...stale,
  {role:'user',content:'مرحبا'},
  {role:'user',content:'قديش سعر بطارية Atlas Home 5K؟'},
  {role:'user',content:'كم كفالتها طيب؟'}
 ]);
 assert.equal(result.status,'RESOLVED');
 assert.equal(result.entity,'HOME 5K');
 assert.match(result.query,/كفالتها طيب HOME 5K/u);
});
test('specifications follow-up inherits the active product', () => {
 const result = resolveReferent('شو مواصفاتها طيب؟', [
  {role:'user',content:'قديش سعر بطارية Atlas Home 3K؟'},
  {role:'user',content:'كم كفالتها طيب؟'},
  {role:'user',content:'شو مواصفاتها طيب؟'}
 ]);
 assert.equal(result.status,'RESOLVED');
 assert.equal(result.entity,'HOME 3K');
});
test('multiple user entities clarify and assistant entities never resolve', () => {
 assert.equal(resolveReferent('والتأمين عليها؟',[{role:'user',content:'MX20'},{role:'user',content:'G8'}]).entity,'G8');
 assert.equal(resolveReferent('والتأمين عليها؟',[{role:'user',content:'MX20 و G8'}]).status,'AMBIGUOUS');
 assert.equal(resolveReferent('والأسبوع؟',[{role:'assistant',content:'MX20'}]).status,'UNRESOLVED');
});
test('amount exclusion is not amount evidence', () => {
 assert.equal(missingAmountEvidence('التأمين قديش؟',[{text:'السعر اليومي 420 لا يشمل التأمين.'}]),true);
 assert.equal(missingAmountEvidence('تأمين MX20 قديش؟',[chunk]),false);
 assert.equal(missingAmountEvidence('تأمين K99 قديش؟',[chunk]),true);
});
test('required table outranks high-score irrelevant material', () => {
 assert.equal(prioritize('قديش MX20 بالأسبوع؟',[{id:'wrong',text:'عنوان الفرع',finalScore:.99},chunk])[0].id,'prices');
});
test('table rows retain their headers and stay bounded during chunking', () => {
 const text = table + '\n' + Array.from({length:20},(_,i)=>`| X${i} | ${100+i} | ${700+i} | 900 |`).join('\n');
 const chunks = chunkDocument({documentId:'grid',source:'grid.md',originalText:text},200,60);
 assert.ok(chunks.length>2);
 for (const item of chunks) assert.ok(item.text.length<=200);
 assert.match(tableRows(table),/سعر أسبوعي شيكل: 2450/);
});
test('table cell price is supported, swapped daily/weekly values are rejected', () => {
 const opts={tenantId:'synthetic',question:'قديش MX20 بالأسبوع؟'};
 assert.equal(validateDetailed('سعر MX20 الأسبوعي 2450 شيكل.',[chunk],opts).overallStatus,'SUPPORTED');
 assert.notEqual(validateDetailed('سعر MX20 الأسبوعي 420 شيكل.',[chunk],opts).overallStatus,'SUPPORTED');
});
test('a true exclusion cannot answer a requested deposit amount', () => {
 const evidence=[{id:'deposit',text:'التأمين 1500 شيكل. السعر اليومي لا يشمل التأمين.',tenantId:'synthetic'}];
 assert.notEqual(validateDetailed('السعر اليومي لا يشمل التأمين.',evidence,{tenantId:'synthetic',question:'قديش التأمين؟'}).overallStatus,'SUPPORTED');
});
