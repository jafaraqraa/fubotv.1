require('../../backend/node_modules/dotenv').config({path:require('path').resolve('backend/.env')});
const fs=require('fs');
const {getAIResponse}=require('../../backend/src/services/ai');
const {saveMessage}=require('../../backend/src/database/repositories/messageRepository');
const tenantId='accept_cedar_ceramics_20260904', channel='acceptance_multi_reliability_replay';
const conversations=[
 ['M01',[['احكيلي عن لمسة طين','ANSWER'],['قديش سعرها؟','ANSWER'],['وقديش بتاخد وقت؟','ANSWER']]],
 ['M02',[['شو عضوية رف الصانع؟','ANSWER'],['قديش سعرها؟','ANSWER'],['والمدة؟','ANSWER']]],
 ['M03',[['احكيلي عن لمسة طين وأول دورة عالدولاب','ANSWER'],['قديش سعرها؟','CLARIFY']]],
 ['M04',[['شو خدمة الحرق الخارجي؟','ANSWER'],['يسلمو','ANSWER'],['وقديش بتاخد؟','ANSWER']]],
 ['M05',[['قارنلي لمسة طين ودورة الأساس','ANSWER'],['خلينا بدورة الأساس، كم لقاء؟','ANSWER'],['ارجع للأولى، كم مدتها؟','ANSWER']]],
 ['M06',[['شو سياسة تغيير الحجز؟','ANSWER'],['بدي أغيره','CLARIFY'],['الحجز باسم لينا وموعده 20 أيلول','ANSWER']]],
 ['M07',[['أنا بقول سعر لمسة طين 250','ANSWER'],['يعني أكيد 250 صح؟','ANSWER']]],
 ['M08',[['شو دوام الجمعة؟','ANSWER'],['طيب فاتحين هسا؟','NO_ANSWER']]],
 ['M09',[['الأزرق البحري والأخضر الزيتوني ضمن الجلسة؟','ANSWER'],['هو متاح اليوم؟','CLARIFY']]],
 ['M10',[['اعطيني ألوان لمسة طين','ANSWER'],['والبنفسجي؟','ANSWER'],['طيب النحاسي المطفأ؟','NO_ANSWER']]]
];
async function main(){const results=[]; for(const [conversationId,turns] of conversations){const userId=`accept-replay-multi-${conversationId}`; const turnResults=[]; for(let i=0;i<turns.length;i++){const [question,expectedDecision]=turns[i]; saveMessage(userId,'user',question,'text',false,`replay-${conversationId}-u-${i}`,{channel,tenantId}); const started=Date.now(),pipelineTelemetry={},decisionTelemetry={},retrievalTelemetry={}; let answer='',error=null; try{answer=String(await getAIResponse(userId,question,'text',null,{tenantId,channel,conversationId:`${channel}:${userId}`,pipelineTelemetry,decisionTelemetry,retrievalTelemetry})||''); saveMessage(userId,'ai',answer,'text',false,`replay-${conversationId}-a-${i}`,{channel,tenantId});}catch(e){error={message:e.message,code:e.code};} turnResults.push({turn:i+1,question,expectedDecision,answer,error,latencyMs:Date.now()-started,pipelineTelemetry,decisionTelemetry,retrievalTelemetry}); console.log(`${conversationId}.${i+1} expected=${expectedDecision} gate=${pipelineTelemetry.gateDecision||'-'} ${(answer||error?.message).replace(/\s+/g,' ').slice(0,150)}`);} results.push({conversationId,userId,turns:turnResults});} fs.writeFileSync('artifacts/final-acceptance-2026-09-04/multiturn-results-after-reliability.json',JSON.stringify({runAt:new Date().toISOString(),tenantId,channel,results},null,2));}
main().catch(e=>{console.error(e);process.exitCode=1});
