const test=require('node:test');
const assert=require('node:assert/strict');
const {validateDetailed,extractQuantities}=require('../src/rag/intelligence/answerValidator');
const {resolveReferent}=require('../src/rag/intelligence/conversationReferent');
const {chunkDocument}=require('../src/rag/processing/documentChunker');
const {contradictoryComparison}=require('../src/rag/intelligence/numericIdentity');
const {conditionalLaborVeto}=require('../src/rag/intelligence/numericIdentity');
const {evaluateConditionalPolicy}=require('../src/rag/security/conditionalPolicyGuard');
const {needsClarification,clarificationForQuery}=require('../src/rag/intelligence/evidenceDecisionGate');
const {prioritize}=require('../src/rag/intelligence/retrievalRelevance');
const {asksAmount}=require('../src/rag/intelligence/retrievalRelevance');
const {recoverEvidenceExcerpt}=require('../src/rag/intelligence/evidenceExcerptRecovery');
const chunks=[{id:'prices',tenantId:'test',text:'Home 3K: قدرة اسمية 3kW، سعر أساسي 12,900 شيكل.\nHome 5K: قدرة اسمية 5kW، سعر أساسي 18,700 شيكل.\nHome 8K: قدرة اسمية 8kW، سعر أساسي 27,900 شيكل.'},
 {id:'discount',tenantId:'test',text:'للباقات المنزلية Home فقط: إذا كانت قيمة الباقة الأساسية 18,000 شيكل أو أكثر، يطبق خصم 5% على سعر الباقة الأساسية.\nHome 5K وHome 8K مؤهلتان وفق الأسعار الحالية؛ Home 3K غير مؤهلة.\nالخصم لا يطبق على البطاريات أو الأعمال الإضافية أو رسوم الزيارة أو الصيانة.'}];
