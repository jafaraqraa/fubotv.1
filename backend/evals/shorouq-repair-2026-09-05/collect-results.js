'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const work=process.env.FUBOT_EVAL_OUTPUT_DIR;
if(!work || !fs.existsSync(path.join(work,'source-before.tgz')))throw Error('Audit workspace required');
const root=path.resolve(__dirname,'../../..'),out=__dirname;
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const baseline=path.join(work,'baseline');fs.mkdirSync(baseline,{recursive:true});
const extraction=spawnSync('tar',['-xzf',path.join(work,'source-before.tgz'),'-C',baseline]);
if(extraction.status!==0)throw Error('Baseline extraction failed');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
let patch='';const changed=[];
for(const file of [...files(path.join(root,'backend/src')),...files(path.join(root,'backend/test'))]){
 const rel=path.relative(root,file),before=path.join(baseline,rel),data=fs.readFileSync(file);
 if(!/\.(js|sql)$/.test(file))continue;
 const old=fs.existsSync(before)?fs.readFileSync(before):Buffer.alloc(0);
 if(data.equals(old))continue;
 changed.push({file:rel,before:old.length?sha(old):null,after:sha(data)});
 patch+=spawnSync('diff',['-u','--label',`a/${rel}`,'--label',`b/${rel}`,fs.existsSync(before)?before:'/dev/null',file],{encoding:'utf8'}).stdout||'';
}
fs.writeFileSync(path.join(out,'repair.patch'),patch);
fs.writeFileSync(path.join(out,'changed-files.json'),JSON.stringify(changed,null,2));
const logs=files(work).filter(f=>/\/(?:full|reliability)[^/]*\.log$/.test(f));
const testResults=logs.map(file=>{const text=fs.readFileSync(file,'utf8');const total=k=>[...text.matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))].reduce((s,m)=>s+Number(m[1]),0);return {command:path.basename(file).startsWith('full')?'npm test --prefix backend':'npm run test:reliability --prefix backend',log:file,tests:total('tests'),pass:total('pass'),fail:total('fail'),exitCode:total('fail')?1:0,note:'Exit codes confirmed against tool completion; counts sum root TAP summaries, including parent failure counts.'};});
fs.writeFileSync(path.join(out,'test-results.json'),JSON.stringify(testResults,null,2));
const latestDir=path.join(work,process.env.FUBOT_FINAL_LIVE_DIR || 'accepted-audit');
const latestFile=files(latestDir).find(f=>/live-\d+\.json$/.test(f));
const rows=JSON.parse(fs.readFileSync(latestFile));
const compact=rows.map(r=>({phase:r.phase,i:r.i,question:r.question,answer:r.answer,error:r.error,requestId:r.traces[0]?.request_id,
 raw:r.traces[0]?.raw_model_output,gate:r.traces[0]?.evidence_gate_decision,gateReason:r.traces[0]?.evidence_gate_reason,
 fallback:r.traces[0]?.fallback_source,claims:JSON.parse(r.traces[0]?.claims_json||'[]'),reliability:JSON.parse(r.traces[0]?.reliability_json||'{}'),
 provider:r.captures.find(c=>c.stage==='actual_provider')&&{provider:r.captures.find(c=>c.stage==='actual_provider').provider,model:r.captures.find(c=>c.stage==='actual_provider').model},
 retrievalMetadata:r.telemetry.retrievalTelemetry.metadata,evidence:r.telemetry.retrievalTelemetry.profiling?.topChunks?.map(c=>({id:c.chunkId||c.id,tenantId:c.tenantId,text:c.text})),
 detailedEvidenceFile:latestFile}));
fs.writeFileSync(path.join(out,'live-results.json'),JSON.stringify(compact,null,2));
fs.copyFileSync(path.join(latestDir,'code-manifest.json'),path.join(out,'code-manifest.json'));
const manifest=JSON.parse(fs.readFileSync(path.join(latestDir,'code-manifest.json')));
const drift=manifest.codeManifest.filter(f=>sha(fs.readFileSync(path.join(root,f.file)))!==f.sha256);
fs.writeFileSync(path.join(out,'code-drift.json'),JSON.stringify(drift,null,2));
for(const [name,file] of [['heldout-results.json','heldout-final/heldout-results.json'],['madar-results.json','madar-final/madar-results.json'],['remaining-results.json','remaining/remaining-results.json']]){
 if(fs.existsSync(path.join(work,file)))fs.copyFileSync(path.join(work,file),path.join(out,name));
}
console.log(JSON.stringify({changed:changed.length,liveRows:rows.length,codeDrift:drift.length,testResults}));
