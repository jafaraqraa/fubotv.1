'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const crypto=require('crypto');
const DIR=__dirname;const {build,fingerprint,EXPECTED_V1_SHA}=require('./repair-corpus-v2');const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(path.join(DIR,name),'utf8'));
const dev=read('semantic-validator-gold-v2.json'),unseen=read('semantic-validator-unseen-v2.json');
const dm=read('semantic-validator-gold-v2-manifest.json'),um=read('semantic-validator-unseen-v2-manifest.json');
test('original V1 was not mutated',()=>assert.equal(sha(fs.readFileSync(path.join(DIR,'gold-corpus-v1.json'))),EXPECTED_V1_SHA));
for(const corpus of [dev,unseen]){
 test(`${corpus.split}: IDs and fingerprints are unique`,()=>{assert.equal(new Set(corpus.rows.map(r=>r.id)).size,corpus.rows.length);assert.equal(new Set(corpus.rows.map(r=>r.contentFingerprint)).size,corpus.rows.length);});
 test(`${corpus.split}: required fields and label enum`,()=>{for(const r of corpus.rows){for(const k of ['id','legacyIds','tenantId','question','claim','evidence','evidenceIds','expectedVerdict','categories','sourceDataset','contentFingerprint'])assert.notEqual(r[k],undefined);assert.ok(['SUPPORTED','CONTRADICTED','NOT_PROVEN'].includes(r.expectedVerdict));assert.equal(r.contentFingerprint,fingerprint({...r,tenant:r.tenantId}));}});
 test(`${corpus.split}: evidence structure and tenant controls`,()=>{for(const r of corpus.rows){assert.ok(r.evidence.length);assert.ok(r.evidenceIds.length);assert.ok(r.evidenceIds.every(id=>r.evidence.some(e=>e.id===id)));const foreign=r.evidence.some(e=>e.tenantId!==r.tenantId);assert.equal(foreign,r.categories.includes('cross-tenant-controls'));}});
 test(`${corpus.split}: no undocumented intentional duplicate`,()=>{for(const r of corpus.rows)if(r.duplicateType==='intentional_control'){assert.ok(r.duplicateGroupId);assert.ok(r.duplicateReason);}});
 test(`${corpus.split}: IDs are content deterministic`,()=>{for(const r of corpus.rows)assert.ok(r.id.endsWith(r.contentFingerprint.slice(0,16)));});
}
test('DEV and unseen are isolated',()=>{assert.ok(dev.rows.every(r=>r.tenantId!=='unseen-sourdough'&&r.sourceDataset!=='unseen-sourdough-frozen-v1'));assert.ok(unseen.rows.every(r=>r.tenantId==='unseen-sourdough'&&r.sourceDataset==='unseen-sourdough-frozen-v1'));const d=new Set(dev.rows.map(r=>r.contentFingerprint));assert.equal(unseen.rows.filter(r=>d.has(r.contentFingerprint)).length,0);});
test('manifest hashes and counts match files',()=>{for(const [file,m,corpus] of [['semantic-validator-gold-v2.json',dm,dev],['semantic-validator-unseen-v2.json',um,unseen]]){assert.equal(sha(fs.readFileSync(path.join(DIR,file))),m.corpusFileSha256);assert.equal(m.rowCount,corpus.rows.length);assert.equal(m.uniqueIdCount,m.rowCount);assert.equal(m.uniqueFingerprintCount,m.rowCount);assert.equal(m.evidenceIntegrityFailures.length,0);assert.equal(m.crossSplitDuplicateCount,0);}});
test('rebuild is byte deterministic and matches materialized files',()=>{const a=build(),b=build();assert.deepEqual(a,b);for(const [name,text] of Object.entries(a.files))assert.equal(fs.readFileSync(path.join(DIR,name),'utf8'),text);});
test('builder output allowlist contains dataset artifacts only',()=>assert.deepEqual(Object.keys(build().files).sort(),['semantic-validator-gold-v2-manifest.json','semantic-validator-gold-v2.json','semantic-validator-unseen-v2-manifest.json','semantic-validator-unseen-v2.json']));
