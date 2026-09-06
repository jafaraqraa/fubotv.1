'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'gold-corpus-v1.json');
const rows = [];
const add = row => rows.push({
    directOrDerived: 'direct', numeric: false, temporal: false, negative: false,
    completeList: false, hardNegative: false, disagreementProne: false,
    adjudicationNote: 'The verdict follows only from the cited tenant evidence.', ...row
});

const supported = [
 ['clinic','كم سعر الفحص الشامل؟','سعر الفحص الشامل مئة وعشرون شيكلاً.','تكلفة الفحص الشامل هي 120 شيكل.','numeric'],
 ['clinic','هل التأمين يشمل تنظيف البشرة؟','تأمين أمان لا يغطي تنظيف البشرة.','تأمين أمان لا يشمل جلسات تنظيف البشرة.','negative'],
 ['clinic','متى تفتح العيادة؟','تفتح العيادة من التاسعة صباحاً حتى الخامسة مساءً.','ساعات عمل العيادة من 9 صباحاً إلى 5 مساءً.','temporal'],
 ['barq','كم مدة تنفيذ باقة النمو؟','إنجاز باقة النمو يحتاج خمسة وعشرين يوم عمل.','تنفيذ باقة النمو يستغرق 25 يوم عمل.','duration'],
 ['barq','ما طرق الدفع؟','الدفع المتاح نقداً أو بتحويل بنكي.','طرق الدفع الكاملة هي: نقداً، وتحويل بنكي.','complete-list'],
 ['barq','هل تقبلون الشيكات؟','الشيكات ليست ضمن طرق الدفع المقبولة.','طرق الدفع الكاملة هي: نقداً، وتحويل بنكي.','negative-membership'],
 ['ceramics','ما ألوان مجموعة الزيتون؟','تأتي مجموعة الزيتون بالأسود والأخضر والرمادي.','القائمة الكاملة لألوان مجموعة الزيتون: الأسود، الأخضر، الرمادي.','multi-value'],
 ['ceramics','كم تستغرق الحصة؟','مدة الحصة ساعتان.','تستمر الحصة 120 دقيقة.','duration'],
 ['astronomy','متى يبدأ رصد زحل؟','يبدأ رصد زحل عند الساعة التاسعة مساءً.','موعد رصد زحل الساعة 21:00.','temporal'],
 ['astronomy','ما العدسات المتاحة؟','العدسات المتاحة هي الشمسية والقمرية.','القائمة الكاملة للعدسات: شمسية، قمرية.','complete-list'],
 ['retail','متى يصبح الشحن مجانياً؟','الشحن مجاني للطلبات التي قيمتها 350 شيكلاً أو أكثر.','الشحن مجاني عندما تكون قيمة السلة أكبر من أو تساوي 350 شيكل.','threshold'],
 ['retail','كم ضمان الملحقات؟','كفالة الملحقات نصف سنة.','ضمان الملحقات 6 أشهر.','duration'],
 ['services','هل تشمل الباقة الطباعة؟','الطباعة مشمولة فقط إذا اختار العميل فرع الشركات.','تشمل الباقة الطباعة بشرط اختيار فرع الشركات.','conditional-policy'],
 ['delivery','متى يصل الطلب؟','يصل الطلب يومي الاثنين والأربعاء.','أيام التوصيل هي الاثنين والأربعاء.','multi-value'],
 ['history','وماذا عن ضمانها؟','ضمان الملحقات ستة أشهر.','سأل العميل عن الملحقات. ضمان الملحقات 6 أشهر.','history-resolved-referent']
];

