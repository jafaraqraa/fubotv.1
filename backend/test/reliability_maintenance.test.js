const test=require('node:test'),assert=require('node:assert/strict');
const fixtures=require('./fixtures/reliability/maintenance-traces.json');
const {validateDetailed}=require('../src/rag/intelligence/answerValidator');
const {decideEvidence}=require('../src/rag/intelligence/evidenceDecisionGate');
const {recoverEvidenceExcerpt}=require('../src/rag/intelligence/evidenceExcerptRecovery');
const {applyGroundingSafetyBoundary}=require('../src/rag/security/groundingSafetyBoundary');
const validate=(answer,g)=>validateDetailed(answer,g.chunks,{question:g.query,tenantId:g.tenantId});
for(const f of fixtures)test(`original trace replay ${f.i}: gate, validator and delivery boundary`,()=>{
 assert.equal(decideEvidence(f.gate).decision,'ANSWER');
 let answer=f.raw || recoverEvidenceExcerpt(f.gate.query,f.gate.chunks,f.gate.tenantId)?.answer;
 let v=validate(answer,f.gate);
 if(v.overallStatus!=='SUPPORTED'){
  const recovered=recoverEvidenceExcerpt(f.gate.query,f.gate.chunks,f.gate.tenantId);
  assert.ok(recovered,'safe source recovery must be available');answer=recovered.answer;v=recovered.validation;
 }
 assert.equal(v.overallStatus,'SUPPORTED');
 const b=applyGroundingSafetyBoundary({...f.boundary,answer,validatedAnswer:answer,question:f.gate.query,tenantId:f.gate.tenantId,serverEvidence:f.gate.chunks,validation:v,shadowMode:false,enforcementActive:true});
 assert.equal(b.decision,'ALLOW',JSON.stringify(b.reasons));
});
test('eligibility proof rejects wrong product, unit, threshold, percentage and tenant',()=>{
 const g=fixtures.find(f=>f.i===10).gate;
 for(const a of ['Home 8K عليه خصم 5%.','عليها خصم 5% لأن السعر الأساسي 18,700 دولار (≥ 18,000).','عليها خصم 5% لأن السعر الأساسي 18,700 شيكل (≥ 19,000).','عليها خصم 6%.','عليها خصم 5% والتركيب مجاني.'])assert.notEqual(validate(a,g).overallStatus,'SUPPORTED',a);
 assert.notEqual(validate('آه، عليها خصم 5%.',{...g,tenantId:'other-company'}).overallStatus,'SUPPORTED');
 assert.notEqual(validate('Home 3K مؤهلة لخصم 5%.',fixtures.find(f=>f.i===11).gate).overallStatus,'SUPPORTED');
});
test('negation reversal never inherits a catalog denial proof',()=>{
 const g=fixtures.find(f=>f.i===25).gate;
 for(const a of ['الكتالوج يثبت توفر المخزون.','وجود البطارية بالقائمة يعني توفرها في المخزن الآن.'])assert.notEqual(validate(a,g).overallStatus,'SUPPORTED',a);
});
test('tomorrow availability requires explicit uncertainty, not confirmation rule alone',()=>{
 const g={...fixtures.find(f=>f.i===26).gate,query:'في موعد بكرا الصبح؟'};
 for(const a of ['الموعد لا يصبح مؤكدًا إلا بعد تأكيد الشركة.','لا يوجد موعد بكرا.','حجزت لك موعد بكرا.','سأتابع وأرجعلك بالموعد.'])assert.notEqual(validate(a,g).overallStatus,'SUPPORTED',a);
 const recovery=recoverEvidenceExcerpt(g.query,g.chunks,g.tenantId);assert.ok(recovery);assert.match(recovery.answer,/لا تحتوي.*جدول/u);
});
test('provider failures are technical and redact upstream URLs and key details',()=>{
 const {providerFailure}=require('../src/services/providerFailure');
 const quota=providerFailure(new Error('Key limit exceeded (total limit). https://provider.invalid/keys/private-id'));
 assert.equal(quota.kind,'BUDGET_EXHAUSTED');assert.equal(quota.retryable,false);assert.doesNotMatch(quota.message,/private-id|https|المعلومة غير/);
 assert.equal(providerFailure(new Error('request timed out')).kind,'TIMEOUT');
});
for(const f of require('./fixtures/reliability/maintenance-extra.json'))test(`new live regression ${f.i}`,()=>{
 const validation=validate(f.raw,f.gate);
 assert.equal(validation.overallStatus,'SUPPORTED');
 assert.equal(applyGroundingSafetyBoundary({answer:f.raw,validatedAnswer:f.raw,question:f.gate.query,tenantId:f.gate.tenantId,serverEvidence:f.gate.chunks,validation,shadowMode:false,enforcementActive:true}).decision,'ALLOW');
 if(f.i===13)assert.notEqual(validate(f.raw.replace('12,900','12,255'),f.gate).overallStatus,'SUPPORTED');
 if(f.i===13){
  const answer='باقة Home 3K سعرها الأساسي 12,900 شيكل، وهي غير مؤهلة للخصم.';
  const v=validate(answer,f.gate);assert.equal(v.overallStatus,'SUPPORTED');
  assert.equal(applyGroundingSafetyBoundary({answer,validatedAnswer:answer,question:f.gate.query,tenantId:f.gate.tenantId,serverEvidence:f.gate.chunks,validation:v,shadowMode:false,enforcementActive:true}).decision,'ALLOW');
 }
});
test('calendar punctuation is never interpreted as a subtraction proof',()=>{
 const {validateDerivedClaim}=require('../src/rag/intelligence/derivedClaimValidator');
 assert.equal(validateDerivedClaim({claim:'حتى 2026-04-30 كان المكتب يغلق 13:00.',question:'ساعات المكتب سابقا؟',chunks:[]}).status,'NOT_PROVEN');
});
test('dialect refund negation preserves the less-than-three-days branch',()=>{
 const g={query:'قبل يومين إلغاء الحجز؟',tenantId:'test',chunks:[{id:'cancel',tenantId:'test',text:'إذا أُلغي قبل الموعد بأقل من 3 أيام: مبلغ الحجز غير مسترد.'}]};
 assert.equal(validate('إذا ألغيت الحجز قبل يومين (أي أقل من 3 أيام)، مبلغ الحجز ما بيرجع.',g).overallStatus,'SUPPORTED');
 assert.notEqual(validate('إذا ألغيت الحجز قبل يومين، مبلغ الحجز بيرجع.',g).overallStatus,'SUPPORTED');
});
test('conditional source recovery copies the unique applicable inclusive branch',()=>{
 const chunks=[{id:'refund',tenantId:'test',text:'إلغاء الحجز\nقبل أكثر من 48 ساعة: يُرد كامل مبلغ الحجز.\nقبل 24 ساعة أو أكثر وحتى 48 ساعة شاملة: يُرد 50% من مبلغ الحجز.\nقبل أقل من 24 ساعة: مبلغ الحجز غير مسترد.'}];
 const q='إذا ألغيت قبل 24 ساعة، كم بسترد؟';
 const recovered=recoverEvidenceExcerpt(q,chunks,'test');assert.ok(recovered);assert.match(recovered.answer,/50%/);
 assert.equal(recoverEvidenceExcerpt(q,chunks,'foreign'),null);
 const boundary=applyGroundingSafetyBoundary({answer:recovered.answer,validatedAnswer:recovered.answer,question:q,tenantId:'test',serverEvidence:chunks,validation:recovered.validation,shadowMode:false,enforcementActive:true});
 assert.equal(boundary.decision,'ALLOW');
});
test('attached duration preposition remains a quantity for branch selection',()=>{
 const {extractQuantities}=require('../src/rag/intelligence/answerValidator');
 assert.ok(extractQuantities('قبل التركيب بـ8 أيام').some(q=>q.value===8&&q.unit==='DAY'));
});
test('mentioning both roles without the renter threshold is not responsive',()=>{
 const g={query:'عمري 22 سنة بقدر أستأجر وأشغل؟',tenantId:'test',chunks:[{id:'ages',tenantId:'test',text:'المستأجر الأساسي يجب أن يكون 21 سنة أو أكثر. مشغل المعدة يجب أن يكون 23 سنة أو أكثر. شرط 23 سنة شرط إضافي للمشغل ولا يغيّر الحد الأدنى العام للمستأجر.'}]};
 assert.notEqual(validate('شرط 23 سنة شرط إضافي للمشغل ولا يغيّر الحد الأدنى العام للمستأجر.',g).overallStatus,'SUPPORTED');
 const recovered=recoverEvidenceExcerpt(g.query,g.chunks,g.tenantId);assert.ok(recovered);assert.match(recovered.answer,/21/);assert.match(recovered.answer,/23/);
});
test('verbatim shared operator rule retains both source product identities',()=>{
 const question='عمري 22 سنة، بقدر أستأجر الحفارة MX20 وأشغلها أنا؟';
 const chunks=[{id:'shared-age',tenantId:'test',text:'المستأجر الأساسي يجب أن يكون **21 سنة أو أكثر** مع هوية سارية ورقم هاتف فعال. مشغل MX20 أو SL10 يجب أن يكون **23 سنة أو أكثر**. شرط 23 سنة شرط إضافي للمشغل ولا يغيّر الحد الأدنى العام للمستأجر.'}];
 const recovered=recoverEvidenceExcerpt(question,chunks,'test');assert.ok(recovered);assert.match(recovered.answer,/21/);assert.match(recovered.answer,/23/);
 assert.equal(applyGroundingSafetyBoundary({answer:recovered.answer,validatedAnswer:recovered.answer,question,tenantId:'test',serverEvidence:chunks,validation:recovered.validation,shadowMode:false,enforcementActive:true}).decision,'ALLOW');
 assert.equal(recoverEvidenceExcerpt(question,chunks,'foreign'),null);
 assert.notEqual(validateDetailed('مشغل MX20 أو SL10 يجب أن يكون 21 سنة أو أكثر.',chunks,{question,tenantId:'test'}).overallStatus,'SUPPORTED');
});
