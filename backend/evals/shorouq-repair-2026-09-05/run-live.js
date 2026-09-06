'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const output=process.env.FUBOT_EVAL_OUTPUT_DIR;
if(!output || !process.env.SQLITE_DB_PATH || fs.realpathSync(process.env.SQLITE_DB_PATH)===fs.realpathSync(path.join(root,'backend/data/app.db'))
 || !/^fubot_(fix|audit)_/.test(process.env.QDRANT_COLLECTION||''))throw Error('Isolated database, collection and output required');
require(path.join(root,'backend/node_modules/dotenv')).config({path:path.join(root,'backend/.env'),quiet:true});
const {getConfig}=require(path.join(root,'backend/src/rag/config/ragConfig'));
if(getConfig('QDRANT_COLLECTION')!==process.env.QDRANT_COLLECTION)throw Error('Database collection overrides environment: refusing evaluation');
fs.mkdirSync(output,{recursive:true});
const crypto=require('crypto');
function manifest(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
 const file=path.join(dir,entry.name);return entry.isDirectory()?manifest(file):[{file:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}];});}
const codeManifest=manifest(path.join(root,'backend/src'));
fs.writeFileSync(path.join(output,'code-manifest.json'),JSON.stringify({pid:process.pid,cwd:process.cwd(),loadedAt:new Date().toISOString(),codeManifest},null,2));
let captures=[];
const providers=require(path.join(root,'backend/src/services/aiProviders'));
const getProvider=providers.getAIProviderForTask,wrapped=new WeakSet();
providers.getAIProviderForTask=function(...args){
 const provider=getProvider.apply(this,args);
 if(provider && !wrapped.has(provider)){
  const generate=provider.generate;wrapped.add(provider);
  provider.generate=async function(messages,options){
   const result=await generate.call(this,messages,options);
   captures.push({stage:'actual_provider',provider:this.constructor.name,model:this.model,messages,output:result});
   return result;
  };
 }
 return provider;
};
const Builder=require(path.join(root,'backend/src/services/PromptBuilder'));
const build=Builder.buildMessages;
Builder.buildMessages=function(input){const messages=build.call(this,input);captures.push({stage:'generation_prompt',input,messages});return messages;};
for(const [name,fn] of [['intelligence/answerValidator','validateDetailed'],['intelligence/evidenceDecisionGate','decideEvidence'],['security/groundingSafetyBoundary','applyGroundingSafetyBoundary']]){
 const mod=require(path.join(root,'backend/src/rag',name)),original=mod[fn];
 mod[fn]=function(...args){const result=original.apply(this,args);captures.push({stage:fn,args,result});return result;};
}
const {getAIResponse}=require(path.join(root,'backend/src/services/ai'));
const {saveMessage}=require(path.join(root,'backend/src/database/repositories/messageRepository'));
const db=require(path.join(root,'backend/src/database/connection'));
const source=JSON.parse(fs.readFileSync(process.env.FUBOT_HISTORICAL_TRACES,'utf8'));
const channel='isolated_shorouq_no_delivery';
const tenantId=process.env.FUBOT_EVAL_TENANT || 'default';
const stamp=Date.now();
async function main(){
 const rows=[];
 const phases=process.env.FUBOT_EVAL_PHASES?.split(',')||['sequence','independent','sensitive2','sensitive3'];
 for(const phase of phases)for(let i=0;i<source.length;i++){
  if(phase.startsWith('sensitive') && ![10,11,12,13,15,16,17,22,25,26,28,29,30,31,32,33].includes(i))continue;
  captures=[];
  const userId=phase==='sequence'?`shorouq-${stamp}-sequence`:`shorouq-${stamp}-${phase}-${i}`;
  const question=source[i].retrieval_query;
  const telemetry={pipelineTelemetry:{},decisionTelemetry:{},retrievalTelemetry:{},validationTelemetry:{}};
  let answer,error;const start=Date.now();
  try{answer=await getAIResponse(userId,question,'text',null,{tenantId,channel,conversationId:`${channel}:${userId}`,knowledgeBaseOnly:true,...telemetry});}catch(e){error={code:e.code,message:e.message};}
  if(phase==='sequence'){
   saveMessage(userId,'user',question,'text',false,`${userId}-q-${i}`,{channel,tenantId});
   if(answer)saveMessage(userId,'assistant',String(answer),'text',false,`${userId}-a-${i}`,{channel,tenantId});
  }
  const traces=db.prepare('select * from rag_request_traces where conversation_id = ? order by rowid desc limit 1').all(`${channel}:${userId}`);
  rows.push({phase,i,question,answer,error,elapsedMs:Date.now()-start,telemetry,captures,traces});
  fs.writeFileSync(path.join(output,`live-${stamp}.json`),JSON.stringify(rows,null,2));
  console.log(JSON.stringify({phase,i,answer,error,elapsedMs:Date.now()-start}));
 }
 db.close();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