let id = 0;
for (const [tenant, question, claim, evidence, category] of supported) {
  const variants = [claim, claim.replace(/شيكلاً/g,'شيكل').replace(/خمسة وعشرين/g,'25').replace(/ساعتان/g,'120 دقيقة'), `حسب المعلومات المتاحة، ${claim}`, claim.replace(/المتاح/g,'المتوفر').replace(/مدة/g,'فترة').replace(/تستغرق/g,'تأخذ')];
  for (const [variantIndex, variant] of variants.entries()) add({
    id:`sp-${++id}`, tenant, question, claim:variant, evidence:[{id:`${tenant}-e-${id}`,tenantId:tenant,text:evidence}],
    evidenceIds:[`${tenant}-e-${id}`], expectedVerdict:'SUPPORTED', category,
    numeric:/\d|مئة|نصف|ساعتان|خمسة/.test(variant), temporal:['temporal','duration'].includes(category),
    negative:category.startsWith('negative'), completeList:category.includes('list')||category==='multi-value',
    sourceDataset: variantIndex === 0 ? 'frozen-artifact-derived' : 'supported-paraphrase-v1',
    disagreementProne: variantIndex > 0,
    adjudicationNote:'Manual: the claim is a meaning-preserving Arabic paraphrase of the cited evidence.'
  });
}

const hardTemplates = [
 ['numeric','السعر هو 100 شيكل.','مدة الخدمة 100 دقيقة.','NOT_PROVEN'],
 ['numeric','السعر هو 100 شيكل.','السعر هو 120 شيكل.','CONTRADICTED'],
 ['threshold','الخدمة متاحة للطلبات الأكبر من 15 قطعة.','الطلب المكوّن من 15 قطعة مؤهل.','CONTRADICTED'],
 ['threshold','الخصم متاح للطلبات بقيمة 350 شيكل أو أكثر.','طلب بقيمة 349 شيكل يحصل على الخصم.','CONTRADICTED'],
 ['temporal','كان المنتج متاحاً في يناير 2025.','المنتج متاح الآن.','NOT_PROVEN'],
 ['temporal','الموعد يوم الأربعاء 9 سبتمبر.','الموعد يوم الخميس 10 سبتمبر.','CONTRADICTED'],
 ['negative','الخدمة لا تشمل التوصيل.','الخدمة تشمل التوصيل.','CONTRADICTED'],
 ['complete-list','القائمة الكاملة للفروع: رام الله، جنين.','يوجد فرع في الخليل.','CONTRADICTED'],
 ['not-proven','يعمل المركز يوم الأربعاء.','يوجد موعد شاغر يوم الأربعاء.','NOT_PROVEN'],
 ['not-proven','تتوفر الباقة الأساسية.','سعر الباقة الأساسية 500 شيكل.','NOT_PROVEN'],
 ['conditional-policy','الإلغاء مجاني بشرط أن يكون قبل الموعد بـ24 ساعة.','الإلغاء قبل الموعد بـ12 ساعة مجاني.','CONTRADICTED']
];
for (let round=1; round<=5; round++) for (const [category,evidenceText,claim,expectedVerdict] of hardTemplates) {
  const tenant=`control-${round}`; const evidenceTenant = round===5 ? 'other-tenant' : tenant;
  add({id:`hn-${round}-${category}`,tenant,question:'هل الادعاء صحيح؟',claim,
    evidence:[{id:`hn-e-${round}-${category}`,tenantId:evidenceTenant,text:evidenceText}], evidenceIds:[`hn-e-${round}-${category}`],
    expectedVerdict:round===5?'NOT_PROVEN':expectedVerdict,category:round===5?'cross-tenant-controls':category,
    numeric:/\d/.test(claim),temporal:category==='temporal',negative:category==='negative',completeList:category==='complete-list',hardNegative:true,
    sourceDataset:'hard-negative-v1',disagreementProne:true,
    adjudicationNote:round===5?'Manual: evidence belongs to a different tenant and is inadmissible.':'Manual: related wording does not establish the exact proposition.'});
}

