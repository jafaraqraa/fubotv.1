'use strict';
const { normalizeArabic } = require('../processing/arabicNormalizer');
const { tableRows } = require('../processing/tableStructure');
const { productCodes, identityRows } = require('./numericIdentity');
const norm = value => normalizeArabic(String(value || '')).toLowerCase();
const fields = {
 daily: /(?:^|[^\p{L}])(?:اليومي|يوميا|يومي|لليوم|باليوم|daily|per day)(?=$|[^\p{L}])/u,
 weekly: /اسبوع|weekly|per week/u,
 deposit: /تامين|deposit/u,
 credit: /اجل|ائتمان|credit/u,
 minimum: /حد ادني|الحد الادني|اقل مده|minimum/u,
 age: /عمر|سن |عاما|سنه|age/u,
 late: /تاخير|تاخر|متاخر|late|overdue/u,
 cancellation: /الغاء|الغيت|تلغي|cancel/u,
 inclusion: /يشمل|تشمل|شامل|شمول|includ|exclud/u
};
function requestedFields(query) {
 const q = norm(query);
 const result = Object.keys(fields).filter(key => fields[key].test(q));
 if (/ليوم واحد|يوم واحد/u.test(q) && !result.includes('minimum')) result.push('minimum');
 return result;
}
const fillers = new Set(['قديش','كم','شو','يعني','بقدر','انا','عليها','عليه','لليوم','بالاسبوع','والاسبوع','سعر','ايجار','تامين','price','cost','how','much','the']);
function contentTokens(query) {
 return norm(query).split(/[^\p{L}\p{N}]+/u).map(t => t.replace(/^(?:وال|بال|ال)(?=\p{L}{3})/u, ''))
 .filter(t => t.length > 2 && !fillers.has(t));
}
function coverage(query, text) {
 const wanted = requestedFields(query);
 const lines = tableRows(text).split(/[\n؛.!؟]+/u).map(norm);
 const amount = asksAmount(query);
 return wanted.filter(key => lines.some(line => {
  if (!fields[key].test(line)) return false;
  if (!amount || !['deposit','daily','weekly'].includes(key)) return true;
  // Never use an exclusion statement as an amount, or a number from another column.
  return line.split('|').some(cell => fields[key].test(cell) && /[0-9٠-٩]/u.test(cell)
   && !/لا يشمل|غير شامل|مستثن|exclud/iu.test(cell));
 }));
}
function relevance(query, chunk) {
 const text = chunk.text || chunk.payload?.text || '';
 const tokens = new Set(contentTokens(text));
 const overlap = contentTokens(query).filter(token => tokens.has(token)).length;
 const covered = coverage(query, text);
 const codes = productCodes(query);
 const explicitCodes = productCodes(text);
 const generalInclusion = requestedFields(query).includes('inclusion') && covered.includes('inclusion') && !explicitCodes.length;
 const entityMatch = !codes.length || codes.every(code => explicitCodes.includes(code)) || generalInclusion;
 const priceRows=identityRows(tableRows(text),codes);
 const priceMatch=codes.length && (asksAmount(query) || /احسب|calculate/u.test(norm(query)))
  && priceRows.some(row=>/سعر|ثمن|price|cost/iu.test(row) && /[0-9][,0-9]*\s*(?:شيكل|شيقل|ILS|USD|دولار)/iu.test(row));
 const rateMatch=/خصم|discount/iu.test(query) && String(text).split(/\n+/u).some(line=>
  /خصم|discount/iu.test(line) && /\d+\s*%/u.test(line) && !/لا يطبق|لا يشمل|غير مؤهل/u.test(norm(line)));
 const completeOffices=/مكتب|مكاتب|فروع|offices|branches/iu.test(query)
  && /قائمه.*(?:مكاتب|فروع).*كامله|complete.*(?:offices|branches)/iu.test(norm(text));
 const exclusionMatch=/خصم/u.test(query) && /بطاري/u.test(query) && /الخصم.*لا يطبق.*بطاري/u.test(text);
 const historicalMatch=/كان|سابق|historical/iu.test(query) && /مكتب|فرع/u.test(query) && /تاريخي|كان مكتب|كان فرع/u.test(text);
 return { covered, overlap, entityMatch, priority: entityMatch ? covered.length * 2 + Math.min(overlap, 3) + (priceMatch ? 6 : 0) + (rateMatch ? 5 : 0) + (completeOffices ? 6 : 0) + (exclusionMatch ? 9 : 0) + (historicalMatch ? 8 : 0) : -10 };
}
function prioritize(query, chunks) {
 return chunks.map((chunk, index) => ({ chunk, index, ...relevance(query, chunk) }))
 .sort((a,b) => b.priority - a.priority || a.index - b.index).map(item => item.chunk);
}
function missingAmountEvidence(query, chunks) {
 const q = norm(query);
 if (!asksAmount(q)) return false;
 const wanted = requestedFields(query).filter(key => ['deposit','daily','weekly'].includes(key));
 return wanted.some(key => !chunks.some(chunk => relevance(query,chunk).entityMatch && coverage(query,chunk.text || chunk.payload?.text || '').includes(key)));
}
function asksAmount(query) {
 const q = norm(query);
 // A short deposit/weekly follow-up requests the value, not a true but
 // non-responsive exclusion statement. Explicit inclusion questions stay distinct.
 if (/يشمل|شامل|شمول|includ/iu.test(q)) return false;
 return /(?:^|[^\p{L}])(?:قديش|كم)(?=$|[^\p{L}])|how much|amount/iu.test(q)
  || /^(?:و|طيب).*(?:تامين|اسبوع)/u.test(q);
}
module.exports = { requestedFields, contentTokens, coverage, relevance, prioritize, missingAmountEvidence, asksAmount };
