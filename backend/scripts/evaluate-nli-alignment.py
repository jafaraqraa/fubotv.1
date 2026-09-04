#!/usr/bin/env python3
import json, math, os, re, statistics, sys, time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "evals/semantic-alignment/dev-pairs-ar.json"
COSINE_RESULTS = ROOT / "evals/semantic-alignment/results.json"
OUTPUT = Path(os.getenv("NLI_ALIGNMENT_OUTPUT", ROOT / "evals/nli-alignment/results.json"))
MODEL_DIR = Path(os.getenv("NLI_MODEL_DIR", "/tmp/fubot-nli-model"))
MODEL_FILE = MODEL_DIR / "onnx/model_quantized.onnx"
ARABIC_IDS = {"p01","p02","p03","p06","p08","p10","p14","p15","p16","p17"}
CONTRADICTED_IDS = {"h10", "h13"}
STYLE_IDS = {
    "palestinian": {"p01","p02","p03","p04","p05","p06","p08","p10","p11","p13","p15","p16","p17","p18"},
    "msa": {"p07","p09","p12","p14","p19","p20"},
    "morphology_paraphrase": ARABIC_IDS,
}

def normalize(value):
    return re.sub(r"\s+", " ", str(value).strip().replace("؟", "").replace("?", ""))

def proposition_hypothesis(question):
    q = normalize(question)
    transforms = [
        (r"^(?:هل)\s+(.+)$", "المطلوب معرفة ما إذا كان {}."),
        (r"^(?:متى|إيمتى|امتى)\s+(.+)$", "المطلوب معرفة توقيت {}."),
        (r"^(.+?)\s+(?:متى|إيمتى|امتى)\s+(.+)$", "المطلوب معرفة توقيت {} {}."),
        (r"^(?:وين|أين|اين)\s+(.+)$", "المطلوب معرفة مكان {}."),
        (r"^(?:كيف|بشو|مين)\s+(.+)$", "المطلوب معرفة تفاصيل {}."),
        (r"^(?:كم|قديش|بكم)\s+(.+)$", "المطلوب معرفة المقدار المتعلق بـ {}."),
        (r"^(.+?)\s+(?:كم|قديش|بكم)(?:\s+(.+))?$", "المطلوب معرفة المقدار المتعلق بـ {} {}.")
    ]
    for pattern, template in transforms:
        match = re.match(pattern, q)
        if match:
            return template.format(*[part or "" for part in match.groups()]).replace("  ", " ")
    return f"المطلوب معرفة المعلومة التالية: {q}."

def softmax(logits):
    shifted = logits - np.max(logits)
    values = np.exp(shifted)
    return values / values.sum()

def percentile(values, q):
    return float(np.percentile(np.array(values), q * 100))

def distribution(values):
    return {"count":len(values), "mean":statistics.mean(values), "median":statistics.median(values),
            "p10":percentile(values,.1), "p90":percentile(values,.9),
            "min":min(values), "max":max(values)}

def metrics(rows, threshold):
    tp=tn=fp=fn=hard_ok=hard_n=0
    for row in rows:
        actual = row["label"] == "POSITIVE"
        predicted = row["scores"]["entailment"] >= threshold
        if actual and predicted: tp += 1
        elif actual: fn += 1
        elif predicted: fp += 1
        else: tn += 1
        if row["label"] == "HARD_NEGATIVE":
            hard_n += 1; hard_ok += int(not predicted)
    precision=tp/(tp+fp) if tp+fp else 0
    recall=tp/(tp+fn) if tp+fn else 0
    return {"threshold":threshold,"tp":tp,"tn":tn,"fp":fp,"fn":fn,
            "accuracy":(tp+tn)/len(rows),"supportedPrecision":precision,"supportedRecall":recall,
            "falseAnswerRate":fp/(fp+tn) if fp+tn else None,
            "falseNoAnswerRate":fn/(fn+tp) if fn+tp else None,
            "hardNegativeAccuracy":hard_ok/hard_n if hard_n else None}

def conservative_threshold(rows):
    candidates=[]
    for threshold in np.arange(0.01, 1, 0.01):
        result=metrics(rows,float(round(threshold,2)))
        if result["falseAnswerRate"] <= .15:
            candidates.append(result)
    return max(candidates,key=lambda x:(x["supportedRecall"],x["accuracy"])) if candidates else metrics(rows,1.0)

