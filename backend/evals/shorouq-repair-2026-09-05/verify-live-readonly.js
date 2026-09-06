'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../..');
const Database=require(path.join(root,'backend/node_modules/better-sqlite3'));
const dotenv=require(path.join(root,'backend/node_modules/dotenv'));
const env=dotenv.parse(fs.readFileSync(path.join(root,'backend/.env')));
const db=new Database(path.join(root,'backend/data/app.db'),{readonly:true});
const config=k=>db.prepare('select value from settings where key=?').get(k)?.value || env[k];
const sha=d=>crypto.createHash('sha256').update(d).digest('hex');
async function main(){
 const documentId='doc_b1bbceecf84e417aa20015f12379707f';
 const document=db.prepare('select document_key,version_id,content_hash,indexed_at,chunk_count,status,is_active,storage_path from knowledge_documents where document_key=?').get(documentId);
 const headers={'Content-Type':'application/json'};if(config('QDRANT_API_KEY'))headers['api-key']=config('QDRANT_API_KEY');
 const url=`${config('QDRANT_URL')||'http://127.0.0.1:6333'}/collections/${config('QDRANT_COLLECTION')||'futhing_knowledge'}/points/scroll`;
 const res=await fetch(url,{method:'POST',headers,body:JSON.stringify({filter:{must:[{key:'tenantId',match:{value:'default'}},{key:'documentId',match:{value:documentId}}]},limit:100,with_payload:true,with_vector:false})});
 if(!res.ok)throw Error(`Read-only scroll HTTP ${res.status}`);
 const points=(await res.json()).result.points;
 const before=JSON.parse(fs.readFileSync(path.join(process.env.FUBOT_EVAL_OUTPUT_DIR,'points-before.json')));
 const key=p=>JSON.stringify([p.id,p.payload.chunkId,p.payload.contentHash,p.payload.text,p.payload.documentVersionId]);
 const unchanged=JSON.stringify(points.map(key).sort())===JSON.stringify(before.map(key).sort());
 const result={checkedAt:new Date().toISOString(),document:{...document,storage_path:undefined},originalHashMatches:sha(fs.readFileSync(document.storage_path))===document.content_hash,
  liveIndexUnchanged:unchanged,livePoints:points.length,traceMetadataColumn:db.prepare('pragma table_info(rag_request_traces)').all().some(c=>c.name==='reliability_json'),
  systemPromptHash:sha(fs.readFileSync(path.join(root,'backend/system_prompt.txt'))),
  runtimePid:200339,runtimeCwd:fs.existsSync('/proc/200339/cwd')?fs.readlinkSync('/proc/200339/cwd'):null,
  deployment:'NOT_RESTARTED_NOT_REINDEXED',newSourceLoadedInProduction:'NO; service process predates modified cached modules'};
 fs.writeFileSync(path.join(__dirname,'live-state.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));db.close();
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
