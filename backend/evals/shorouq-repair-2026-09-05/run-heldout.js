'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../../..'),out=process.env.FUBOT_EVAL_OUTPUT_DIR;
if(!out || !process.env.SQLITE_DB_PATH || fs.realpathSync(process.env.SQLITE_DB_PATH)===fs.realpathSync(path.join(root,'backend/data/app.db')) || !/^fubot_(fix|audit)_/.test(process.env.QDRANT_COLLECTION||''))throw Error('Isolation required');
require(path.join(root,'backend/node_modules/dotenv')).config({path:path.join(root,'backend/.env'),quiet:true});
const {getConfig}=require(path.join(root,'backend/src/rag/config/ragConfig'));
if(getConfig('QDRANT_COLLECTION')!==process.env.QDRANT_COLLECTION)throw Error('Effective collection mismatch');
fs.mkdirSync(out,{recursive:true});
// Test-only dependency injection: uploaded synthetic files never enter the live
// document directory. No production source configuration is changed.
const extraction=require(path.join(root,'backend/src/rag/loaders/documentExtractionService'));
extraction.docsDir=path.join(out,'documents');fs.mkdirSync(extraction.docsDir,{recursive:true});
const docs=require(path.join(root,'backend/src/rag/services/knowledgeDocumentService'));
const {getAIResponse}=require(path.join(root,'backend/src/services/ai'));
const db=require(path.join(root,'backend/src/database/connection'));
async function main(){
 const fixtures=JSON.parse(fs.readFileSync(process.env.FUBOT_HELDOUT_SOURCE || path.join(__dirname,'heldout.json'),'utf8')),rows=[];
 for(const f of fixtures)await docs.uploadAndRegisterDocument(f.file,'text/plain',Buffer.from(f.text),{tenantId:f.tenant,overwriteAction:'replace'});
 for(let repeat=1;repeat<=3;repeat++)for(const f of fixtures)for(const [question,expected] of f.questions){
  const id=`heldout-${Date.now()}-${repeat}`,telemetry={pipelineTelemetry:{},retrievalTelemetry:{},validationTelemetry:{}};
  const answer=await getAIResponse(id,question,'text',null,{tenantId:f.tenant,channel:'isolated_shorouq_no_delivery',conversationId:id,knowledgeBaseOnly:true,...telemetry});
  const trace=db.prepare('select * from rag_request_traces where conversation_id=?').get(id);
  rows.push({tenant:f.tenant,repeat,question,expected,answer,trace,telemetry});
  fs.writeFileSync(path.join(out,'heldout-results.json'),JSON.stringify(rows,null,2));
  console.log(JSON.stringify({tenant:f.tenant,repeat,question,expected,answer}));
 }
 db.close();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
