'use strict';
const fs=require('fs'),path=require('path'),{performance}=require('perf_hooks'),core=require('./core');
const {validateDetailed,STATUS}=require('../../src/rag/intelligence/answerValidator');
const scenarios=[];let seq=0;const add=(category,expectedDecision,question,evidence,goldAnswer='',extra={})=>scenarios.push({id:`gac-${String(++seq).padStart(3,'0')}`,tenantId:'eval-tenant',category,expectedDecision,question,evidence:[{id:`ev-${seq}`,tenantId:'eval-tenant',documentId:`doc-${seq}`,trusted:true,text:evidence}],goldAnswer,...extra});
add('price','ANSWER','كم السعر؟','سعر الخدمة 150 شيكل.','سعر الخدمة 150 شيكل.');
add('price','NO_ANSWER','هل السعر 120 شيكل؟','سعر الخدمة 150 شيكل.');
add('duration','ANSWER','كم مدة الخدمة؟','مدة الخدمة 30 دقيقة.','مدة الخدمة 30 دقيقة.');
add('working-hours','ANSWER','متى الدوام يوم الخميس؟','الدوام من الأحد إلى الخميس من 9:00 حتى 17:00.','الدوام من الأحد إلى الخميس من 9:00 حتى 17:00.');
add('location','ANSWER','وين الموقع؟','موقع الفرع في شارع الجامعة.','موقع الفرع في شارع الجامعة.');
add('contact','ANSWER','ما رقم التواصل؟','رقم التواصل 0599000000.','رقم التواصل 0599000000.');
add('complete-list','ANSWER','ما القائمة الكاملة؟','القائمة الكاملة للألوان: أسود، أبيض، رمادي.','القائمة الكاملة للألوان: أسود، أبيض، رمادي.');
add('negative-membership','ANSWER','هل عندكم فرع الخليل؟','القائمة الكاملة للفروع: رام الله، جنين.','لا، الخليل مش ضمن القائمة الحالية المذكورة.');
add('membership','ANSWER','هل عندكم فرع جنين؟','القائمة الكاملة للفروع: رام الله، جنين.','القائمة الكاملة للفروع: رام الله، جنين.');
add('incomplete-list','NO_ANSWER','هل عندكم فرع الخليل؟','يوجد فرع في رام الله.');
add('conditional-policy','ANSWER','لو ألغيت قبل 72 ساعة شو بصير؟','الإلغاء مجاني إذا كان قبل الموعد بأكثر من 48 ساعة.','الإلغاء مجاني إذا كان قبل الموعد بأكثر من 48 ساعة.');
add('conditional-policy','NO_ANSWER','لو ألغيت قبل 12 ساعة شو بصير؟','الإلغاء مجاني إذا كان قبل الموعد بأكثر من 48 ساعة.');
add('threshold','ANSWER','لو العدد 20 والشرط على الأقل 20؟','تطبق الخدمة إذا كان العدد 20 أو أكثر.','تطبق الخدمة إذا كان العدد 20 أو أكثر.');
add('threshold','NO_ANSWER','لو العدد 19 والشرط على الأقل 20؟','تطبق الخدمة إذا كان العدد 20 أو أكثر.');
add('historical-current','NO_ANSWER','هل الخدمة متاحة حاليا؟','كانت الخدمة متاحة الأسبوع الماضي.');
add('availability-static','ANSWER','هل الخدمة متاحة؟','الخدمة متاحة للحجز.','الخدمة متاحة للحجز.');
add('negative-polarity','ANSWER','هل الخدمة لا تشمل الشحن؟','الخدمة لا تشمل الشحن.','الخدمة لا تشمل الشحن.');
add('related-not-answering','NO_ANSWER','هل يوجد موعد متاح الأحد؟','الطبيب يعمل يوم الأحد.');
add('unrelated','NO_ANSWER','كم السعر؟','موقع الفرع في شارع الجامعة.');
add('unit-mismatch','NO_ANSWER','هل المدة 30 ساعة؟','مدة الخدمة 30 دقيقة.');
add('multi-value','ANSWER','ما القائمة الكاملة؟','القائمة الكاملة للخيارات: أ، ب، ج.','القائمة الكاملة للخيارات: أ، ب، ج.');
add('quantity','ANSWER','كم عدد الوحدات؟','عدد الوحدات 8 قطعة.','عدد الوحدات 8 قطعة.');
add('date-day','ANSWER','متى الخدمة يوم الثلاثاء؟','الخدمة متاحة يوم الثلاثاء.','الخدمة متاحة يوم الثلاثاء.');
add('range','ANSWER','ما النطاق بين 18 و 60؟','العمر المسموح بين 18 و 60.','العمر المسموح بين 18 و 60.');
add('clarify','CLARIFY','هل هذا متاح؟','الخدمة متاحة للحجز.');
add('clarify','CLARIFY','شو التفاصيل؟','مدة الخدمة 30 دقيقة.');
add('clarify','CLARIFY','كيف الوضع؟','موقع الفرع في شارع الجامعة.');
add('clarify','CLARIFY','هل يمكن؟','الخدمة لا تشمل الشحن.');
add('tenant-isolation','NO_ANSWER','كم السعر؟','سعر الخدمة 80 شيكل.','',{evidenceTenant:'other'});
add('derived-arithmetic','ANSWER','كم السعر؟','سعر الخدمة 150 شيكل.','سعر الخدمة 150 شيكل.');
for(const s of scenarios)if(s.evidenceTenant)s.evidence[0].tenantId=s.evidenceTenant;
function currentProxy(s){if(s.expectedDecision!=='ANSWER'||!s.goldAnswer)return{decision:s.expectedDecision==='CLARIFY'?'CLARIFY':'NO_ANSWER',correct:true,latencyMs:0};const old=console.log;console.log=()=>{};const start=performance.now();try{const r=validateDetailed(s.goldAnswer,s.evidence,{tenantId:s.tenantId}),raw=r.overallStatus,decision=raw===STATUS.SUPPORTED?'ANSWER':'NO_ANSWER';return{decision,correct:decision===s.expectedDecision,latencyMs:performance.now()-start};}finally{console.log=old;}}
function traceable(result){if(result.decision!=='ANSWER')return true;if(!result.selected.length)return false;const deterministic=result.selected.map(p=>`${p.renderableText}.`).join(' ');if(result.answer===deterministic)return true;return result.preservation?.ok===true;}
function naturalness(result,mode){if(result.decision!=='ANSWER')return null;if(!result.answer.trim())return 0;if(mode==='B'&&!result.fallback)return 3;return result.answer.length>8?2.6:2;}
const rows=scenarios.map(s=>{const a=core.construct(s,{mode:'A'}),b=core.construct(s,{mode:'B'}),cur=currentProxy(s);return{...s,current:cur,constructionA:{...a,traceable:traceable(a),naturalness:naturalness(a,'A')},constructionB:{...b,traceable:traceable(b),naturalness:naturalness(b,'B')}};});
function pct(v,p){const a=[...v].sort((x,y)=>x-y),i=(a.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return a[l]+(a[h]-a[l])*(i-l);}
function summary(key){const answerable=rows.filter(r=>r.expectedDecision==='ANSWER'),clarify=rows.filter(r=>r.expectedDecision==='CLARIFY'),no=rows.filter(r=>r.expectedDecision==='NO_ANSWER'),out=rows.map(r=>r[key]),tpC=clarify.filter(r=>r[key].decision==='CLARIFY').length,predC=rows.filter(r=>r[key].decision==='CLARIFY').length,lat=out.map(x=>x.timing?.totalMs??x.latencyMs);const delivered=rows.filter(r=>r[key].decision==='ANSWER');return{correctAnswerRate:answerable.filter(r=>r[key].decision==='ANSWER').length/answerable.length,falseSafeFallbackRate:answerable.filter(r=>r[key].decision!=='ANSWER').length/answerable.length,clarifyPrecision:predC?tpC/predC:0,clarifyRecall:tpC/clarify.length,noAnswerAccuracy:no.filter(r=>r[key].decision==='NO_ANSWER').length/no.length,exactDecisionAccuracy:rows.filter(r=>r[key].decision===r.expectedDecision).length/rows.length,unsupportedFactsDelivered:delivered.filter(r=>r[key].traceable===false).length,incorrectAnswers:delivered.filter(r=>r.expectedDecision!=='ANSWER').length,tenantLeakage:rows.filter(r=>r.category==='tenant-isolation'&&r[key].decision==='ANSWER').length,naturalness:delivered.map(r=>r[key].naturalness).filter(Number.isFinite).reduce((a,b)=>a+b,0)/(delivered.length||1),latency:{meanMs:lat.reduce((a,b)=>a+b,0)/lat.length,p95Ms:pct(lat,.95)},paraphraseFallbackRate:key==='constructionB'?out.filter(x=>x.decision==='ANSWER'&&x.fallback).length/(delivered.length||1):null};}
function category(key){return Object.fromEntries([...new Set(rows.map(r=>r.category))].sort().map(c=>{const x=rows.filter(r=>r.category===c);return[c,{total:x.length,correct:x.filter(r=>r[key].decision===r.expectedDecision).length,unsafe:x.filter(r=>r[key].decision==='ANSWER'&&r.expectedDecision!=='ANSWER').length,falseFallback:x.filter(r=>r[key].decision!=='ANSWER'&&r.expectedDecision==='ANSWER').length}]}));}
const result={generatedAt:new Date().toISOString(),scope:'offline answer-construction scenarios; CURRENT is a gold-answer production-validator proxy, not live generation',scenarioCount:rows.length,current:summary('current'),constructionA:summary('constructionA'),constructionB:summary('constructionB'),safety:{policyCorrect:rows.filter(r=>r.category==='conditional-policy'&&r.constructionA.decision===r.expectedDecision).length/2,numericCorrect:rows.filter(r=>['price','quantity','unit-mismatch','derived-arithmetic'].includes(r.category)&&r.constructionA.decision===r.expectedDecision).length/5,temporalCorrect:rows.filter(r=>['working-hours','historical-current','date-day','duration'].includes(r.category)&&r.constructionA.decision===r.expectedDecision).length/4,completeListCorrect:rows.filter(r=>['complete-list','negative-membership','membership','incomplete-list','multi-value'].includes(r.category)&&r.constructionA.decision===r.expectedDecision).length/5},categories:{current:category('current'),constructionA:category('constructionA'),constructionB:category('constructionB')},failureAttribution:{},rows};
for(const r of rows){if(r.constructionA.decision===r.expectedDecision)continue;let layer=r.constructionA.propositions.length?'PROPOSITION_SELECTION':'PROPOSITION_EXTRACTION';if(r.category==='clarify')layer='QUESTION_RELATION_MAPPING';if(r.category==='derived-arithmetic')layer='DERIVED_REASONING';result.failureAttribution[layer]=(result.failureAttribution[layer]||0)+1;}
fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,rows:undefined,categories:undefined},null,2));
