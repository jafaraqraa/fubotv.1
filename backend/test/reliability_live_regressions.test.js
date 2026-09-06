const test = require('node:test');
const assert = require('node:assert/strict');
const { tableFacts, tableRows } = require('../src/rag/processing/tableStructure');
const { resolveReferent } = require('../src/rag/intelligence/conversationReferent');
const { decomposeQuery } = require('../src/rag/intelligence/queryDecomposer');
const { prioritize, missingAmountEvidence } = require('../src/rag/intelligence/retrievalRelevance');
const { validateDetailed } = require('../src/rag/intelligence/answerValidator');
const { extractQuantities } = require('../src/rag/intelligence/answerValidator');
const { evaluateConditionalPolicy } = require('../src/rag/security/conditionalPolicyGuard');
const { recoverEvidenceExcerpt } = require('../src/rag/intelligence/evidenceExcerptRecovery');

test('billing period and daily adjectives are not price units', () => {
 const facts = tableFacts('| المنتج | يومي | أسبوعي (7 أيام) |\n|---|---|---|\n| R22 | 37 | 210 |');
 assert.match(facts, /يومي: 37\n/);
 assert.match(facts, /أسبوعي \(7 أيام\): 210$/);
});
test('explicit unique document currency follows monetary cells without changing durations', () => {
 const source = '**العملة:** شيكل إسرائيلي جديد (ILS).\n| المنتج | يومي | أسبوعي (7 أيام) | الحد الأدنى |\n|---|---|---|---|\n| R22 | 37 | 210 | 2 أيام |';
 const text = tableRows(source);
 assert.match(text, /أسبوعي \(7 أيام\): 210 ILS/);
 assert.match(text, /الحد الأدنى: 2 أيام/);
 const options = {tenantId:'test',question:'قديش R22 بالأسبوع؟'};
 const chunks = [{id:'row',text,tenantId:'test'}];
 assert.equal(validateDetailed('سعر R22 الأسبوعي 210 شيكل.',chunks,options).overallStatus,'SUPPORTED');
 assert.notEqual(validateDetailed('سعر R22 الأسبوعي 37 شيكل.',chunks,options).overallStatus,'SUPPORTED');
 assert.notEqual(validateDetailed('سعر R22 الأسبوعي 210 دولار.',chunks,options).overallStatus,'SUPPORTED');
});
test('unknown currency is never invented', () => {
 assert.doesNotMatch(tableRows('| المنتج | يومي |\n|---|---|\n| R22 | 37 |'), /ILS|USD/);
});
test('follow-up retains its entity in the retrieval clause', () => {
 const resolved = resolveReferent('والأسبوع؟',[{role:'user',content:'قديش R22؟'}]);
 const queries = decomposeQuery(resolved.query);
 assert.equal(queries.length,1);
 assert.match(queries[0].originalQuery,/R22/);
});
test('intent classification retains original business condition', () => {
 const queries = decomposeQuery('تأخرت بإرجاع المعدة 61 دقيقة، شو الرسوم؟');
 assert.ok(queries.some(query=> /61 دقيقة/.test(query.originalQuery)));
});
test('late policy outranks general product listing', () => {
 const chunks=[{id:'catalog',text:'المعدة R22 السعر اليومي 37'},{id:'late',text:'التأخير أكثر من 60 دقيقة وحتى 4 ساعات: 50% من السعر اليومي.'}];
 assert.equal(prioritize('تأخرت بإرجاع المعدة 61 دقيقة',chunks)[0].id,'late');
});
test('elliptical deposit question cannot be satisfied by an exclusion', () => {
 assert.equal(missingAmountEvidence('والتأمين عليها R22؟',[{text:'سعر R22 لا يشمل التأمين.'}]),true);
 assert.equal(missingAmountEvidence('هل سعر R22 يشمل التأمين؟',[{text:'سعر R22 لا يشمل التأمين.'}]),false);
});
const policy = [{id:'policy',tenantId:'test',text:'## 4. الإلغاء\nللحجوزات المؤكدة قبل بدء الإيجار:\n- أكثر من 48 ساعة: استرداد كامل.\n- 24 ساعة أو أكثر وحتى 48 ساعة شاملة: استرداد 50%.\n- أقل من 24 ساعة: مبلغ الحجز غير مسترد.\n## 5. التأخير\n- حتى 60 دقيقة شاملة: بلا رسوم تأخير.\n- أكثر من 60 دقيقة وحتى 4 ساعات شاملة: 50% من السعر اليومي.\n- أكثر من 4 ساعات: يوم إيجار إضافي كامل.'}];
test('numbered headings keep cancellation separate from lateness', () => {
 const result = evaluateConditionalPolicy({claim:'إذا ألغيت قبل 47 ساعة بسترد 50%.',question:'إذا ألغيت قبل 47 ساعة، كم بسترد؟',chunks:policy,tenantId:'test',extractQuantities});
 assert.equal(result.relation,'SUPPORTED');
 assert.equal(result.active.evidenceId,'policy');
 assert.match(result.active.scope,/الإلغاء/);
 const wrong=evaluateConditionalPolicy({claim:'إذا ألغيت قبل 47 ساعة بسترد 100%.',question:'إذا ألغيت قبل 47 ساعة، كم بسترد؟',chunks:policy,tenantId:'test',extractQuantities});
 assert.equal(wrong.relation,'BLOCK');
});
test('compound duration with Arabic punctuation crosses the four-hour boundary', () => {
 const result=evaluateConditionalPolicy({claim:'الرسوم لتأخير 4 ساعات ودقيقة هي يوم إيجار إضافي كامل.',question:'تأخرت 4 ساعات ودقيقة، شو الرسوم؟',chunks:policy,tenantId:'test',extractQuantities});
 assert.equal(result.relation,'SUPPORTED');
 assert.match(result.active.outcome,/إضافي كامل/);
});
test('duplicate overlap is not a second competing policy branch', () => {
 const result=evaluateConditionalPolicy({claim:'رسوم التأخير 50% من السعر اليومي.',question:'تأخرت 61 دقيقة',chunks:[...policy,{...policy[0],id:'overlap'}],tenantId:'test',extractQuantities});
 assert.equal(result.relation,'SUPPORTED');
});
test('independent price and minimum quantities retain their own table columns', () => {
 const chunks=[{id:'bakery',tenantId:'test',text:'| الصنف | سعر القطعة | الحد الأدنى |\n|---|---|---|\n| كعكة تمر | 12 شيكل | 6 قطع |'}];
 const options={tenantId:'test',question:'قديش سعر كعكة التمر؟'};
 assert.equal(validateDetailed('سعر قطعة كعكة التمر 12 شيكل والحد الأدنى للطلب 6 قطع.',chunks,options).overallStatus,'SUPPORTED');
 assert.notEqual(validateDetailed('سعر قطعة كعكة التمر 6 شيكل والحد الأدنى للطلب 12 قطع.',chunks,options).overallStatus,'SUPPORTED');
});
test('negative attendance clause does not negate independent credit approval requirement', () => {
 const chunks=[{id:'credit',tenantId:'test',text:'الحساب الآجل يحتاج موافقة مسبقة، والحضور السابق لا يمنحه تلقائياً.'}];
 const result=validateDetailed('الحساب الآجل يحتاج موافقة مسبقة. الحضور السابق لا يمنحه تلقائياً.',chunks,{tenantId:'test',question:'حضرت قبل، يعني الحساب الآجل تلقائي؟'});
 assert.equal(result.overallStatus,'SUPPORTED');
 assert.notEqual(validateDetailed('الحساب الآجل لا يحتاج موافقة مسبقة.',chunks,{tenantId:'test',question:'هل الحساب الآجل يحتاج موافقة؟'}).overallStatus,'SUPPORTED');
});
test('table projection does not hide general eligibility prose in the same chunk', () => {
 const chunks=[{id:'mixed',tenantId:'test',text:'| المنتج | يومي |\n|---|---|\n| R22 | 37 |\nالمستأجر يجب أن يكون 21 سنة أو أكثر.\nمشغل R22 يجب أن يكون 23 سنة أو أكثر.'}];
 const question='عمري 22 سنة، بقدر أستأجر R22 وأشغلها؟';
 const answer='المستأجر يجب أن يكون 21 سنة أو أكثر. مشغل R22 يجب أن يكون 23 سنة أو أكثر.';
 assert.equal(validateDetailed(answer,chunks,{question,tenantId:'test'}).overallStatus,'SUPPORTED');
 const recovery=recoverEvidenceExcerpt(question,chunks,'test');
 assert.ok(recovery);
 assert.match(recovery.answer,/21/);
 assert.match(recovery.answer,/23/);
 assert.equal(recoverEvidenceExcerpt(question,chunks,'other'),null);
});
test('excerpt recovery copies the relevant minimum cell and refuses unavailable facts', () => {
 const chunks=[{id:'row',tenantId:'test',text:'| المنتج | يومي | الحد الأدنى |\n|---|---|---|\n| R22 | 37 شيكل | يومان |'}];
 const recovered=recoverEvidenceExcerpt('R22 بقدر آخذها ليوم واحد؟',chunks,'test');
 assert.ok(recovered);
 assert.match(recovered.answer,/يومان/);
 assert.doesNotMatch(recovered.answer,/37/);
 assert.equal(recoverEvidenceExcerpt('هل R22 متوفر الآن؟',chunks,'test'),null);
 assert.equal(recoverEvidenceExcerpt('هل السعر اليومي R22 يشمل التأمين؟',chunks,'test'),null);
 assert.equal(recoverEvidenceExcerpt('R99 بقدر آخذها ليوم واحد؟',chunks,'test'),null);
});
test('inclusion recovery requires explicit inclusion evidence, never a price cell', () => {
 const question='هل السعر اليومي R22 يشمل التأمين؟';
 const chunks=[{id:'terms',tenantId:'test',text:'السعر اليومي لا يشمل التأمين.'}];
 assert.equal(prioritize(question,[{id:'price',text:'R22 يومي: 37'},...chunks])[0].id,'terms');
 const recovered=recoverEvidenceExcerpt(question,chunks,'test');
 assert.ok(recovered);
 assert.equal(recovered.answer,'السعر اليومي لا يشمل التأمين.');
 assert.equal(recoverEvidenceExcerpt('والتأمين عليها R22؟',chunks,'test'),null);
 assert.notEqual(validateDetailed('السعر اليومي لا يشمل التأمين.',chunks,{question:'والتأمين عليها R22؟',tenantId:'test'}).overallStatus,'SUPPORTED');
});
