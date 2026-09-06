'use strict';

const { performance } = require('perf_hooks');
const { semanticSimilarity } = require('../../src/rag/intelligence/answerValidator');

const VERDICT = Object.freeze({SUPPORTED:'SUPPORTED',CONTRADICTED:'CONTRADICTED',NOT_PROVEN:'NOT_PROVEN'});
const STOP = new Set(['حسب','الدليل','المعلومات','المتاحه','هي','هو','من','في','علي','الى','او','و','فقط','كل','عند','اذا','كان','تكون','يوم','بحسب']);
const ALIASES = new Map(Object.entries({
  'تكلفه':'سعر','ثمن':'سعر','اجره':'سعر','كلفه':'سعر','شيكلا':'شيكل','شواكل':'شيكل',
  'مده':'فتره','يستغرق':'فتره','تستغرق':'فتره','تستمر':'فتره','يحتاج':'فتره','انجاز':'تنفيذ','تاخذ':'فتره',
  'كفاله':'ضمان','يغطي':'يشمل','مشموله':'يشمل','مضمون':'ضمان','تاتي':'الوان','الالوان':'الوان',
  'متاح':'توفر','متاحه':'توفر','متوفر':'توفر','متوفره':'توفر','يعمل':'عمل','تفتح':'عمل',
  'نقدا':'نقد','بنكي':'بنك','القائمه':'قائمه','المكونات':'مكون','مكونات':'مكون','الفروع':'فرع',
  'اثنتا':'12','عشره':'10','تسعه':'9','مئه':'100','وعشرون':'20','خمسه':'5','وعشرين':'20','ساعتان':'120','نصف':'6'
}));
function norm(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[إأآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[^\p{L}\p{N}<>=%]+/gu,' ').replace(/\s+/g,' ').trim();}
function tokens(value){return norm(value).split(' ').filter(Boolean).map(x=>x.startsWith('ال')&&x.length>4?x.slice(2):x).map(x=>ALIASES.get(x)||x).filter(x=>x.length>1&&!STOP.has(x));}
function numbers(value){const n=norm(value);const direct=n.match(/\d+(?:[.,]\d+)?/g)||[];const mapped=tokens(value).filter(x=>/^\d+$/.test(x));return [...new Set([...direct,...mapped])];}
function neg(value){return /(?:^|\s)(?:لا|ليس|ليست|غير|دون|بدون|مش|لن)(?:\s|$)/u.test(norm(value));}
function overlap(a,b){const x=[...new Set(tokens(a))],y=new Set(tokens(b));return x.length?x.filter(t=>y.has(t)).length/x.length:0;}
const relationGroups=[['سعر'],['فتره','دقيقه','ساعه','شهر'],['درجه','حراره'],['موعد','الساعة','صباحا','مساء'],['دفع','نقد','بنك','شيكات'],['توصيل','شحن'],['خصم'],['ضمان'],['مكون'],['فرع'],['لون','الوان'],['يشمل'],['عمل','يفتح']];
function relation(text){const set=new Set(tokens(text));return relationGroups.findIndex(g=>g.some(x=>set.has(x)));}
function hasCompleteList(text){return /(?:القائمه الكامله|هي\s*:)/u.test(norm(text));}
function comparator(text){const n=norm(text);if(/اكبر من او تساوي|او اكثر|>=/.test(n))return '>=';if(/اكبر من|>/.test(n))return '>';if(/اقل من او تساوي|او اقل|<=/.test(n))return '<=';if(/اقل من|</.test(n))return '<';return null;}
function temporalMismatch(claim,evidence){return /(?:الان|حاليا|اليوم)/u.test(norm(claim))&&!/(?:الان|حاليا|اليوم)/u.test(norm(evidence));}

function validate(input){
  const started=performance.now(); const admissible=(input.evidence||[]).filter(e=>String(e.tenantId||'')===String(input.tenantId||''));
  if(!admissible.length)return result(VERDICT.NOT_PROVEN,.99,[],'TENANT_EVIDENCE_MISMATCH',started);
  let best=null;
  for(const evidence of admissible){const text=evidence.text||'';const lex=overlap(input.claim,text);const sem=semanticSimilarity(input.claim,text);const score=.72*lex+.28*sem;if(!best||score>best.score)best={evidence,text,lex,sem,score};}
  const cn=numbers(input.claim),en=numbers(best.text),cr=relation(input.claim),er=relation(best.text);
  if(temporalMismatch(input.claim,best.text))return result(VERDICT.NOT_PROVEN,.97,[best.evidence.id],'TEMPORAL_SCOPE_MISSING',started);
  if(comparator(input.claim)&&comparator(best.text)&&comparator(input.claim)!==comparator(best.text))return result(VERDICT.CONTRADICTED,.99,[best.evidence.id],'COMPARATOR_CONFLICT',started);
  if(cn.length&&en.length&&!cn.every(n=>en.includes(n))){const verdict=cr>=0&&cr===er?VERDICT.CONTRADICTED:VERDICT.NOT_PROVEN;return result(verdict,.99,[best.evidence.id],verdict===VERDICT.CONTRADICTED?'EXACT_VALUE_CONFLICT':'VALUE_WITHOUT_RELATION',started);}
  if(neg(input.claim)!==neg(best.text)&&best.score>.28)return result(VERDICT.CONTRADICTED,.98,[best.evidence.id],'POLARITY_CONFLICT',started);
  if(hasCompleteList(best.text)&&best.score<.42)return result(VERDICT.CONTRADICTED,.97,[best.evidence.id],'COMPLETE_LIST_EXCLUDES_VALUE',started);
  if(cr>=0&&er>=0&&cr!==er)return result(VERDICT.NOT_PROVEN,.97,[best.evidence.id],'RELATION_NOT_ESTABLISHED',started);
  if(best.lex>=.58||best.score>=.57)return result(VERDICT.SUPPORTED,Math.min(.99,.55+best.score/2),[best.evidence.id],'SEMANTIC_AND_DETERMINISTIC_MATCH',started);
  return result(VERDICT.NOT_PROVEN,Math.max(.72,1-best.score),[best.evidence.id],'INSUFFICIENT_PROPOSITION_OVERLAP',started);
}
function result(verdict,confidence,evidenceIds,reasonCode,started){return {verdict,confidence:Number(confidence.toFixed(3)),evidenceIds,reasonCode,latencyMs:Number((performance.now()-started).toFixed(3))};}
module.exports={VERDICT,validate,_internals:{norm,tokens,numbers,neg,overlap,relation,comparator}};
