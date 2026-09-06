'use strict';
// Read-only production evidence capture; does not generate or send messages.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const db=require('better-sqlite3')(path.join(__dirname,'../../data/app.db'),{readonly:true});
(async()=>{
 const traces=db.prepare("SELECT * FROM rag_request_traces WHERE tenant_id='default' AND created_at BETWEEN '2026-09-05 10:33:50' AND '2026-09-05 10:36:15' ORDER BY created_at").all();
 const response=await fetch('http://localhost:6333/collections/futhing_knowledge/points/scroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filter:{must:[{key:'tenantId',match:{value:'default'}}]},limit:100,with_payload:true,with_vector:false})});
 if(!response.ok)throw new Error(`Qdrant ${response.status}`);
 const chunks=(await response.json()).result.points.map(x=>x.payload).filter(p=>p.source==='madar-equipment-rental-knowledge.md');
 const messages=db.prepare("SELECT id,role,content,created_at FROM messages WHERE conversation_id=? AND created_at BETWEEN '2026-09-05 10:33:50' AND '2026-09-05 10:36:15' ORDER BY created_at").all(traces[0].conversation_id);
 const doc=db.prepare('SELECT id,tenant_id,display_name,chunk_count,vector_count,status,storage_path FROM knowledge_documents WHERE id=25').get();
 const source=fs.readFileSync(doc.storage_path,'utf8');
 const report={capturedAt:new Date().toISOString(),method:'Persisted actual production traces + read-only live Qdrant payloads; not a new inference replay',document:doc,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),chunks,traces,messages,limitations:['Historical normalized query, expansion queries, exact prompt payload, gate input, resolved referent and standalone P0 verdict were not persisted. They cannot be asserted from these records.','Qdrant payload snapshot is current; compare contentHash suffixes against historical chunk IDs before using it.']};
 fs.writeFileSync(path.join(__dirname,'baseline-evidence.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({traces:traces.length,chunks:chunks.length,tenant:doc.tenant_id,sourceHash:report.sourceSha256}));db.close();
})().catch(e=>{console.error(e.message);process.exitCode=1});
