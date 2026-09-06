#!/usr/bin/env python3
"""Offline-only NLI challenger. It has no import or call path from production."""
import json, os, re, statistics, time
from pathlib import Path
import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

HERE=Path(__file__).resolve().parent
CORPUS=json.loads((HERE/'gold-corpus-v1.json').read_text())
MODEL_DIR=Path(os.getenv('NLI_MODEL_DIR','/tmp/fubot-nli-model'))
MODEL_FILE=MODEL_DIR/'onnx/model_quantized.onnx'
LABELS=['SUPPORTED','CONTRADICTED','NOT_PROVEN']

def norm(v):
    v=str(v or '').lower().replace('إ','ا').replace('أ','ا').replace('آ','ا').replace('ى','ي').replace('ة','ه')
    return re.sub(r'\s+',' ',re.sub(r'[^\w\d<>=%]+',' ',v)).strip()
def nums(v): return re.findall(r'\d+(?:[.,]\d+)?',norm(v))
def neg(v): return bool(re.search(r'(?:^|\s)(?:لا|ليس|ليست|غير|دون|بدون|مش|لن)(?:\s|$)',norm(v)))
def current(v): return bool(re.search(r'(?:الان|حاليا|اليوم)',norm(v)))
def comparator(v):
    n=norm(v)
    if re.search(r'اكبر من او تساوي|او اكثر|>=',n): return '>='
    if re.search(r'اكبر من|>',n): return '>'
    if re.search(r'اقل من او تساوي|او اقل|<=',n): return '<='
    if re.search(r'اقل من|<',n): return '<'
def hard_veto(row,evidence):
    if not evidence: return ('NOT_PROVEN','TENANT_EVIDENCE_MISMATCH')
    text=' '.join(e['text'] for e in evidence); cn,en=nums(row['claim']),nums(text)
    if current(row['claim']) and not current(text): return ('NOT_PROVEN','TEMPORAL_SCOPE_MISSING')
    if comparator(row['claim']) and comparator(text) and comparator(row['claim'])!=comparator(text): return ('CONTRADICTED','COMPARATOR_CONFLICT')
    if cn and en and not all(x in en for x in cn): return ('CONTRADICTED','EXACT_VALUE_CONFLICT')
    if neg(row['claim']) != neg(text): return ('CONTRADICTED','POLARITY_CONFLICT')
    return None
def pct(a,p): return float(np.percentile(np.array(a),p*100)) if a else 0
def summary(rows):
    out={'perClass':{}}
    for label in LABELS:
        tp=sum(r['expectedVerdict']==label and r['challengerB']['verdict']==label for r in rows)
        fp=sum(r['expectedVerdict']!=label and r['challengerB']['verdict']==label for r in rows)
        fn=sum(r['expectedVerdict']==label and r['challengerB']['verdict']!=label for r in rows)
        pr=tp/(tp+fp) if tp+fp else 0; rc=tp/(tp+fn) if tp+fn else 0
        out['perClass'][label]={'precision':pr,'recall':rc,'f1':2*pr*rc/(pr+rc) if pr+rc else 0,'tp':tp,'fp':fp,'fn':fn}
    negatives=[r for r in rows if r['expectedVerdict']!='SUPPORTED']; positives=[r for r in rows if r['expectedVerdict']=='SUPPORTED']
    unsafe=sum(r['challengerB']['verdict']=='SUPPORTED' for r in negatives); rejects=sum(r['challengerB']['verdict']!='SUPPORTED' for r in positives)
    lat=[r['challengerB']['latencyMs'] for r in rows]
    out.update({'unsafeAccepts':unsafe,'unsafeAcceptRate':unsafe/len(negatives) if negatives else None,'falseRejects':rejects,'falseRejectRate':rejects/len(positives) if positives else None,'latency':{'meanMs':statistics.mean(lat),'p95Ms':pct(lat,.95)}})
    return out