const validate=(answer,question,evidence=chunks)=>validateDetailed(answer,evidence,{tenantId:'test',question});
test('thousands separator is one monetary quantity, not two unrelated premises',()=>{
 assert.deepEqual(extractQuantities('26,505 شيكل.'),[{value:26505,unit:'ILS',operator:'='}]);
 assert.deepEqual(extractQuantities('١٨٬٧٠٠ شيكل.'),[{value:18700,unit:'ILS',operator:'='}]);
});
for(const [code,price] of [['Home 3K','12,900'],['Home 5K','18,700'],['Home 8K','27,900']])test(`product base ${code}`,()=>{
 assert.equal(validate(`سعر ${code} الأساسي ${price} شيكل.`,`قديش سعر ${code}؟`).overallStatus,'SUPPORTED');
});
for(const [code,price] of [['Home 5K','17,765'],['Home 8K','26,505']])test(`product-bound discount ${code}`,()=>{
 assert.equal(validate(`بعد الخصم سعر ${code} هو ${price} شيكل.`,`احسبلي ${code} بعد الخصم.`).overallStatus,'SUPPORTED');
});
test('reject historically accepted price from another product',()=>{
 assert.notEqual(validate('بعد الخصم، سعر Home 5K هو 26,505 شيكل.','احسبلي Home 5K بعد الخصم.').overallStatus,'SUPPORTED');
 const orphan=[{id:'orphan',tenantId:'test',text:'سعر أساسي 27,900 شيكل.'},chunks[1]];
 assert.notEqual(validate('بعد الخصم، سعر Home 5K هو 26,505 شيكل.','احسبلي Home 5K بعد الخصم.',orphan).overallStatus,'SUPPORTED');
 assert.notEqual(validate('Home 5K: 26,505 شيكل.','احسبلي Home 5K بعد الخصم.').overallStatus,'SUPPORTED');
 assert.notEqual(validate('سعر Home 8K بعد الخصم 17,765 شيكل.','احسبلي Home 5K بعد الخصم.').overallStatus,'SUPPORTED');
});
test('explicit spaced product never asks an unnecessary referent clarification',()=>{
 assert.equal(resolveReferent('الـHome 5K عليه خصم؟',[{role:'user',content:'قديش Home 3K؟'}]).status,'NOT_REQUIRED');
});
test('generic explicit numerical contradiction is a veto',()=>{
 const answer='آه، بتنخصم رسوم الكشف 80 شيكل من أجرة الإصلاح لأن أجرة الإصلاح 200 شيكل وهي 250 شيكل أو أكثر بدون احتساب ثمن القطعة.';
 const evidence=[{id:'repair',tenantId:'test',text:'إذا تم تنفيذ إصلاح مدفوع في نفس الزيارة وكانت أجرة الإصلاح 250 شيكل أو أكثر، تُخصم رسوم الكشف 80 شيكل من أجرة الإصلاح.\nإذا كانت أجرة الإصلاح أقل من 250 شيكل فلا تُخصم رسوم الكشف.\nرسوم القطع لا تدخل في حد 250 شيكل.'}];
 assert.notEqual(validate(answer,'إذا التصليح 300 بس منهم 100 ثمن قطعة و200 أجرة إصلاح، بتنخصم رسوم الكشف؟',evidence).overallStatus,'SUPPORTED');
 assert.equal(contradictoryComparison('أجرة العمل 420 شيكل وهي 500 شيكل أو أكثر.'),true);
 assert.equal(contradictoryComparison('أجرة العمل 520 شيكل وهي 500 شيكل أو أكثر.'),false);
});
test('overlap never drops negation or conditional prefix',()=>{
 const lines=['معلومات تمهيدية كاملة. '.repeat(8),'لا يجوز استنتاج توفر موعد اليوم أو توفر قطعة الآن من وجود الخدمة أو المنتج في القائمة.','تفاصيل أخرى مستقلة. '.repeat(9)];
 const result=chunkDocument({documentId:'negation',source:'test',originalText:lines.join('\n\n')},250,80);
 assert.ok(result.length>1);
 for(const c of result) assert.doesNotMatch(c.text,/^يجوز استنتاج|^توفر موعد/u);
 assert.ok(result.some(c=>c.text.includes(lines[1])));
});
test('an unchanged base is not a computed discounted result',()=>{
 assert.notEqual(validate('Home 5K سعره 18,700 شيكل بعد الخصم.','احسبلي Home 5K بعد الخصم.').overallStatus,'SUPPORTED');
 assert.notEqual(validate('Home 3K سعره 12,255 شيكل بعد الخصم.','احسبلي Home 3K بعد الخصم.').overallStatus,'SUPPORTED');
});
test('a rate and its product base outrank unrelated percentage-bearing payments',()=>{
 const unrelated={id:'payment',text:'Home 5K مؤهل. لتركيب نظام جديد: 30% دفعة حجز، 60% قبل التركيب و10% بعد الفحص.'};
 assert.deepEqual(prioritize('احسبلي Home 5K بعد الخصم.',[unrelated,...chunks]).slice(0,2).map(c=>c.id).sort(),['discount','prices']);
});
test('bare battery kilo requests a unit clarification, never assumes weight or power',()=>{
 assert.equal(needsClarification('قديش سعر بطارية 5 كيلو؟'),true);
 assert.match(clarificationForQuery('قديش سعر بطارية 5 كيلو؟'),/kWh/);
});
test('كمان is not كم: battery discount exclusion does not require an amount',()=>{
 const q='إذا ضفت بطارية 5kWh على Home 5K، الخصم بنزل من سعر البطارية كمان؟';
 assert.equal(asksAmount(q),false);
 assert.equal(validate('الخصم لا يطبق على البطاريات أو الأعمال الإضافية أو رسوم الزيارة أو الصيانة.',q).overallStatus,'SUPPORTED');
});
test('follow-up inherits user topic but never old numbers or assistant business facts',()=>{
 const history=[{role:'user',content:'عندي 8 ألواح وبدي تنظيف وفحص، قديش؟'},{role:'assistant',content:'التنظيف 9999 شيكل'}];
 const r=resolveReferent('طيب لو كانوا 15 لوح؟',history);
 assert.equal(r.status,'RESOLVED');assert.match(r.query,/تنظيف وفحص/);assert.match(r.query,/15/);assert.doesNotMatch(r.query,/9999|8/);
 assert.equal(resolveReferent('والأسبوع؟',[]).status,'UNRESOLVED');
 assert.equal(resolveReferent('والأسبوع؟',[{role:'user',content:'Home 3K وHome 5K'}]).status,'AMBIGUOUS');
});
test('hours follow-up retains both location and weekday; colloquial clock is not ignored',()=>{
 const r=resolveReferent('طيب هسّا عالواحدة ولا عالثلاثة؟',[{role:'user',content:'مش كان مكتب رام الله يسكر السبت عالواحدة؟'}]);
 assert.match(r.query,/رام الله السبت/);
 assert.ok(extractQuantities('يعني عالواحدة.').some(q=>q.unit==='CLOCK' && q.value===1));
 assert.notEqual(validate('مكتب رام الله يفتح من 08:30 لحد 17:30، يعني عالواحدة.',r.query,
  [{id:'hours',tenantId:'test',text:'مكتب رام الله السبت 09:00–15:00.'}]).overallStatus,'SUPPORTED');
});
test('current hours alone do not answer a historical correction',()=>{
 const evidence=[{id:'history',tenantId:'test',text:'حتى 2026-04-30 كان مكتب رام الله يغلق السبت الساعة 13:00.\nمن 2026-05-01 أصبحت ساعات السبت الحالية لمكتب رام الله 09:00–15:00.'}];
 const q='مش كان مكتب رام الله يسكر السبت عالواحدة؟';
 assert.notEqual(validate('لا، من 2026-05-01 مكتب رام الله يفتح السبت من 09:00 إلى 15:00.',q,evidence).overallStatus,'SUPPORTED');
 const recovered=recoverEvidenceExcerpt(q,evidence,'test');
 assert.ok(recovered);assert.match(recovered.answer,/13:00/);assert.match(recovered.answer,/15:00/);
});
const cancellation=[{id:'cancel',tenantId:'test',text:'8. إلغاء مشروع جديد بعد دفع الحجز\nإذا أُلغي قبل موعد التركيب بأكثر من 7 أيام تقويمية: يُرد كامل مبلغ الحجز.\nإذا أُلغي قبل الموعد بـ3 أيام إلى 7 أيام inclusive: يُرد 50% من مبلغ الحجز.\nإذا أُلغي قبل الموعد بأقل من 3 أيام: مبلغ الحجز غير مسترد.'}];
test('two-day cancellation duration is not a daily-price request',()=>{
 const {requestedFields,missingAmountEvidence}=require('../src/rag/intelligence/retrievalRelevance');
 const {decideEvidence}=require('../src/rag/intelligence/evidenceDecisionGate');
 const query='إذا ألغيت تركيب النظام قبل يومين بعد دفع الحجز، كم بسترد؟';
 assert.equal(requestedFields(query).includes('daily'),false);
 assert.equal(missingAmountEvidence(query,cancellation),false);
 assert.equal(decideEvidence({query,chunks:cancellation,tenantId:'test'}).decision,'ANSWER');
 for(const q of ['قديش السعر اليومي؟','قديش الإيجار باليوم؟','كم يوميا؟']){
  assert.equal(requestedFields(q).includes('daily'),true);
  assert.equal(missingAmountEvidence(q,cancellation),true);
 }
});
for(const [days,outcome] of [[8,'يُرد كامل مبلغ الحجز.'],[7,'يُرد 50% من مبلغ الحجز.'],[6,'لا، يُرد 50% من مبلغ الحجز.'],[3,'يُرد 50% من مبلغ الحجز.'],[2,'مبلغ الحجز غير مسترد.']])test(`source cancellation boundary ${days}`,()=>{
 const result=evaluateConditionalPolicy({question:`إذا ألغيت قبل ${days} أيام`,claim:outcome,chunks:cancellation,tenantId:'test',extractQuantities});
 assert.equal(result.relation,'SUPPORTED');assert.deepEqual(result.evidenceIds,['cancel']);
});
test('labor eligibility cannot use total or omit material same-visit condition',()=>{
 const evidence=[{text:'إذا تم تنفيذ إصلاح مدفوع في نفس الزيارة وكانت أجرة الإصلاح 250 شيكل أو أكثر، تُخصم رسوم الكشف 80 شيكل من أجرة الإصلاح.'}];
 assert.equal(conditionalLaborVeto('آه، تخصم رسوم الكشف.','300 منهم 100 ثمن قطعة و200 أجرة إصلاح',evidence),'LABOR_BELOW_THRESHOLD');
 assert.equal(conditionalLaborVeto('تخصم رسوم الكشف.','أجرة الإصلاح 250',evidence),'MISSING_SAME_VISIT_CONDITION');
 assert.equal(conditionalLaborVeto('تخصم رسوم الكشف إذا تم إصلاح مدفوع في نفس الزيارة.','أجرة الإصلاح 250',evidence),null);
});
for(const [sector,code,base,other,rate] of [['printing','Print 7X',2300,4500,12],['climate','Cool 9R',5600,7800,15]])test(`held-out ${sector} exact identity arithmetic and tenant isolation`,()=>{
 const evidence=[{id:'base',tenantId:'test',text:`${code}: السعر الأساسي ${base} شيكل.\nOther 6Z: السعر الأساسي ${other} شيكل.`},{id:'rule',tenantId:'test',text:`خصم ${rate}% على سعر ${code}.`}];
 const q=`احسب سعر ${code} بعد الخصم`;
 assert.equal(validate(`سعر ${code} بعد الخصم ${base*(1-rate/100)} شيكل.`,q,evidence).overallStatus,'SUPPORTED');
 assert.notEqual(validate(`سعر ${code} بعد الخصم ${other*(1-rate/100)} شيكل.`,q,evidence).overallStatus,'SUPPORTED');
 assert.notEqual(validateDetailed(`سعر ${code} ${base} شيكل.`,evidence,{question:q,tenantId:'foreign'}).overallStatus,'SUPPORTED');
});
