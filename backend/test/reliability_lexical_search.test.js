const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SQLITE_DB_PATH = ':memory:';
process.env.RAG_RETRY_MAX_ATTEMPTS = '1';
const { searchLexicalPoints } = require('../src/rag/vector/qdrantVectorStore');
const { rerankCandidates } = require('../src/rag/services/rerankingService');
test('independent lexical request retains tenant, lifecycle, version and media restrictions', async () => {
 const original = global.fetch;
 const base = { must:[{key:'embeddingModel',match:{value:'model'}}], must_not:[{key:'lifecycle',match:{value:'staging'}}], should:[{key:'indexVersionId',match:{value:'v2'}}] };
 try {
  global.fetch=async(url,options)=>{
   assert.match(url,/points\/scroll$/);
   const body=JSON.parse(options.body);
   assert.deepEqual(body.filter.must[0],{key:'tenantId',match:{value:'tenant-a'}});
   assert.deepEqual(body.filter.must[1],base);
   assert.equal(body.filter.must[2].should[0].match.text,'ZX55');
   assert.equal(body.with_vector,false);
   return {ok:true,status:200,json:async()=>({result:{points:[{id:'lexical-only',payload:{tenantId:'tenant-a'}},{id:'foreign',payload:{tenantId:'tenant-b'}}]}})};
  };
  const result=await searchLexicalPoints('tenant-a',base,['ZX55']);
  assert.deepEqual(result.map(p=>p.id),['lexical-only']);
 } finally {global.fetch=original;}
});
test('a lexical candidate survives semantic filtering without a fabricated vector score',()=>{
 const candidates=[{chunkId:'lexical',text:'ZX55 weekly price 1800',semanticScore:0,keywordScore:.8,finalScore:.8,lexicalMatch:true}];
 const ranked=rerankCandidates(candidates,'ZX55 weekly price',5,.4);
 assert.equal(ranked.length,1);assert.equal(ranked[0].semanticScore,0);
});