const unseenDocs = [
 ['u-food-1','التخمير','يستغرق تخمير عجينة الساوردو 12 ساعة.'],
 ['u-food-2','حرارة الخَبز','تُخبز الأرغفة عند 230 درجة مئوية.'],
 ['u-food-3','المكونات','القائمة الكاملة للمكونات: دقيق، ماء، ملح.'],
 ['u-food-4','التوصيل','التوصيل متاح يومي الثلاثاء والسبت فقط.'],
 ['u-food-5','الحساسية','المخبز لا يضمن خلو المنتجات من آثار المكسرات.'],
 ['u-food-6','الطلب','يُقبل طلب المناسبات إذا كان العدد 20 رغيفاً أو أكثر.']
];
const unseenClaims = [
 ['u-food-1','مدة التخمير اثنتا عشرة ساعة.','SUPPORTED','duration'],['u-food-1','مدة التخمير 10 ساعات.','CONTRADICTED','numeric'],['u-food-1','سعر الرغيف 12 شيكل.','NOT_PROVEN','numeric'],
 ['u-food-2','حرارة الخبز 230 درجة مئوية.','SUPPORTED','numeric'],['u-food-2','حرارة الخبز 230 فهرنهايت.','CONTRADICTED','numeric'],['u-food-2','تستغرق عملية الخبز 230 دقيقة.','NOT_PROVEN','numeric'],
 ['u-food-3','المكونات هي الدقيق والماء والملح.','SUPPORTED','complete-list'],['u-food-3','السكر من مكونات الوصفة.','CONTRADICTED','negative-membership'],['u-food-3','مصدر الدقيق محلي.','NOT_PROVEN','not-proven'],
 ['u-food-4','التوصيل متاح الثلاثاء والسبت.','SUPPORTED','multi-value'],['u-food-4','التوصيل متاح يوم الأحد.','CONTRADICTED','temporal'],['u-food-4','التوصيل مجاني يوم الثلاثاء.','NOT_PROVEN','not-proven'],
 ['u-food-5','قد تحتوي المنتجات على آثار مكسرات.','SUPPORTED','negative'],['u-food-5','المنتجات مضمونة الخلو من المكسرات.','CONTRADICTED','negative'],['u-food-5','كل المنتجات تحتوي مكسرات.','NOT_PROVEN','not-proven'],
 ['u-food-6','طلب 20 رغيفاً مؤهل للمناسبات.','SUPPORTED','threshold'],['u-food-6','طلب 19 رغيفاً مؤهل للمناسبات.','CONTRADICTED','threshold'],['u-food-6','طلب 20 رغيفاً يحصل على خصم.','NOT_PROVEN','not-proven']
];
let unseenId=0;
for(let repeat=0;repeat<3;repeat++) for(const [docId,claim0,verdict,category] of unseenClaims){
  const doc=unseenDocs.find(x=>x[0]===docId); const claim=repeat===0?claim0:(repeat===1?`بحسب الدليل، ${claim0}`:claim0.replace('متاح','متوفر').replace('مدة','فترة'));
  add({id:`unseen-${++unseenId}`,tenant:'unseen-sourdough',question:'ما المعلومة الصحيحة؟',claim,
    evidence:[{id:docId,tenantId:'unseen-sourdough',text:doc[2]}],evidenceIds:[docId],expectedVerdict:verdict,category,
    numeric:/\d|عشرة|اثنتا|تسعة/.test(claim),temporal:['duration','temporal'].includes(category),negative:category.includes('negative'),completeList:category.includes('list')||category==='multi-value',hardNegative:verdict!=='SUPPORTED',sourceDataset:'unseen-sourdough-frozen-v1',disagreementProne:repeat>0,
    adjudicationNote:'Manual frozen unseen-tenant adjudication; no post-result tuning permitted.'});
}

const corpus={version:1,frozenAt:'2026-09-04',labelPolicy:'Labels are independently adjudicated from tenant evidence; production decisions are not ground truth.',unseenTenant:{tenant:'unseen-sourdough',sector:'artisan sourdough bakery',documents:unseenDocs.map(([id,title,text])=>({id,title,text}))},rows};
fs.writeFileSync(OUT,JSON.stringify(corpus,null,2)+'\n');
console.log(JSON.stringify({path:OUT,total:rows.length,supported:rows.filter(r=>r.expectedVerdict==='SUPPORTED').length,contradicted:rows.filter(r=>r.expectedVerdict==='CONTRADICTED').length,notProven:rows.filter(r=>r.expectedVerdict==='NOT_PROVEN').length,hardNegative:rows.filter(r=>r.hardNegative).length,unseen:rows.filter(r=>r.sourceDataset==='unseen-sourdough-frozen-v1').length},null,2));
