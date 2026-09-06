'use strict';
const { normalizeArabic } = require('../processing/arabicNormalizer');
const { productCodes } = require('./numericIdentity');
const norm = text => normalizeArabic(String(text || '')).toLowerCase();
const excluded = /اسبوع|تامين|ايجار|سعر|مبلغ|يوم|مده|وقت|حساب|خصم|تفاصيل|طلب|شروط|دوام|عنوان/u;
function entities(text) {
 const codes = productCodes(text);
 if (codes.length) return [...new Set(codes.map(code => code.toUpperCase()))];
 const phrases = String(text || '').match(/(?:^|\s)(ال[\p{Script=Arabic}]{3,}(?:\s+ال[\p{Script=Arabic}]{3,})?)/gu) || [];
 return [...new Set(phrases.map(value => value.trim()).filter(value => !excluded.test(norm(value))))];
}
function resolveReferent(query, history = []) {
 const q = norm(query);
 if (/^(?:طيب|و).*(?:هسا|الان|حاليا|عالواحده|عالثلثه|عالثلاثه)/u.test(q) && q.split(' ').length<=10) {
  const prior=[...history].reverse().filter(m=>m?.role==='user').map(m=>String(m.content||'').match(/(?:مكتب|فرع)\s+(.+?)\s+(?:بفتح|بيفتح|يفتح|يسكر|بسكر|يغلق|السبت|الأحد|الاحد|الجمعة|الجمعه)/u)).find(Boolean);
  if(prior){
   const day=prior.input.match(/السبت|الأحد|الاحد|الاثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|الجمعه/u)?.[0] || '';
   return {status:'RESOLVED',query:`ساعات عمل مكتب ${prior[1]} ${day}: ${query}`,entity:prior[1],source:'USER_HISTORY_LOCATION'};
  }
 }
 // Resolve elliptical quantities by their topic, never by copying business
 // values or assistant answers. Current user quantities remain untouched.
 const topics=[['تنظيف وفحص',/تنظيف|تنضيف|clean/iu,/لوح|الواح|panel/iu],
  ['إلغاء الحجز',/الغاء|الغيت|الغي|cancel/iu,/قبل|يوم|ايام|day/iu]];
 if (/^(?:طيب|قبل|ولو|واذا|وإذا)/u.test(q) && q.split(' ').length<=12) {
  for(const [topic,explicit,variable] of topics) {
   if (!explicit.test(q) && variable.test(q)) {
    const prior=[...history].reverse().find(m=>m?.role==='user' && explicit.test(norm(m.content)));
    if(prior)return {status:'RESOLVED',query:`${topic}: ${query}`,entity:topic,source:'USER_HISTORY_TOPIC'};
    return {status:'UNRESOLVED',query,entity:null,source:'MISSING_USER_HISTORY_TOPIC'};
   }
  }
 }
 const followup = q.split(' ').length <= 8 && /عليها|عليه|سعرها|سعره|تبعها|تبعه|^(?:و|طيب).*(?:اسبوع|تامين|سعر|مده)|^والاسبوع$/u.test(q);
 if (!followup || entities(query).length) return { status: 'NOT_REQUIRED', query, entity: null };
 const candidates = [...new Set(history.filter(message => message?.role === 'user')
  .filter(message => norm(message.content) !== q)
  .flatMap(message => entities(message.content)))];
 if (candidates.length !== 1) return { status: candidates.length ? 'AMBIGUOUS' : 'UNRESOLVED', query, entity: null };
 // Keep the referent in the same clause; punctuation otherwise splits it off
 // before intent-aware retrieval and leaves an entity-free follow-up.
 return { status: 'RESOLVED', query: `${String(query).replace(/[؟?]+\s*$/u, '')} ${candidates[0]}؟`, entity: candidates[0] };
}
module.exports = { resolveReferent, entities };
