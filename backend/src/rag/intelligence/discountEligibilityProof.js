'use strict';
const {normalizeNumbers,productCodes,identityRows}=require('./numericIdentity');
const norm=t=>normalizeNumbers(t).normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[إأآٱ]/g,'ا').replace(/ة/g,'ه');
function proveDiscountEligibility(claim,question,chunks,tenantId){
 const codes=productCodes(question);if(codes.length!==1||!tenantId)return null;
 const c=norm(claim),code=codes[0];
 const negative=/غير مؤهل|لا.*مؤهل/u.test(c);
 if(!/خصم/u.test(c)||/بطاري|تركيب|مجاني/u.test(c)||(!negative&&/بعد الخصم|السعر بعد/u.test(c)))return null;
 if(productCodes(c).some(v=>v!==code))return null;
 // A closed grammatical vocabulary prevents an eligibility proof from also
 // approving unrelated promises, conditions or product attributes.
 let residue=c;for(const id of productCodes(c))residue=residue.replace(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),' ');
 residue=residue.replace(/\d+(?:\.\d+)?/g,' ').replace(/[\s%≥≤><=().،,—-]/g,' ');
 const words=new Set('اه نعم لا عليها عليه باقه الباقه سعرها مؤهل مؤهله غير لخصم للخصم خصم الخصم بنسبه على سعر سعره السعر الاساسيه الاساسي لان لانه لانها بسعر شيكل شيقل ILS USD دولار او اكثر اقل من بعد هو هي وهي وهو وما ما'.split(' '));
 if(residue.trim().split(/\s+/).some(w=>!words.has(w)))return null;
 const trusted=chunks.filter(x=>String(x.tenantId)===String(tenantId)&&x.id);
 const eligibility=trusted.flatMap(x=>x.text.split(/[\n؛]+/u).map(text=>({text,id:x.id})))
  .filter(x=>productCodes(x.text).includes(code)&&/مؤهل/u.test(norm(x.text)));
 if(!eligibility.length||eligibility.some(x=>/غير مؤهل/u.test(norm(x.text))!==negative))return null;
 const rules=trusted.filter(x=>eligibility.some(e=>e.id===x.id)).flatMap(x=>x.text.split(/\n+/u).map(text=>({text: norm(text),id:x.id})))
  .filter(x=>/خصم/u.test(x.text)&&/\d+\s*%/u.test(x.text)&&!/لا يطبق|لا يشمل/u.test(x.text));
 if(rules.length!==1)return null;
 const rule=rules[0],rate=Number(rule.text.match(/(\d+(?:\.\d+)?)\s*%/u)[1]);
 const rates=[...c.matchAll(/(\d+(?:\.\d+)?)\s*%/gu)];
 if((!rates.length&&!negative)||rates.some(m=>Number(m[1])!==rate))return null;
 const monetary=/(\d+(?:\.\d+)?)\s*(شيكل|شيقل|ILS|USD|دولار)/giu;
 const bases=trusted.flatMap(x=>identityRows(x.text,[code]).filter(t=>/سعر|ثمن/u.test(t)).flatMap(t=>[...norm(t).matchAll(monetary)].map(m=>({value:Number(m[1]),unit:/USD|دولار/i.test(m[2])?'USD':'ILS',id:x.id}))));
 const threshold=rule.text.match(/(\d+(?:\.\d+)?)\s*(شيكل|شيقل|ILS|USD|دولار)\s+او اكثر/u);
 const claimMoney=[...c.matchAll(monetary)];
 let bare=c.replace(monetary,' ').replace(/\d+(?:\.\d+)?\s*%/gu,' ');
 for(const id of productCodes(c))bare=bare.replace(new RegExp(id,'gi'),' ');
 const comparisons=[...bare.matchAll(/(≥|>=|<|اقل من)\s*(\d+(?:\.\d+)?)/gu)];
 if(/\d/u.test(bare.replace(/(≥|>=|<|اقل من)\s*\d+(?:\.\d+)?/gu,'')))return null;
 if(claimMoney.length||comparisons.length){
  if(bases.length!==1||!threshold)return null;
  const b=bases[0],t=Number(threshold[1]),unit=/USD|دولار/i.test(threshold[2])?'USD':'ILS';
  if(b.unit!==unit||negative!==(b.value<t))return null;
  if(claimMoney.some(m=>Number(m[1])!==b.value||(/USD|دولار/i.test(m[2])?'USD':'ILS')!==b.unit))return null;
  if(comparisons.some(m=>Number(m[2])!==t||negative!==(/<|اقل/.test(m[1]))))return null;
 }
 return {operation:'DISCOUNT_ELIGIBILITY',evidenceText:eligibility.map(x=>x.text).join('\n'),evidenceIds:[...new Set([...eligibility.map(x=>x.id),rule.id,...(claimMoney.length?bases.map(x=>x.id):[])])],
  inputs:[{semanticRole:'DISCOUNT',value:rate,unit:'PERCENT',evidenceId:rule.id},...bases.map(b=>({...b,semanticRole:'BASE_VALUE',evidenceId:b.id})),...(threshold?[{semanticRole:'ELIGIBILITY_MINIMUM',value:Number(threshold[1]),unit:/USD|دولار/i.test(threshold[2])?'USD':'ILS',operator:'>=',evidenceId:rule.id}]:[])],eligible:!negative};
}
module.exports={proveDiscountEligibility};
