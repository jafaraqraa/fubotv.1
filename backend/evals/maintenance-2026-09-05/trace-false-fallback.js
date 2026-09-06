'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../..'),out=process.env.FUBOT_FALSE_FALLBACK_TRACE;
if(!out||!process.env.SQLITE_DB_PATH||!process.env.QDRANT_COLLECTION?.startsWith('fubot_audit_'))throw Error('isolated paths required');
require(path.join(root,'backend/node_modules/dotenv')).config({path:path.join(root,'backend/.env'),quiet:true});
const captures=[];const safe=v=>JSON.parse(JSON.stringify(v,(k,x)=>/key|token|secret|password|authorization/i.test(k)?undefined:x));
function wrap(modulePath,name){const mod=require(modulePath),fn=mod[name];mod[name]=function(...args){let output=fn.apply(this,args);captures.push({stage:name,input:safe(args),output:safe(output)});return output;};}
wrap(path.join(root,'backend/src/rag/intelligence/evidenceDecisionGate'),'decideEvidence');
wrap(path.join(root,'backend/src/rag/intelligence/derivedClaimValidator'),'validateDerivedClaim');
wrap(path.join(root,'backend/src/rag/intelligence/answerValidator'),'validateDetailed');
wrap(path.join(root,'backend/src/rag/security/conditionalPolicyGuard'),'evaluateConditionalPolicy');
wrap(path.join(root,'backend/src/rag/security/groundingSafetyBoundary'),'applyGroundingSafetyBoundary');
const Provider=require(path.join(root,'backend/src/services/aiProviders')),get=Provider.getAIProviderForTask;
Provider.getAIProviderForTask=function(...args){const p=get.apply(this,args),gen=p.generate;if(!p.__traceWrapped){p.__traceWrapped=true;p.generate=async function(messages,options){const result=await gen.call(this,messages,options);captures.push({stage:'generation',input:{provider:this.constructor.name,model:this.model,promptHash:crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex'),systemHash:crypto.createHash('sha256').update(String(messages?.[0]?.content||'')).digest('hex'),hasSystemPrompt:Boolean(messages?.[0]),hasEvidence:/220|60/u.test(JSON.stringify(messages)),messages:safe(messages)},output:safe(result)});return result;};}return p;};
const {getAIResponse}=require(path.join(root,'backend/src/services/ai')),db=require(path.join(root,'backend/src/database/connection'));
(async()=>{const q=process.env.FUBOT_FALSE_FALLBACK_QUESTION||'بدي وحدتين Mesh، قديش سعر الوحدتين مع التركيب بنفس الزيارة؟',id='false-fallback-'+Date.now(),telemetry={pipelineTelemetry:{},decisionTelemetry:{},retrievalTelemetry:{},validationTelemetry:{}};let answer,error;try{answer=await getAIResponse(id,q,'text',null,{tenantId:'default',channel:'isolated_no_delivery',conversationId:id,knowledgeBaseOnly:true,...telemetry});}catch(e){error={code:e.code,message:e.message}}const trace=db.prepare('select * from rag_request_traces where conversation_id=?').get(id);const result={question:q,answer,error,trace:safe(trace),telemetry:safe(telemetry),captures};fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify({answer,error,requestId:trace?.request_id,gate:trace?.evidence_gate_decision,boundary:trace?.boundary_decision,fallback:trace?.fallback_source,raw:trace?.raw_model_output,captureStages:captures.map(x=>x.stage)}));db.close()})().catch(e=>{console.error(e);process.exitCode=1});
