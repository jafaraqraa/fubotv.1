const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { generateEmbeddings } = require('../src/rag/embeddings/ollamaEmbeddingProvider');
const { decideEvidence, DECISION } = require('../src/rag/intelligence/evidenceDecisionGate');

const datasetPath = process.argv[2] || path.join(__dirname, '../evals/semantic-alignment/dev-pairs-ar.json');
const outputPath = process.env.SEMANTIC_ALIGNMENT_OUTPUT || path.join(__dirname, '../evals/semantic-alignment/results.json');
const pairs = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

function normalize(text) { return String(text).normalize('NFKC').toLowerCase().replace(/[إأآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[^\p{L}\p{N}%]+/gu,' ').trim(); }
function content(text) { const stop=new Set(['هل','شو','كم','قديش','متي','امتي','وين','كيف','في','من','علي','عن','بدي','بقدر','يتم','تتم']); return normalize(text).split(/\s+/).filter(x=>x.length>2&&!stop.has(x)); }
function lexical(a,b) { const x=content(a), y=new Set(content(b)); return x.length?x.filter(t=>y.has(t)).length/x.length:0; }
function cosine(a,b) { let dot=0,aa=0,bb=0; for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];} return dot/(Math.sqrt(aa)*Math.sqrt(bb)||1); }
function nums(s){return normalize(s).match(/\d+(?:[.,]\d+)?/g)||[];}
function neg(s){return /(?:^|\s)(?:لا|ليس|مش|غير|دون|بدون)(?:\s|$)/.test(normalize(s));}
function current(s){return /(?:اليوم|حاليا|الان|هسا|الحالي)/.test(normalize(s));}
function hybridCompatible(pair){const qn=nums(pair.question),en=nums(pair.evidence);if(qn.length&&en.length&&!qn.every(n=>en.includes(n)))return false;if(current(pair.question)&&!current(pair.evidence))return false;if(neg(pair.question)&&!neg(pair.evidence))return false;return true;}
function percentile(values,p){const a=[...values].sort((x,y)=>x-y);const i=(a.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return a[l]+(a[h]-a[l])*(i-l);}
function distribution(rows,label){const v=rows.filter(r=>r.label===label).map(r=>r.semanticScore);return {count:v.length,mean:v.reduce((a,b)=>a+b,0)/v.length,median:percentile(v,.5),p10:percentile(v,.1),p90:percentile(v,.9),min:Math.min(...v),max:Math.max(...v)};}
function assess(rows,score,threshold){let tp=0,tn=0,fp=0,fn=0;for(const r of rows){const positive=r.label==='POSITIVE';const predicted=score(r)>=threshold;if(positive&&predicted)tp++;else if(positive)fn++;else if(predicted)fp++;else tn++;}return {threshold,tp,tn,fp,fn,accuracy:(tp+tn)/rows.length,falseAnswerRate:fp/(fp+tn),falseNoAnswerRate:fn/(fn+tp)};}
function bestThreshold(rows,score){let best=null;for(let t=.1;t<=.95;t+=.01){const m=assess(rows,score,Number(t.toFixed(2)));const balanced=(m.tp/(m.tp+m.fn)+m.tn/(m.tn+m.fp))/2;if(!best||balanced>best.balancedAccuracy)best={...m,balancedAccuracy:balanced};}return best;}

(async()=>{
 const unique=[...new Set(pairs.flatMap(p=>[p.question,p.evidence]))];
 const started=performance.now(); const vectors=await generateEmbeddings(unique); const elapsed=performance.now()-started;
 const map=new Map(unique.map((text,i)=>[text,vectors[i]]));
 const rows=pairs.map(pair=>{
   const semanticScore=cosine(map.get(pair.question),map.get(pair.evidence));
   const gate=decideEvidence({query:pair.question,chunks:[{tenantId:'semantic-dev',text:pair.evidence}],tenantId:'semantic-dev'}).decision;
   return {...pair,semanticScore,lexicalScore:lexical(pair.question,pair.evidence),hybridCompatible:hybridCompatible(pair),baselineAuthorized:gate===DECISION.ANSWER};
 });
 const semantic=bestThreshold(rows,r=>r.semanticScore), lexicalMethod=bestThreshold(rows,r=>r.lexicalScore);
 const hybrid=bestThreshold(rows,r=>r.hybridCompatible?r.semanticScore:0);
 const baseline=assess(rows,r=>r.baselineAuthorized?1:0,.5);
 const unseen=rows.filter(r=>r.unseen); const unseenResult=assess(unseen,r=>r.hybridCompatible&&r.semanticScore>=hybrid.threshold?1:0,.5);
 const arabicRobustnessIds=new Set(['p01','p02','p03','p06','p08','p10','p14','p15','p16','p17']);
 const arabicRobustness=rows.filter(r=>arabicRobustnessIds.has(r.id));
 const arabicRobustnessResult=assess(arabicRobustness,
   r=>r.hybridCompatible&&r.semanticScore>=hybrid.threshold?1:0,.5);
 const pos=rows.filter(r=>r.label==='POSITIVE').map(r=>r.semanticScore), negRows=rows.filter(r=>r.label!=='POSITIVE').map(r=>r.semanticScore);
 const report={model:process.env.RAG_EMBEDDING_MODEL||'nomic-embed-text',infrastructure:'existing Ollama embedding provider',dataset:{total:rows.length,positive:rows.filter(r=>r.label==='POSITIVE').length,negative:rows.filter(r=>r.label==='NEGATIVE').length,hardNegative:rows.filter(r=>r.label==='HARD_NEGATIVE').length,unseen:unseen.length},distributions:{positive:distribution(rows,'POSITIVE'),negative:distribution(rows,'NEGATIVE'),hardNegative:distribution(rows,'HARD_NEGATIVE')},overlap:{positiveP10:percentile(pos,.1),unsupportedP90:percentile(negRows,.9),margin:percentile(pos,.1)-percentile(negRows,.9)},methods:{baseline,lexical:lexicalMethod,semantic,hybrid},arabicRobustness:arabicRobustnessResult,unseen:unseenResult,latency:{totalMs:Number(elapsed.toFixed(1)),uniqueTexts:unique.length,meanPerTextMs:Number((elapsed/unique.length).toFixed(2))},rows};
 fs.writeFileSync(outputPath,JSON.stringify(report,null,2)); console.log(JSON.stringify({...report,rows:undefined},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
