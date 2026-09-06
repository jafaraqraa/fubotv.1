'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../../..'),work=process.env.FUBOT_MAINTENANCE_DIR;
if(!work||process.env.SQLITE_DB_PATH!==path.join(work,'eval.sqlite')||process.env.QDRANT_COLLECTION!=='fubot_audit_maintenance_wY5Gse')throw Error('Isolated environment required');
require(path.join(root,'backend/node_modules/dotenv')).config({path:path.join(root,'backend/.env'),quiet:true});
const {getConfig}=require(path.join(root,'backend/src/rag/config/ragConfig'));
if(getConfig('QDRANT_COLLECTION')!==process.env.QDRANT_COLLECTION)throw Error('Collection override mismatch');
const db=require(path.join(root,'backend/src/database/connection'));
const cache=require(path.join(root,'backend/src/rag/cache/retrievalCache'));
const hybrid=require(path.join(root,'backend/src/rag/services/hybridRetrievalService'));
async function main(){
 const context={tenantId:'default'},query='قديش سعر نظام Home 5K؟';
 cache.resetForTests();hybrid.embeddingsCache.clear();
 const cold=await hybrid.retrieveHybridContext(query,null,context);
 const warm=await hybrid.retrieveHybridContext(query,null,context);
 assert.equal(cold.metadata.embeddingCacheHit,false);assert.equal(warm.metadata.cacheHit,true);assert.equal(warm.metadata.embeddingCacheChecked,false);
 cache.invalidate({tenantId:'default',collection:getConfig('QDRANT_COLLECTION'),reason:'isolated-cache-check'});
 const embeddingWarm=await hybrid.retrieveHybridContext(query,null,context);
 assert.equal(embeddingWarm.metadata.embeddingCacheHit,true);assert.equal(embeddingWarm.metadata.cacheHit,false);
 const other=await hybrid.retrieveHybridContext(query,null,{tenantId:'audit-no-knowledge'});assert.equal(other.candidates.length,0);
 const points=JSON.parse(fs.readFileSync(path.join(work,'points-before.json'))),snapshot=JSON.parse(fs.readFileSync(path.join(work,'production-before.json')));
 const plan=points.map(p=>{
  const v=p.payload||{},d=snapshot.documents.find(d=>d.documentId===v.documentId&&d.tenantId===v.tenantId);
  const activeManual=v.sourceType==='knowledge_txt'&&db.prepare('select 1 from rag_index_versions where tenant_id=? and index_version_id=? and is_active=1').get(v.tenantId,v.indexVersionId);
  const ownershipProven=!!d&&d.active===1&&d.status==='active'&&d.version===v.documentVersionId&&d.sourceHash===d.actualHash;
  return {id:p.id,tenantId:v.tenantId,documentId:v.documentId,version:v.documentVersionId,
   action:!v.tenantId?'LEAVE_UNOWNED_EXCLUDED':activeManual?'ACTIVE_MANUAL_NO_CHANGE':!d?'LEAVE_UNMATCHED_REVIEW':ownershipProven&&!v.lifecycle?'ISOLATED_SET_ACTIVE':'NO_CHANGE',
   proof:ownershipProven?'SQLite active tenant/document/version + source SHA256':null};
 });
 const patched=points.map(p=>plan.find(x=>x.id===p.id).action==='ISOLATED_SET_ACTIVE'?{...p,payload:{...p.payload,lifecycle:'active'}}:p);
 const beforeOwned=points.filter(p=>p.payload?.tenantId&&p.payload.sourceType==='uploaded_document');
 const afterOwned=patched.filter(p=>p.payload?.tenantId&&p.payload.sourceType==='uploaded_document');
 const strictBefore=beforeOwned.filter(p=>p.payload.lifecycle==='active').length,strictAfter=afterOwned.filter(p=>p.payload.lifecycle==='active').length;
 const headers={'Content-Type':'application/json'};if(getConfig('QDRANT_API_KEY'))headers['api-key']=getConfig('QDRANT_API_KEY');
 const url=getConfig('QDRANT_URL')+'/collections/'+getConfig('QDRANT_COLLECTION');
 const r=await fetch(url+'/points?wait=true',{method:'PUT',headers,body:JSON.stringify({points:patched})});assert.ok(r.ok);
 const metadataUpdates=[];
 for(const d of snapshot.documents){
   const owned=patched.filter(p=>p.payload?.tenantId===d.tenantId&&p.payload.documentId===d.documentId&&p.payload.documentVersionId===d.version);
   const models=new Set(owned.map(p=>p.payload.embeddingModel)),dimensions=new Set(owned.map(p=>p.payload.vectorDimension));
   if(d.sourceHash===d.actualHash&&d.active===1&&owned.length===d.chunkCount&&models.size===1&&dimensions.size===1&&[...models][0]&&[...dimensions][0]){
    db.prepare('update knowledge_documents set embedding_model=?,vector_dimension=? where document_key=? and tenant_id=? and version_id=?').run([...models][0],[...dimensions][0],d.documentId,d.tenantId,d.version);
    metadataUpdates.push({tenant:d.tenantId,document:d.documentId,model:[...models][0],dimension:[...dimensions][0],proof:'matching source hash, tenant/version, all point model/dimensions and exact count'});
   }
 }
 cache.invalidate({tenantId:'default',collection:getConfig('QDRANT_COLLECTION'),reason:'isolated-reconciliation'});
 const reconciled=await hybrid.retrieveHybridContext(query,null,context);
 assert.deepEqual(reconciled.candidates.map(c=>c.chunkId).sort(),embeddingWarm.candidates.map(c=>c.chunkId).sort());
 const results={cold:cold.metadata,warm:warm.metadata,embeddingWarm:embeddingWarm.metadata,metrics:cache.getMetrics(),otherTenantCandidates:other.candidates.length,plan,metadataUpdates,strictActiveImpact:{uploaded:beforeOwned.length,before:strictBefore,after:strictAfter},retrievalPreserved:true};
 fs.writeFileSync(path.join(work,'cache-reconciliation.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({cold:cold.metadata,warm:warm.metadata,strictActiveImpact:results.strictActiveImpact,unowned:plan.filter(x=>x.action==='LEAVE_UNOWNED_EXCLUDED').length}));db.close();
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
