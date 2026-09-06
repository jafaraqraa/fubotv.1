'use strict';

function normalizeNumbers(value) {
 return String(value || '').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/٫/g,'.').replace(/\d{1,3}(?:[,٬]\d{3})+(?!\d)/g,n=>n.replace(/[,٬]/g,''));
}
function productCodes(value) {
 // Preserve suffixes and spaces in catalog identifiers; don't interpret bare
 // electrical units as a product. Identity comparisons use canonical spacing.
 // A separated bare number is ordinary prose ("opens at 8", "costs 15"),
 // not a catalog identity.  Separated identifiers therefore require a unit/
 // model suffix (Home 5K); compact and hyphenated identifiers remain valid.
 return [...new Set((String(value || '').match(/\b(?:[A-Za-z]{1,24}[-_]?\d{1,8}[A-Za-z]{0,8}|[A-Za-z]{1,24}\s+\d{1,8}[A-Za-z]{1,8})\b/g)||[])
  .map(code=>code.replace(/\s+/g,' ').toUpperCase()))];
}
function identityRows(text, codes) {
 const rows=String(text || '').split(/\n+|(?<=[.!?؟])\s+/u).filter(Boolean),matches=[];
 for(let i=0;i<rows.length;i++)if(codes.every(code=>productCodes(rows[i]).includes(code))){
  matches.push(rows[i]);
  // Markdown/catalog headings bind following attribute lines until the next
  // distinct product heading. This preserves name/value identity without
  // borrowing a price from a sibling product.
  if(!/\b(?:سعر|ثمن|تكلف|price|cost)\b/iu.test(rows[i])){
   const block=[rows[i]];
   for(let j=i+1;j<rows.length&&j<=i+8;j++){
    const other=productCodes(rows[j]);if(other.length&&!codes.every(code=>other.includes(code)))break;
    block.push(rows[j]);
   }
   if(block.length>1)matches.push(block.join('\n'));
  }
 }
 return [...new Set(matches)];
}
function contradictoryComparison(claim) {
 const text=normalizeNumbers(claim).normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[إأآٱ]/g,'ا');
 // Explicit anaphoric comparison binds the preceding value, not an arbitrary
 // number elsewhere in the source ("200 ... وهي 250 أو أكثر").
 const pattern=/(\d+(?:\.\d+)?)\s*(?:شيكل|شيقل|ILS|USD|دولار)?\s*(?:وهي|وهو|وذلك|which is|is)\s*(?:(أقل|اقل|اكثر|اكبر)\s+من\s*)?(\d+(?:\.\d+)?)\s*(?:شيكل|شيقل|ILS|USD|دولار)?\s*(او اكثر|او اقل|or more|or less)?/giu;
 for(const m of text.matchAll(pattern)) {
  const a=Number(m[1]),b=Number(m[3]);
  const valid=m[2] ? (/اقل/.test(m[2]) ? a<b : a>b) : m[4] ? (/اكثر|more/i.test(m[4])?a>=b:a<=b) : a===b;
  if(!valid)return true;
 }
 return false;
}
function conditionalLaborVeto(claim,question,chunks) {
 const norm=t=>normalizeNumbers(t).normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[إأآٱ]/g,'ا').replace(/ة/g,'ه');
 const c=norm(claim),q=norm(question);
 if (!/خصم|تخصم|تنخصم/u.test(c) || !/كشف|زياره/u.test(`${c} ${q}`)
  || /(?:لا|ما|مش|لن)\s+(?:ب?ت[ن]?خصم|يخصم|خصم)/u.test(c)) return null;
 const rules=chunks.flatMap(chunk=>String(chunk.text||'').split(/\n+/u)).map(norm)
  .filter(line=>/اجره|اجور|تكلفه العمل/u.test(line) && /خصم/u.test(line));
 for(const rule of rules) {
  const threshold=rule.match(/(?:اجره|اجور|تكلفه العمل)\s+(?:الاصلاح|العمل|التصليح)?\s*(\d+)\s*(?:شيكل|شيقل)?\s+او اكثر/u);
  if(!threshold)continue;
  const amount=q.match(/(?:اجره|اجور|تكلفه العمل)\s*(?:الاصلاح|العمل|التصليح)?\s*(\d+)/u)
   || q.match(/(\d+)\s*(?:شيكل|شيقل)?\s*(?:اجره|اجور|تكلفه العمل)/u);
  if(amount && Number(amount[1])<Number(threshold[1]))return 'LABOR_BELOW_THRESHOLD';
  if(/نفس الزياره/u.test(rule) && !/نفس الزياره/u.test(`${c} ${q}`))return 'MISSING_SAME_VISIT_CONDITION';
 }
 return null;
}
function laborAssessment(question,chunks) {
 const normalized=t=>normalizeNumbers(t).normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[إأآٱ]/g,'ا').replace(/ة/g,'ه');
 const q=normalized(question);
 if(!/كشف/u.test(q))return null;
 const amount=q.match(/(?:اجره|اجور)\s*(?:الاصلاح|العمل|التصليح)?\s*(\d+)/u)||q.match(/(\d+)\s*(?:شيكل|شيقل)?\s*(?:اجره|اجور)/u);
 if(!amount)return null;
 const rules=chunks.flatMap(chunk=>String(chunk.text||'').split(/\n+/u).map(text=>({text,id:chunk.chunkId||chunk.id})))
  .map(rule=>({...rule,match:normalized(rule.text).match(/اجره\s+(?:الاصلاح|العمل|التصليح)\s*(\d+)\s*(?:شيكل|شيقل)?\s+او اكثر/u)}))
  .filter(rule=>rule.match && /خصم/u.test(rule.text) && rule.id);
 if(new Set(rules.map(r=>r.match[1])).size!==1)return null;
 const rule=rules[0],value=Number(amount[1]),threshold=Number(rule.match[1]);
 return {role:'LABOR_ONLY',value,threshold,operator:'>=',satisfied:value>=threshold,evidenceId:rule.id,rule:rule.text};
}
module.exports={normalizeNumbers,productCodes,identityRows,contradictoryComparison,conditionalLaborVeto,laborAssessment};
