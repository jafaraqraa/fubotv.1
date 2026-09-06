const path = require('path');
const fs = require('fs');
const outputDir = process.env.FUBOT_EVAL_OUTPUT_DIR;
if (!process.env.SQLITE_DB_PATH || !fs.existsSync(process.env.SQLITE_DB_PATH)
    || fs.realpathSync(process.env.SQLITE_DB_PATH) === fs.realpathSync('backend/data/app.db')
    || !/^fubot_(?:fix|audit)_/.test(process.env.QDRANT_COLLECTION || '') || !outputDir) {
 throw new Error('Use an existing isolated SQLite copy, an isolated fubot_fix_/fubot_audit_ collection, and FUBOT_EVAL_OUTPUT_DIR.');
}
fs.mkdirSync(outputDir,{recursive:true});
require(path.resolve('backend/node_modules/dotenv')).config({ path: path.resolve('backend/.env'), quiet: true });
process.env.RAG_EVIDENCE_GATE_ENABLED = 'true';
process.env.RAG_GROUNDING_SAFETY_BOUNDARY_ENABLED = 'true';
process.env.RAG_GROUNDING_SAFETY_BOUNDARY_SHADOW = 'false';
process.env.RAG_GROUNDING_SAFETY_ENFORCEMENT_PERCENT = '100';
const { getAIResponse } = require(path.resolve('backend/src/services/ai'));
const { saveMessage } = require(path.resolve('backend/src/database/repositories/messageRepository'));
const db = require(path.resolve('backend/src/database/connection'));
const channel = 'isolated_audit_no_delivery';
const cases = [
 ['daily','قديش إيجار الحفارة الصغيرة لليوم؟'],
 ['weekly','قديش إيجار الحفارة الصغيرة بالأسبوع؟'],
 ['deposit','قديش مبلغ التأمين المسترد للحفارة الصغيرة؟'],
 ['included','هل سعر 420 شيكل اليومي للحفارة الصغيرة يشمل التأمين؟'],
 ['follow-deposit','والتأمين عليها؟',['قديش إيجار الحفارة الصغيرة لليوم؟']],
 ['follow-week','والأسبوع؟',['قديش إيجار الحفارة الصغيرة لليوم؟']],
 ['missing-ref','قديش سعرها؟'],
 ['multi-ref','والتأمين عليها؟',['قديش سعر MX20؟','وقديش سعر G8؟']],
 ['minimum','الرافعة المقصية SL10 بقدر آخذها ليوم واحد؟'],
 ['age','عمري 22 سنة، بقدر أستأجر الحفارة MX20 وأشغلها أنا؟'],
 ['credit','صاحبي استأجر منكم قبل، يعني أكيد إله حساب آجل صح؟'],
 ['cancel-24','إذا ألغيت قبل 24 ساعة، كم بسترد؟'],
 ['cancel-47','إذا ألغيت قبل 47 ساعة، كم بسترد؟'],
 ['cancel-48','إذا ألغيت قبل 48 ساعة، كم بسترد؟'],
 ['late-60','تأخرت بإرجاع المعدة 60 دقيقة، شو الرسوم؟'],
 ['late-61','تأخرت بإرجاع المعدة 61 دقيقة، شو الرسوم؟'],
 ['late-4h','تأخرت بإرجاع المعدة 4 ساعات بالضبط، شو الرسوم؟'],
 ['late-4h01','تأخرت بإرجاع المعدة 4 ساعات ودقيقة، شو الرسوم؟'],
 ['live-now','هل MX20 متوفرة حالياً؟'],
 ['catalog-live','وجود MX20 بالكتالوج يعني إنها متوفرة اليوم، صح؟'],
 ['unknown-fuel','قديش سعر لتر الوقود؟'],
 ['unknown-insurer','شو اسم شركة تأمين المعدات؟'],
 ['isolation','حسب معلومات عيادة نبع الطبية، قديش إيجار MX20؟']
];
async function main(){
 const rows=[];
 for(let run=1;run<=3;run++) for(const [id,question,history=[]] of cases){
  const userId=`audit-${run}-${id}-${Date.now()}`;
  for(let i=0;i<history.length;i++) saveMessage(userId,'user',history[i],'text',false,`audit-h-${userId}-${run}-${id}-${i}`,{channel,tenantId:'default'});
  const pipelineTelemetry={},decisionTelemetry={},retrievalTelemetry={},validationTelemetry={};
  const start=Date.now(); let answer='',error=null;
  try { answer=String(await getAIResponse(userId,question,'text',null,{tenantId:'default',channel,conversationId:`${channel}:${userId}`,knowledgeBaseOnly:true,pipelineTelemetry,decisionTelemetry,retrievalTelemetry,validationTelemetry})||''); }
  catch(e){ error={code:e.code||null,message:e.message}; }
  const row={run,id,question,history,answer,error,latencyMs:Date.now()-start,pipelineTelemetry,decisionTelemetry,validationTelemetry,
   retrieval:{mode:retrievalTelemetry.mode,metadata:retrievalTelemetry.metadata,profiling:retrievalTelemetry.profiling&&{
    originalQuery:retrievalTelemetry.profiling.originalQuery,variations:retrievalTelemetry.profiling.variations,
    retrievalSources:retrievalTelemetry.profiling.retrievalSources,preBudgetChunkIds:retrievalTelemetry.profiling.preBudgetChunkIds,
    selectedContextChunkIds:retrievalTelemetry.profiling.selectedContextChunkIds,
    topChunks:(retrievalTelemetry.profiling.topChunks||[]).map(c=>({id:c.chunkId||c.id,tenantId:c.tenantId||c.payload?.tenantId,text:c.text}))}}};
  rows.push(row); fs.writeFileSync(path.join(outputDir,'live-madar.json'),JSON.stringify({rows},null,2));
  console.log(`AUDIT ${run} ${id} ${row.latencyMs}ms gate=${pipelineTelemetry.gateDecision||decisionTelemetry.decision||'-'} ${answer.replace(/\s+/g,' ').slice(0,140)}`);
 }
 const traces=db.prepare("select request_id,retrieval_query,reliability_json,evidence_gate_decision,evidence_gate_reason,claims_json,boundary_decision,boundary_reasons_json,final_response_type from rag_request_traces where conversation_id like 'isolated_audit_no_delivery:%' order by created_at,rowid").all();
 fs.writeFileSync(path.join(outputDir,'live-madar-traces.json'),JSON.stringify(traces,null,2));
 db.close();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});