def main():
    if not MODEL_FILE.exists(): raise SystemExit(f'Missing local model: {MODEL_FILE}')
    tokenizer=AutoTokenizer.from_pretrained(MODEL_DIR,local_files_only=True)
    opts=ort.SessionOptions();opts.intra_op_num_threads=4;opts.inter_op_num_threads=1
    cold=time.perf_counter();session=ort.InferenceSession(str(MODEL_FILE),sess_options=opts,providers=['CPUExecutionProvider']);cold_ms=(time.perf_counter()-cold)*1000
    names={x.name for x in session.get_inputs()}
    def infer(premise,hypothesis):
        encoded=tokenizer(premise,hypothesis,return_tensors='np',truncation=True,max_length=256)
        feed={k:v.astype(np.int64) for k,v in encoded.items() if k in names};started=time.perf_counter();logits=session.run(None,feed)[0][0];ms=(time.perf_counter()-started)*1000
        z=np.exp(logits-np.max(logits));p=z/z.sum();return {'entailment':float(p[0]),'neutral':float(p[1]),'contradiction':float(p[2])},ms
    raw=[]
    for row in CORPUS['rows']:
        admissible=[e for e in row['evidence'] if str(e.get('tenantId',''))==str(row['tenant'])]
        premise=' '.join(e['text'] for e in admissible)
        scores,ms=infer(premise or 'لا يوجد دليل.',row['claim']);raw.append({**row,'_scores':scores,'_ms':ms,'_veto':hard_veto(row,admissible),'_ids':[e['id'] for e in admissible]})
    dev=[r for r in raw if r['sourceDataset']!='unseen-sourdough-frozen-v1']
    candidates=[]
    for threshold in np.arange(.05,.951,.01):
        unsafe=0;tp=0
        for r in dev:
            supported=not r['_veto'] and r['_scores']['entailment']>=threshold and r['_scores']['entailment']>r['_scores']['neutral'] and r['_scores']['entailment']>r['_scores']['contradiction']
            unsafe+=int(supported and r['expectedVerdict']!='SUPPORTED');tp+=int(supported and r['expectedVerdict']=='SUPPORTED')
        if unsafe==0:candidates.append((tp,float(round(threshold,2))))
    threshold=max(candidates,key=lambda x:(x[0],-x[1]))[1] if candidates else 1.0
    rows=[]
    for r in raw:
        if r['_veto']: verdict,reason=r['_veto'];confidence=.99
        elif r['_scores']['entailment']>=threshold and r['_scores']['entailment']>max(r['_scores']['neutral'],r['_scores']['contradiction']):verdict,reason,confidence='SUPPORTED','NLI_ENTAILMENT_WITH_VETOES',r['_scores']['entailment']
        elif r['_scores']['contradiction']>.55 and r['_scores']['contradiction']>r['_scores']['neutral']:verdict,reason,confidence='CONTRADICTED','NLI_EXPLICIT_CONTRADICTION',r['_scores']['contradiction']
        else:verdict,reason,confidence='NOT_PROVEN','NLI_INSUFFICIENT_ENTAILMENT',max(r['_scores']['neutral'],1-r['_scores']['entailment'])
        clean={k:v for k,v in r.items() if not k.startswith('_')};clean['challengerB']={'verdict':verdict,'confidence':round(float(confidence),4),'evidenceIds':r['_ids'],'reasonCode':reason,'latencyMs':r['_ms'],'scores':r['_scores']};rows.append(clean)
    unseen=[r for r in rows if r['sourceDataset']=='unseen-sourdough-frozen-v1'];hard=[r for r in rows if r['hardNegative']]
    report={'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'design':{'model':'MoritzLaurer/mDeBERTa-v3-base-mnli-xnli','runtime':'quantized ONNX CPU','structuredContract':True,'temperature':0,'devSelectedThreshold':threshold,'deterministicVetoes':['tenant','numeric','comparator','temporal-current','polarity'],'externalApiCostUsd':0,'modelFileBytes':MODEL_FILE.stat().st_size,'coldStartMs':cold_ms},'all':summary(rows),'dev':summary([r for r in rows if r['sourceDataset']!='unseen-sourdough-frozen-v1']),'unseen':summary(unseen),'hardNegative':summary(hard),'categories':{c:summary([r for r in rows if r['category']==c]) for c in sorted(set(r['category'] for r in rows))},'rows':rows}
    (HERE/'model-b-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ('rows','categories')},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
