require('../../backend/node_modules/dotenv').config({path:require('path').resolve('backend/.env')});
const fs=require('fs');
const {getAIResponse}=require('../../backend/src/services/ai');
// Load the literal corpus without exporting production code: parse it from the
// acceptance runner's source so this file remains a disposable test artifact.
const source=fs.readFileSync(require.resolve('./run-customer-cases.js'),'utf8');
const start=source.indexOf('const cases = [')+'const cases = '.length;
const end=source.indexOf(".map(([id,question",start);
const rows=Function(`return (${source.slice(start,end)})`)();
const cases=rows.map(([id,question,expectedDecision,terms,tag])=>({id,question,expectedDecision,terms,tag}));

async function main(){
 const results=[];
 for(let i=0;i<cases.length;i++){
  const c=cases[i], started=Date.now(), pipelineTelemetry={}, decisionTelemetry={}, retrievalTelemetry={};
  try{
   const answer=await getAIResponse(`accept-isolated-${c.id}`,c.question,'text',null,{tenantId:'accept_cedar_ceramics_20260904',channel:'acceptance',conversationId:`acceptance:${c.id}`,pipelineTelemetry,decisionTelemetry,retrievalTelemetry});
   results.push({...c,latencyMs:Date.now()-started,answer:String(answer||''),pipelineTelemetry,decisionTelemetry,retrievalTelemetry});
  }catch(error){results.push({...c,latencyMs:Date.now()-started,answer:'',error:{message:error.message,code:error.code},pipelineTelemetry,decisionTelemetry,retrievalTelemetry});}
  const x=results.at(-1); console.log(`${i+1}/${cases.length} ${c.id} ${x.latencyMs}ms gate=${pipelineTelemetry.gateDecision||'-'} ${String(x.answer||x.error?.message).replace(/\s+/g,' ').slice(0,140)}`);
 }
 fs.writeFileSync('artifacts/final-acceptance-2026-09-04/direct-results-after-reliability.json',JSON.stringify({runAt:new Date().toISOString(),results},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
