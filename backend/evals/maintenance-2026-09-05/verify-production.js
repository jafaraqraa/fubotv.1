const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../..'),work=process.env.FUBOT_MAINTENANCE_DIR;
const DB=require(path.join(root,'backend/node_modules/better-sqlite3'));
const env=require(path.join(root,'backend/node_modules/dotenv')).parse(fs.readFileSync(path.join(root,'backend/.env')));
const db=new DB(path.join(root,'backend/data/app.db'),{readonly:true});
const setting=k=>db.prepare('select value from settings where key=?').get(k)?.value||env[k];
async function main(){
 const headers={'Content-Type':'application/json'};if(setting('QDRANT_API_KEY'))headers['api-key']=setting('QDRANT_API_KEY');
 let offset;const points=[];
 do{const r=await fetch((setting('QDRANT_URL')||'http://127.0.0.1:6333')+'/collections/'+setting('QDRANT_COLLECTION')+'/points/scroll',{method:'POST',headers,body:JSON.stringify({limit:100,with_payload:true,with_vector:true,...(offset?{offset}:{})})});if(!r.ok)throw Error('Read-only verification HTTP '+r.status);const data=await r.json();points.push(...data.result.points);offset=data.result.next_page_offset;}while(offset);
 const before=JSON.parse(fs.readFileSync(path.join(work,'points-before.json')));
 const digest=p=>crypto.createHash('sha256').update(JSON.stringify(p.sort((a,b)=>String(a.id).localeCompare(String(b.id))))).digest('hex');
 const old=JSON.parse(fs.readFileSync(path.join(work,'production-before.json')));
 const docs=db.prepare('select document_key,tenant_id,version_id,status,chunk_count,content_hash from knowledge_documents').all();
 const unchangedDocs=docs.length===old.documents.length&&docs.every(d=>old.documents.some(o=>o.documentId===d.document_key&&o.tenantId===d.tenant_id&&o.version===d.version_id&&o.status===d.status&&o.chunkCount===d.chunk_count&&o.sourceHash===d.content_hash));
 const health=await fetch('http://127.0.0.1:'+(env.PORT||3000)+'/health');
 const result={at:new Date().toISOString(),livePoints:points.length,indexUnchanged:digest(points)===digest(before),documentsUnchanged:unchangedDocs,health:health.status,pid:348195,sameProcessPresent:fs.existsSync('/proc/348195/cwd'),cwd:fs.existsSync('/proc/348195/cwd')?fs.readlinkSync('/proc/348195/cwd'):null,productionRestarted:false,productionReindexed:false};
 fs.writeFileSync(path.join(__dirname,'production-state.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));db.close();
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