def main():
    if not MODEL_FILE.exists():
        raise SystemExit(f"Missing local model: {MODEL_FILE}")
    pairs=json.loads(DATASET.read_text())
    tokenizer=AutoTokenizer.from_pretrained(MODEL_DIR, local_files_only=True)
    options=ort.SessionOptions(); options.intra_op_num_threads=4; options.inter_op_num_threads=1
    cold_start=time.perf_counter()
    session=ort.InferenceSession(str(MODEL_FILE),sess_options=options,providers=["CPUExecutionProvider"])
    cold_start_ms=(time.perf_counter()-cold_start)*1000
    input_names={item.name for item in session.get_inputs()}

    def infer(premise,hypothesis):
        encoded=tokenizer(premise,hypothesis,return_tensors="np",truncation=True,max_length=256)
        feed={name:value.astype(np.int64) for name,value in encoded.items() if name in input_names}
        started=time.perf_counter(); logits=session.run(None,feed)[0][0]; elapsed=(time.perf_counter()-started)*1000
        probs=softmax(logits)
        return {"entailment":float(probs[0]),"neutral":float(probs[1]),"contradiction":float(probs[2]),
                "logits":[float(x) for x in logits]},elapsed

    formulations={}
    for formulation in ("raw","proposition"):
        rows=[]; latencies=[]
        # Warm-up is recorded separately and excluded from warm latency metrics.
        warm_started=time.perf_counter(); infer(pairs[0]["evidence"],pairs[0]["question"]); warmup_ms=(time.perf_counter()-warm_started)*1000
        for pair in pairs:
            hypothesis=pair["question"] if formulation=="raw" else proposition_hypothesis(pair["question"])
            scores,latency=infer(pair["evidence"],hypothesis); latencies.append(latency)
            expected="SUPPORTED" if pair["label"]=="POSITIVE" else ("CONTRADICTED" if pair["id"] in CONTRADICTED_IDS else "INSUFFICIENT")
            rows.append({**pair,"hypothesis":hypothesis,"expectedNli":expected,"scores":scores,"latencyMs":latency})
        calibrated=conservative_threshold(rows)
        arabic=metrics([row for row in rows if row["id"] in ARABIC_IDS],calibrated["threshold"])
        unseen=metrics([row for row in rows if row.get("unseen")],calibrated["threshold"])
        styles={name:metrics([row for row in rows if row["id"] in ids],calibrated["threshold"])
                for name,ids in STYLE_IDS.items()}
        by_expected={label:distribution([r["scores"]["entailment"] for r in rows if r["expectedNli"]==label])
                     for label in ("SUPPORTED","INSUFFICIENT","CONTRADICTED")}
        formulations[formulation]={"calibrated":calibrated,"arabicParaphrase":arabic,"languageStyles":styles,"unknownConcepts":unseen,
            "scoreDistributions":by_expected,"latency":{"warmupMs":warmup_ms,"meanMs":statistics.mean(latencies),
            "p50Ms":statistics.median(latencies),"p95Ms":percentile(latencies,.95)},"rows":rows}

    chosen=max(formulations,key=lambda name:(formulations[name]["calibrated"]["supportedRecall"],formulations[name]["calibrated"]["accuracy"]))
    latency=formulations[chosen]["latency"]
    simulations={str(count):{"serialMeanMs":latency["meanMs"]*count,"serialP50Ms":latency["p50Ms"]*count,
                              "serialP95Ms":latency["p95Ms"]*count} for count in (1,3,5,10)}
    prior=json.loads(COSINE_RESULTS.read_text())["methods"]
    # Offline candidate-count simulation: each supported question is paired with
    # its gold sentence plus nine rotating unsupported sentences. This measures
    # how often the gold survives max-score top-N selection; it is not retrieval recall.
    positives=[pair for pair in pairs if pair["label"]=="POSITIVE"]
    distractors=[pair["evidence"] for pair in pairs if pair["label"]!="POSITIVE"]
    candidate_cases=[]
    threshold=formulations[chosen]["calibrated"]["threshold"]
    for index,pair in enumerate(positives):
        candidates=[pair["evidence"]]+[distractors[(index+offset)%len(distractors)] for offset in range(9)]
        scored=[]
        for candidate_index,evidence in enumerate(candidates):
            score,_=infer(evidence,pair["question"])
            scored.append((score["entailment"],candidate_index==0))
        scored.sort(reverse=True)
        candidate_cases.append(scored)
    def candidate_quality(count):
        gold_in=sum(any(gold for _,gold in case[:count]) for case in candidate_cases)/len(candidate_cases)
        safe=sum(case[0][1] and case[0][0]>=threshold for case in candidate_cases)/len(candidate_cases)
        distractor_authorized=sum(any((not gold) and score>=threshold for score,gold in case[:count]) for case in candidate_cases)/len(candidate_cases)
        return {"goldPreserved":gold_in,"goldTop1AndAccepted":safe,"distractorAuthorized":distractor_authorized}
    candidate_quality_results={"top3":candidate_quality(3),"top5":candidate_quality(5)}

    report={"model":"MoritzLaurer/mDeBERTa-v3-base-mnli-xnli","runtime":"quantized ONNX CPU",
            "modelFileBytes":MODEL_FILE.stat().st_size,"coldStartMs":cold_start_ms,"datasetSize":len(pairs),
            "formulations":formulations,"chosenFormulation":chosen,"pairCountLatencySimulation":simulations,
            "candidateReduction":{"top3":{**simulations["3"],**candidate_quality_results["top3"]},
                                  "top5":{**simulations["5"],**candidate_quality_results["top5"]},
             "qualityNote":"Synthetic grouped simulation using one gold and nine rotating unsupported DEV-pair sentences; not retrieval recall."},
            "priorBaselines":{"currentGate":prior["baseline"],"lexical":prior["lexical"],
                              "nomicCosine":prior["semantic"],"nomicHybrid":prior["hybrid"]}}
    OUTPUT.parent.mkdir(parents=True,exist_ok=True); OUTPUT.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    compact={**report,"formulations":{name:{k:v for k,v in value.items() if k!="rows"} for name,value in formulations.items()}}
    print(json.dumps(compact,ensure_ascii=False,indent=2))

if __name__ == "__main__": main()
