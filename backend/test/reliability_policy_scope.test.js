const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDetailed, numericEntailment } = require('../src/rag/intelligence/answerValidator');
const { evaluateConditionalPolicy } = require('../src/rag/security/conditionalPolicyGuard');
const { extractQuantities } = require('../src/rag/intelligence/answerValidator');
// Synthetic reconstruction of the documented failure, not a production replay.
const chunks = [{ id: 'mixed-policy', tenantId: 'scope-test', retrievalScore: .9, text: [
 'سياسة الإلغاء:',
 'قبل أكثر من 48 ساعة: يرجع المبلغ كامل.',
 'قبل 24–48 ساعة: يرجع 50% من المبلغ.',
 'قبل أقل من 24 ساعة: لا يرجع أي مبلغ.',
 'سياسة التأخير:',
 'التأخير 60 دقيقة أو أقل: لا رسوم.',
 'التأخير أكثر من 60 دقيقة وحتى 4 ساعات: رسوم 50% من إيجار اليوم.',
 'التأخير أكثر من 4 ساعات: رسوم يوم كامل.'
].join('\n') }];
function guard(claim, question) { return evaluateConditionalPolicy({ claim, question, chunks, tenantId: 'scope-test', extractQuantities }); }
test('47 hour cancellation cannot borrow a late-return threshold', () => {
 const result = validateDetailed('إذا ألغيت قبل 47 ساعة، بيرجعلك المبلغ كامل.', chunks, { question: 'أنا ألغيت قبل 47 ساعة، برجعلي المبلغ كامل، صح؟', tenantId: 'scope-test' });
 assert.notEqual(result.overallStatus, 'SUPPORTED');
 assert.equal(guard('بيرجعلك المبلغ كامل.', 'ألغيت قبل 47 ساعة').relation, 'BLOCK');
});
for (const hours of [24, 25, 47, 48]) test(`inclusive cancellation ${hours}h selects half refund`, () => {
 assert.equal(guard('يرجع 50% من المبلغ.', `ألغيت قبل ${hours} ساعة`).relation, 'SUPPORTED');
 assert.equal(guard('يرجع 75% من المبلغ.', `ألغيت قبل ${hours} ساعة`).relation, 'BLOCK');
});
test('same-unit evidence from another policy is not entailment', () => {
 assert.notEqual(numericEntailment('ألغيت قبل 47 ساعة ويرجع المبلغ كامل', 'التأخير أكثر من 4 ساعات: رسوم يوم كامل.', { question: 'ألغيت قبل 47 ساعة' }).relation, 'ENTAILED');
});
test('exact four hours cannot select the above-four branch', () => {
 assert.equal(guard('رسوم يوم كامل.', 'تأخرت 4 ساعات').relation, 'BLOCK');
 assert.equal(guard('رسوم 50% من إيجار اليوم.', 'تأخرت 4 ساعات').relation, 'SUPPORTED');
});
test('four hours plus one minute selects the above-four branch', () => {
 assert.equal(guard('رسوم يوم كامل.', 'تأخرت 4 ساعات ودقيقة').relation, 'SUPPORTED');
});
test('renter minimum cannot prove the operator minimum', () => {
 const text='الحد الأدنى لعمر المستأجر 21 سنة أو أكثر. الحد الأدنى لعمر المشغل 23 سنة أو أكثر.';
 const result=validateDetailed('بقدر أشغل المعدة بعمر 22 سنة.',[{id:'ages',text}],{question:'عمري 22 سنة بقدر أستأجر وأشغل المعدة؟'});
 assert.notEqual(result.overallStatus,'SUPPORTED');
});
test('correct active policy retains source IDs through the enforced boundary', () => {
 const {applyGroundingSafetyBoundary}=require('../src/rag/security/groundingSafetyBoundary');
 const question='ألغيت قبل 47 ساعة'; const answer='إذا ألغيت قبل 47 ساعة، بيرجع 50% من المبلغ.';
 const validation=validateDetailed(answer,chunks,{question,tenantId:'scope-test'});
 assert.equal(validation.overallStatus,'SUPPORTED');
 assert.deepEqual(validation.claims[0].evidenceChunkIds,['mixed-policy']);
 const result=applyGroundingSafetyBoundary({answer:validation.finalAnswer,validatedAnswer:validation.finalAnswer,question,tenantId:'scope-test',route:'COMPANY_KNOWLEDGE',validation,serverEvidence:chunks,shadowMode:false,enforcementActive:true});
 assert.equal(result.decision,'ALLOW');
 assert.equal(guard('ألغيت قبل 99 ساعة، يرجع 50% من المبلغ.',question).relation,'BLOCK');
});
test('Arabic digits retain numeric equality and reject a changed amount', () => {
 const evidence=[{id:'arabic-price',text:'السعر ٤٢٠ شيكل.'}];
 assert.equal(validateDetailed('السعر ٤٢٠ شيكل.',evidence).overallStatus,'SUPPORTED');
 assert.notEqual(validateDetailed('السعر ٤٣٠ شيكل.',evidence).overallStatus,'SUPPORTED');
});
