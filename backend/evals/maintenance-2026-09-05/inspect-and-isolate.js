'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../..'),work=process.env.FUBOT_MAINTENANCE_DIR;
if(!work||!work.startsWith('/tmp/fubot-maintenance-'))throw Error('Explicit isolated directory required');
const DB=require(path.join(root,'backend/node_modules/better-sqlite3'));
const env=require(path.join(root,'backend/node_modules/dotenv')).parse(fs.readFileSync(path.join(root,'backend/.env')));
Object.assign(process.env,env);
const live=new DB(path.join(root,'backend/data/app.db'),{readonly:true});
const settings=Object.fromEntries(live.prepare('select key,value from settings').all().map(r=>[r.key,r.value]));
const get=k=>settings[k]||env[k];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function manifest(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?manifest(path.join(dir,e.name)):[{file:path.relative(root,path.join(dir,e.name)),sha256:sha(fs.readFileSync(path.join(dir,e.name)))}]);}
async function main(){
 const target='fubot_audit_maintenance_wY5Gse';
 const url=get('QDRANT_URL')||'http://127.0.0.1:6333',collection=get('QDRANT_COLLECTION')||'futhing_knowledge';
 const headers={'Content-Type':'application/json'};if(get('QDRANT_API_KEY'))headers['api-key']=get('QDRANT_API_KEY');
 async function call(endpoint,method='GET',body){const r=await fetch(url+endpoint,{method,headers,body:body&&JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Qdrant HTTP '+r.status);return r.json();}
 const info=await call('/collections/'+collection);let offset;const points=[];
 do{const r=await call('/collections/'+collection+'/points/scroll','POST',{limit:100,with_vector:true,with_payload:true,...(offset?{offset}:{})});points.push(...r.result.points);offset=r.result.next_page_offset;}while(offset);
 const docs=live.prepare('select * from knowledge_documents').all();
 const evidence=docs.map(d=>({documentId:d.document_key,tenantId:d.tenant_id,status:d.status,active:d.is_active,version:d.version_id,chunkCount:d.chunk_count,indexedAt:d.indexed_at,sourceHash:d.content_hash,actualHash:d.storage_path&&fs.existsSync(d.storage_path)?sha(fs.readFileSync(d.storage_path)):null,embeddingModel:d.embedding_model,dimension:d.vector_dimension}));
 const task=live.prepare("select task,provider,model,api_key_ref,enabled from ai_task_configs where task='text_generation'").get();
 let budget={status:'NOT_RUN'};
 if(task?.provider==='openrouter'){
  const registered=live.prepare("select api_key from api_keys where lower(provider)='openrouter' and enabled=1 order by created_at desc limit 1").get();
  const key=registered?.api_key?require(path.join(root,'backend/src/security/credentialCrypto')).decryptSecret(registered.api_key):get(task.api_key_ref);
  if(key){try{const r=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});const data=await r.json();budget={httpStatus:r.status,limit:data.data?.limit,remaining:data.data?.limit_remaining};}catch(e){budget={status:'UNAVAILABLE',reason:e.name};}}
 }
 const summary={at:new Date().toISOString(),root,code:manifest(path.join(root,'backend/src')),settings:Object.fromEntries(Object.entries(settings).filter(([k])=>/^(RAG_|QDRANT_COLLECTION$|AI_MODEL$|AI_PROVIDER$)/.test(k)&&!/(?:API_KEY|PASSWORD|SECRET|TOKEN)/.test(k))),task:{...task,api_key_ref:undefined},budget,documents:evidence,livePointCount:points.length,traceColumn:live.prepare('pragma table_info(rag_request_traces)').all().some(c=>c.name==='reliability_json'),integrity:live.pragma('quick_check')};
 fs.writeFileSync(path.join(work,'production-before.json'),JSON.stringify(summary,null,2));
 fs.writeFileSync(path.join(work,'points-before.json'),JSON.stringify(points));
 const existing=await fetch(url+'/collections/'+target,{headers});if(existing.status!==404)throw Error('Refusing to overwrite existing audit collection');
 await live.backup(path.join(work,'eval.sqlite'));
 const db=new DB(path.join(work,'eval.sqlite'));db.prepare('update settings set value=? where key=?').run(target,'QDRANT_COLLECTION');db.close();
 await call('/collections/'+target,'PUT',{vectors:info.result.config.params.vectors});
 await call('/collections/'+target+'/points?wait=true','PUT',{points});
 console.log(JSON.stringify({collection:target,points:points.length,docs:evidence.length,budget,model:task?.model,traceColumn:summary.traceColumn}));live.close();
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
