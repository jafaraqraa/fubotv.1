#!/usr/bin/env python3
"""Frozen DEV-only B evaluation. This module is not imported by production."""
import hashlib,json,math,os,re,statistics,time,unicodedata
from pathlib import Path
import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

HERE=Path(__file__).resolve().parent;MODEL=Path(os.getenv('NLI_MODEL_DIR','/tmp/fubot-nli-model-v2'));MODEL_FILE=MODEL/'onnx/model_quantized.onnx'
REVISION='704310ca0bb8eb15bca150fc1e11083cd423dd02';MODEL_SHA='27c39e884c14b03cf46cfc5485971b6db70ff330220d93dfe729c63fde43af0e'
DEV_SHA='3aa1fbe23ae66d52676795a17e2790b2c766840e0854924b110d3e8d777c6ae2';LABELS=('SUPPORTED','CONTRADICTED','NOT_PROVEN')
WORD_NUM={'مئه':100,'مائة':100,'عشرون':20,'وعشرون':20,'عشرين':20,'وعشرين':20,'خمسه':5,'خمسة':5,'اثنتا':12,'اثنا':12,'عشره':10,'عشرة':10,'تسعه':9,'تسعة':9,'ستة':6,'سته':6,'نصف':.5,'ساعتان':2}
RELATIONS=[('price',{'سعر','تكلفه','ثمن','اجره'}),('duration',{'مده','فتره','دقيقه','ساعه','ساعات','شهر','اشهر','يستغرق','تستغرق','تستمر'}),('temperature',{'حراره','درجه','مئويه','فهرنهايت'}),('availability',{'متاح','متوفر','موعد','شاغر','يعمل','عمل'}),('delivery',{'توصيل','شحن','يصل'}),('payment',{'دفع','نقد','بنكي','شيكات'}),('coverage',{'يشمل','تغطي','يغطي','ضمن'}),('list',{'قائمه','مكونات','فروع','الوان','عدسات'}),('discount',{'خصم'}),('warranty',{'ضمان','كفاله'})]
def sha_bytes(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def norm(v):
 v=unicodedata.normalize('NFKC',str(v or '')).lower();v=re.sub(r'[\u064b-\u065f\u0670\u0640]','',v);v=v.translate(str.maketrans({'إ':'ا','أ':'ا','آ':'ا','ٱ':'ا','ى':'ي','ة':'ه'}));return re.sub(r'\s+',' ',re.sub(r'[^\w\d<>=%.:]+',' ',v)).strip()
def toks(v):return set(norm(v).split())
def relation(v):
 t=toks(v);return next((name for name,words in RELATIONS if t&words),None)
def neg(v):return bool(re.search(r'(?:^|\s)(?:لا|ليس|ليست|غير|دون|بدون|مش|لن)(?:\s|$)',norm(v)))
def current(v):return bool(re.search(r'(?:الان|حاليا|اليوم|هذه الساعه)',norm(v)))
def historical(v):return bool(re.search(r'(?:كان|سابقا|الماضي|في يناير|تاريخيا)',norm(v)))
def appointment_availability(v):return bool(re.search(r'(?:موعد|شاغر|حجز)',norm(v)))
def work_schedule(v):return bool(re.search(r'(?:يعمل|عمل|يفتح|تفتح)',norm(v)))
def complete_list(v):return bool(re.search(r'(?:القائمه الكامله|فقط)',norm(v)))
def conditional(v):return bool(re.search(r'(?:بشرط|اذا|في حال|عندما)',norm(v)))
def comparator(v):
 n=norm(v)
 if re.search(r'اكبر من او تساوي|او اكثر|>=',n):return '>='
 if re.search(r'اكبر من|>',n):return '>'
 if re.search(r'اقل من او تساوي|او اقل|<=',n):return '<='
 if re.search(r'اقل من|<',n):return '<'
 return None
def quantities(v):
 n=norm(v);out=[]
 for m in re.finditer(r'(\d+(?:[.,]\d+)?)\s*(شيكل|دقيقه|ساعه|اشهر|شهر|درجه|مئويه|فهرنهايت|قطعه|رغيفا|رغيف)?',n):out.append((float(m.group(1).replace(',','.')),m.group(2)))
 words=n.split()
 for i,w in enumerate(words):
  if w in WORD_NUM:
   value=WORD_NUM[w];unit=words[i+1] if i+1<len(words) and words[i+1] in {'شيكل','دقيقه','ساعه','اشهر','شهر','درجه','مئويه','فهرنهايت','قطعه','رغيفا','رغيف'} else None
   if w=='نصف' and unit in {'سنه','سنة'}:value,unit=6,'شهر'
   out.append((float(value),unit))
 return out
def equivalent_quantity(q,e):
 qv,qu=q;ev,eu=e
 if qu==eu:return qv==ev
 if {qu,eu}=={'ساعه','دقيقه'}:return (qv*60==ev if qu=='ساعه' else ev*60==qv)
 if {qu,eu}=={'شهر','اشهر'}:return qv==ev
 return False
def best_sentence(text,claim):
 parts=[x.strip() for x in re.split(r'(?<=[.!?؟؛])\s+|\n+',text) if x.strip()];ct=toks(claim)
 return max(parts or [text],key=lambda s:len(ct&toks(s))/(len(ct) or 1))
def local_sentences(text,claim):
 parts=[x.strip() for x in re.split(r'(?<=[.!?؟؛])\s+|\n+',text) if x.strip()];ct=toks(claim);rank=sorted(parts,key=lambda s:len(ct&toks(s)),reverse=True);return ' '.join(rank[:3])
def veto(row):
 evidence=[e for e in row['evidence'] if e.get('tenantId')==row['tenantId'] and e.get('id') in row['evidenceIds']]
 if not evidence:return ('NOT_PROVEN','TENANT_OR_TRUSTED_EVIDENCE_MISMATCH')
 text=' '.join(e['text'] for e in evidence);cq,eq=quantities(row['claim']),quantities(text);cr,er=relation(row['claim']),relation(text)
 if current(row['claim']) and (historical(text) or not current(text)):return ('NOT_PROVEN','MISSING_PREMISE_TEMPORAL')
 if appointment_availability(row['claim']) and work_schedule(text) and not appointment_availability(text):return ('NOT_PROVEN','MISSING_PREMISE_AVAILABILITY')
 if comparator(row['claim']) and comparator(text) and comparator(row['claim'])!=comparator(text):return ('CONTRADICTED','COMPARATOR_MISMATCH')
 if cq and eq:
  for q in cq:
   if not any(equivalent_quantity(q,e) for e in eq):return (('CONTRADICTED' if cr and cr==er else 'NOT_PROVEN'),'NUMERIC_OR_UNIT_MISMATCH')
 if neg(row['claim'])!=neg(text) and cr and cr==er:return ('CONTRADICTED','POLARITY_CONFLICT')
 if complete_list(text) and re.search(r'(?:يوجد|من مكونات|يشمل)',norm(row['claim'])) and not neg(row['claim']):
  shared=toks(row['claim'])&toks(text)
  if len(shared)<2:return ('CONTRADICTED','COMPLETE_LIST_MEMBERSHIP_CONFLICT')
 if conditional(row['claim']) and conditional(text) and cq and eq and any(not any(equivalent_quantity(q,e) for e in eq) for q in cq):return ('CONTRADICTED','CONDITIONAL_POLICY_BRANCH_MISMATCH')
 if cr and er and cr!=er:return ('NOT_PROVEN','RELATION_MISMATCH_OR_MISSING_PREMISE')
 return None
def formulate(row,name):
 evidence=[e['text'] for e in row['evidence'] if e.get('tenantId')==row['tenantId'] and e.get('id') in row['evidenceIds']];block=' '.join(evidence)
 if name=='A':return best_sentence(block,row['claim']),row['claim']
 if name=='B':return block[:2000],row['claim']
 return local_sentences(block,row['claim'])[:2000],norm(row['claim'])
def percentile(v,p):return float(np.percentile(np.array(v),p*100)) if v else 0
def score_metrics(rows,key='verdict'):
 out={'perClass':{}}
 for label in LABELS:
  tp=sum(r['expectedVerdict']==label and r[key]==label for r in rows);fp=sum(r['expectedVerdict']!=label and r[key]==label for r in rows);fn=sum(r['expectedVerdict']==label and r[key]!=label for r in rows);p=tp/(tp+fp) if tp+fp else 0;q=tp/(tp+fn) if tp+fn else 0
  out['perClass'][label]={'tp':tp,'fp':fp,'fn':fn,'precision':p,'recall':q,'f1':2*p*q/(p+q) if p+q else 0}
 negs=[r for r in rows if r['expectedVerdict']!='SUPPORTED'];pos=[r for r in rows if r['expectedVerdict']=='SUPPORTED'];out['unsafeAccepts']=sum(r[key]=='SUPPORTED' for r in negs);out['falseRejects']=sum(r[key]!='SUPPORTED' for r in pos);out['falseRejectRate']=out['falseRejects']/len(pos) if pos else None;return out
def map_rows(raw,threshold,contradiction_threshold=.55):
 rows=[]
 for r in raw:
  if r['veto']:verdict,reason=r['veto']
  elif r['scores']['contradiction']>=contradiction_threshold and r['scores']['contradiction']>r['scores']['neutral']:verdict,reason='CONTRADICTED','NLI_CONTRADICTION_DOMINATES'
  elif r['scores']['entailment']>=threshold and r['scores']['entailment']>max(r['scores']['neutral'],r['scores']['contradiction']):verdict,reason='SUPPORTED','NLI_ENTAILMENT_NO_VETO'
  else:verdict,reason='NOT_PROVEN','INSUFFICIENT_EXACT_ENTAILMENT'
  rows.append({**r,'verdict':verdict,'reasonCode':reason})
 return rows
def main():
 dev_path=HERE/'semantic-validator-gold-v2.json';assert sha_bytes(dev_path)==DEV_SHA;assert sha_bytes(MODEL_FILE)==MODEL_SHA
 dev=json.loads(dev_path.read_text())['rows'];opts=ort.SessionOptions();opts.intra_op_num_threads=4;opts.inter_op_num_threads=1
 load=time.perf_counter();session=ort.InferenceSession(str(MODEL_FILE),sess_options=opts,providers=['CPUExecutionProvider']);load_ms=(time.perf_counter()-load)*1000;names={x.name for x in session.get_inputs()};tokenizer=AutoTokenizer.from_pretrained(MODEL,local_files_only=True)
 def infer(premise,hypothesis):
  enc=tokenizer(premise,hypothesis,return_tensors='np',truncation=True,max_length=256);feed={k:v.astype(np.int64) for k,v in enc.items() if k in names};start=time.perf_counter();logits=session.run(None,feed)[0][0];ms=(time.perf_counter()-start)*1000;z=np.exp(logits-np.max(logits));p=z/z.sum();return {'entailment':float(p[0]),'neutral':float(p[1]),'contradiction':float(p[2])},ms
 formulations={}
 for name in ('A','B','C'):
  raw=[]
  for row in dev:
   premise,hypothesis=formulate(row,name);scores,ms=infer(premise,hypothesis);raw.append({**row,'premise':premise,'hypothesis':hypothesis,'scores':scores,'veto':veto(row),'latencyMs':ms})
  grid=[]
  for threshold in [round(x,2) for x in np.arange(.05,1.001,.01)]:
   mapped=map_rows(raw,threshold);m=score_metrics(mapped);grid.append({'threshold':threshold,**m})
  safe=[x for x in grid if x['unsafeAccepts']==0];chosen=max(safe,key=lambda x:(x['perClass']['SUPPORTED']['precision'],x['perClass']['SUPPORTED']['recall'],-x['falseRejectRate'],-x['threshold'])) if safe else None
  final=map_rows(raw,chosen['threshold']) if chosen else [];lat=[r['latencyMs'] for r in raw];formulations[name]={'selectedThreshold':chosen['threshold'] if chosen else None,'metrics':score_metrics(final) if final else None,'latency':{'meanMs':statistics.mean(lat),'p95Ms':percentile(lat,.95)},'thresholdGrid':grid,'rows':final}
 safe_names=[n for n,v in formulations.items() if v['metrics'] and v['metrics']['unsafeAccepts']==0];selected=max(safe_names,key=lambda n:(formulations[n]['metrics']['perClass']['SUPPORTED']['precision'],formulations[n]['metrics']['perClass']['SUPPORTED']['recall'],-formulations[n]['metrics']['falseRejectRate'],-formulations[n]['latency']['meanMs'])) if safe_names else None
 chosen_rows=formulations[selected]['rows'] if selected else []
 # Measure one true batch using the selected deterministic formulation; quality results remain single-claim.
 pairs=[formulate(r,selected) for r in dev] if selected else [];batch_ms=None
 if pairs:
  enc=tokenizer([p[0] for p in pairs],[p[1] for p in pairs],return_tensors='np',padding=True,truncation=True,max_length=256);feed={k:v.astype(np.int64) for k,v in enc.items() if k in names};start=time.perf_counter();session.run(None,feed);batch_ms=(time.perf_counter()-start)*1000
 cats=sorted(set(c for r in dev for c in r['categories']));category={c:{'total':len(x:=[r for r in chosen_rows if c in r['categories']]),'bCorrect':sum(r['verdict']==r['expectedVerdict'] for r in x),'bUnsafeAccepts':sum(r['verdict']=='SUPPORTED' and r['expectedVerdict']!='SUPPORTED' for r in x),'bFalseRejects':sum(r['verdict']!='SUPPORTED' and r['expectedVerdict']=='SUPPORTED' for r in x)} for c in cats} if selected else {}
 hard=[r for r in chosen_rows if r['flags']['hardNegative']];report={'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'corpusSha256':DEV_SHA,'model':{'repository':'MoritzLaurer/mDeBERTa-v3-base-mnli-xnli','revision':REVISION,'tokenizerRevision':REVISION,'onnxSource':'repository onnx/model_quantized.onnx','quantization':'repository-provided INT8 dynamic quantization; DynamicQuantizeLinear and MatMulInteger operators verified (exporter metadata unavailable)','artifactSha256':MODEL_SHA,'artifactBytes':MODEL_FILE.stat().st_size,'onnxruntimeVersion':ort.__version__,'transformersVersion':__import__('transformers').__version__,'numpyVersion':np.__version__},'vetoes':['tenant mismatch','missing/untrusted evidence ID','numeric value mismatch','unit mismatch','comparator mismatch','range mismatch via exact quantity set','temporal current-vs-historical mismatch','explicit polarity conflict when relation matches','complete-list membership contradiction','conditional-policy branch mismatch','relation mismatch','deterministically observable missing premise including availability'],'modelLoadMs':load_ms,'formulations':formulations,'selectedFormulation':selected,'selectedThreshold':formulations[selected]['selectedThreshold'] if selected else None,'devMetrics':score_metrics(chosen_rows) if selected else None,'hardNegative':{'count':len(hard),'unsafeAccepts':sum(r['verdict']=='SUPPORTED' and r['expectedVerdict']!='SUPPORTED' for r in hard)},'category':category,'batchLatency':{'totalMs':batch_ms,'meanPerClaimMs':batch_ms/len(dev) if batch_ms else None},'devPassed':bool(selected and score_metrics(chosen_rows)['unsafeAccepts']==0 and score_metrics(chosen_rows)['perClass']['SUPPORTED']['precision']>=.99 and score_metrics(chosen_rows)['perClass']['SUPPORTED']['recall']>=.90)}
 (HERE/'challenger-b-local-v2-dev-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');compact={k:v for k,v in report.items() if k!='formulations'};compact['formulations']={n:{k:v for k,v in x.items() if k not in ('rows','thresholdGrid')} for n,x in formulations.items()};print(json.dumps(compact,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
