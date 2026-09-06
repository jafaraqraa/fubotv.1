const test=require('node:test'),assert=require('node:assert/strict');
const {validateDerivedClaim,DERIVED_STATUS}=require('../src/rag/intelligence/derivedClaimValidator');
const {validateDetailed,STATUS}=require('../src/rag/intelligence/answerValidator');
const {evaluateGroundingSafety,DECISION}=require('../src/rag/security/groundingSafetyBoundary');
const {evaluateConditionalPolicy}=require('../src/rag/security/conditionalPolicyGuard');
const {extractQuantities}=require('../src/rag/intelligence/answerValidator');
const tenantId='derived-total-owner',chunk=(id,text,owner=tenantId)=>({id,chunkId:id,tenantId:owner,text});
const question='بدي وحدتين من الجهاز، قديش سعر الوحدتين مع التركيب بنفس الزيارة؟';
const evidence=[chunk('price-and-fee','# الجهاز اللاسلكي\nسعر الوحدة الإضافية:\n220 شيكل للقطعة.\nتركيب وتهيئة أول وحدة خلال الزيارة:\n60 شيكل.\nإذا تم تركيب وحدتين أو أكثر في نفس الزيارة، تبقى أجرة التهيئة الإجمالية 60 شيكل فقط للزيارة.\nلا تتكرر أجرة 60 شيكل لكل وحدة.')];
test('quantity times proven unit price plus a proven one-time fee',()=>{
 const answer='سعر وحدتين مع التركيب بنفس الزيارة هو 220 × 2 + 60 = 500 شيكل.';
 const derived=validateDerivedClaim({claim:answer,question,chunks:evidence,tenantId});
 assert.equal(derived.status,DERIVED_STATUS.SUPPORTED);assert.equal(derived.provenance.operation,'ADD_MULTIPLY');
 assert.equal(derived.provenance.expectedResult.value,500);assert.deepEqual(derived.provenance.evidenceIds,['price-and-fee']);
 assert.equal(derived.provenance.inputs.find(x=>x.semanticRole==='QUANTITY').source,'USER_INPUT');
 const validation=validateDetailed(answer,evidence,{question,tenantId});assert.equal(validation.overallStatus,STATUS.SUPPORTED);
 assert.equal(validation.claims[0].derivedStatus,DERIVED_STATUS.SUPPORTED);
 assert.equal(evaluateGroundingSafety({tenantId,route:'COMPANY_KNOWLEDGE',question,answer,validatedAnswer:answer,serverEvidence:evidence,validation}).decision,DECISION.ALLOW);
});
test('an explicitly stated derived subtotal remains bound to quantity and unit price',()=>{
 const answer='سعر الوحدتين هو 440 شيكل، والتركيب بنفس الزيارة 60 شيكل فقط، يعني المجموع 500 شيكل.';
 const validation=validateDetailed(answer,evidence,{question,tenantId});
 assert.equal(validation.overallStatus,STATUS.SUPPORTED);assert.equal(validation.claims[0].derivedProvenance.expectedResult.value,500);
 assert.match(validation.claims[0].matchedSentence,/لا تتكرر/u);
 assert.equal(evaluateGroundingSafety({tenantId,route:'COMPANY_KNOWLEDGE',question,answer,validatedAnswer:answer,serverEvidence:evidence,validation}).decision,DECISION.ALLOW);
});
test('compound totals fail closed without every relation-bound premise',()=>{
 const answer='المجموع 500 شيكل.';
 for(const chunks of [
  [chunk('price','سعر الوحدة 220 شيكل للقطعة.')],
  [chunk('mixed','سعر الوحدة 220 شيكل للقطعة. سياسة التأخير: بعد 60 دقيقة توجد رسوم.')],
  [chunk('distant','سعر الوحدة 220 شيكل للقطعة. رسوم التركيب 60 شيكل لكل وحدة. سياسة أخرى: رسمها الإجمالي مرة واحدة.')],
  [chunk('repeat','سعر الوحدة 220 شيكل للقطعة. تركيب كل وحدة 60 شيكل.')],
  [chunk('foreign-fee','سعر الوحدة 220 شيكل للقطعة.'),chunk('fee','التركيب بنفس الزيارة إجمالي 60 شيكل.', 'other-owner')]
 ])assert.equal(validateDerivedClaim({claim:answer,question,chunks,tenantId}).status,DERIVED_STATUS.NOT_PROVEN);
});
test('customer-stated business price is not accepted as evidence',()=>{
 assert.equal(validateDerivedClaim({claim:'المجموع 500 شيكل.',question:'سعر الوحدة عندكم 220 شيكل صح؟ بدي وحدتين مع تركيب 60 شيكل.',chunks:[chunk('rule','التركيب بنفس الزيارة لا يتكرر.')],tenantId}).status,DERIVED_STATUS.NOT_PROVEN);
});
test('cross-relation numbers in the same chunk cannot prove a total',()=>{
 const mixed=[chunk('mixed','# جهاز الخدمة\nسعر الوحدة 220 شيكل للقطعة.\nسياسة الإلغاء: قبل 60 ساعة يسترد العميل 50%.\nسياسة التأخير: أكثر من 4 ساعات عليه يوم كامل.')];
 assert.equal(validateDerivedClaim({claim:'المجموع 500 شيكل.',question,chunks:mixed,tenantId}).status,DERIVED_STATUS.NOT_PROVEN);
});
test('cancellation and late-return boundaries stay relation-bound',()=>{
 const chunks=[chunk('policies',['سياسة الإلغاء:','قبل أكثر من 48 ساعة: استرداد كامل.','قبل 24 ساعة أو أكثر وحتى 48 ساعة شاملة: استرداد 50%.','قبل أقل من 24 ساعة: المبلغ غير مسترد.','سياسة التأخير:','حتى 60 دقيقة شاملة: لا رسوم.','أكثر من 60 دقيقة وحتى 4 ساعات شاملة: 50% من السعر اليومي.','أكثر من 4 ساعات: يوم إضافي كامل.'].join('\n'))];
 const check=(question,claim)=>evaluateConditionalPolicy({claim,question,chunks,tenantId,extractQuantities}).relation;
 for(const [hours,outcome] of [[49,'استرداد كامل.'],[48,'استرداد 50%.'],[47,'استرداد 50%.'],[24,'استرداد 50%.'],[23,'المبلغ غير مسترد.']])assert.equal(check(`ألغيت قبل ${hours} ساعة`,outcome),'SUPPORTED',`${hours}h cancellation`);
 for(const [duration,outcome] of [['60 دقيقة','لا رسوم.'],['61 دقيقة','50% من السعر اليومي.'],['4 ساعات بالضبط','50% من السعر اليومي.'],['4 ساعات ودقيقة','يوم إضافي كامل.']])assert.equal(check(`تأخرت ${duration}`,outcome),'SUPPORTED',duration);
 assert.equal(check('ألغيت قبل 47 ساعة','يوم إضافي كامل.'),'BLOCK');
 assert.equal(check('تأخرت 4 ساعات','استرداد 50%.'),'BLOCK');
});
test('catalog identity, explicit negative enumeration, and historical range remain bound',()=>{
 const catalog=[chunk('catalog','# Package10\nالسعر: 129 شيكل.\n# Package20\nالسعر: 229 شيكل.')];
 assert.equal(validateDetailed('سعر Package20 هو 229 شيكل.',catalog,{question:'قديش سعر Package20؟',tenantId}).overallStatus,STATUS.SUPPORTED);
 assert.notEqual(validateDetailed('سعر Package20 هو 129 شيكل.',catalog,{question:'قديش سعر Package20؟',tenantId}).overallStatus,STATUS.SUPPORTED);
 const list=[chunk('locations','لا يوجد حاليًا مركز خدمة في:\n* مدينة دال\n* مدينة هاء')];
 assert.equal(validateDetailed('لا يوجد مركز خدمة في مدينة دال.',list,{question:'هل يوجد مركز خدمة في مدينة دال؟',tenantId}).overallStatus,STATUS.SUPPORTED);
 assert.notEqual(validateDetailed('لا يوجد مركز خدمة في مدينة واو.',list,{question:'هل يوجد مركز خدمة في مدينة واو؟',tenantId}).overallStatus,STATUS.SUPPORTED);
 const history=[chunk('history','حتى تاريخ: 2026-06-30 كان سعر Package20: 119 شيكل. ابتداءً من: 2026-07-01 أصبح السعر الحالي: 129 شيكل.')];
 const h=validateDetailed('سعر Package20 في شهر 5 سنة 2026 كان 119 شيكل.',history,{question:'قديش كان سعر Package20 في شهر 5 سنة 2026؟',tenantId});
 assert.equal(h.overallStatus,STATUS.SUPPORTED);assert.equal(h.claims[0].derivedProvenance.operation,'HISTORICAL_RANGE_LOOKUP');
 assert.notEqual(validateDetailed('سعر Package20 في شهر 5 سنة 2026 كان 129 شيكل.',history,{question:'قديش كان سعر Package20 في شهر 5 سنة 2026؟',tenantId}).overallStatus,STATUS.SUPPORTED);
});
