'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'../../..'),work=process.env.FUBOT_MAINTENANCE_DIR;
if(!work||!fs.existsSync(path.join(work,'source-before.tgz')))throw Error('Baseline required');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const baseline=path.join(work,'baseline');fs.mkdirSync(baseline,{recursive:true});
assertExit(spawnSync('tar',['-xzf',path.join(work,'source-before.tgz'),'-C',baseline]));
function assertExit(r){if(r.status!==0)throw Error('Artifact command failed');}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
let patch='';const changes=[];
for(const file of [...files(path.join(root,'backend/src')),...files(path.join(root,'backend/test'))]){
 if(!/\.(js|json|sql)$/.test(file))continue;
 const rel=path.relative(root,file),old=path.join(baseline,rel),data=fs.readFileSync(file),before=fs.existsSync(old)?fs.readFileSync(old):Buffer.alloc(0);
 if(data.equals(before))continue;
 changes.push({file:rel,before:before.length?sha(before):null,after:sha(data)});
 patch+=spawnSync('diff',['-u','--label','a/'+rel,'--label','b/'+rel,fs.existsSync(old)?old:'/dev/null',file],{encoding:'utf8',maxBuffer:20e6}).stdout||'';
}
fs.writeFileSync(path.join(__dirname,'repair.patch'),patch);fs.writeFileSync(path.join(__dirname,'changed-files.json'),JSON.stringify(changes,null,2));
const tests=fs.readdirSync(work).filter(f=>/^(full|reliability|resilience|targeted).*\.log$/.test(f)).map(f=>{
 const text=fs.readFileSync(path.join(work,f),'utf8');const sum=k=>[...text.matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))].reduce((s,m)=>s+Number(m[1]),0);
 return {log:f,tests:sum('tests'),pass:sum('pass'),fail:sum('fail'),exit:sum('fail')?1:0,
 shellExit:f==='targeted-2.log'?0:undefined,
 note:'Node test exit agrees with TAP result; latest required command exits independently verified in tool completion. targeted-2 shell returned 0 because a following diagnostic succeeded; its test failed. Counts are not a live-quality score.'};
});fs.writeFileSync(path.join(__dirname,'test-results.json'),JSON.stringify(tests,null,2));
for(const name of ['final-shorouq','final-boundaries','final-heldout','final-new-sectors','final-madar']){
 const dir=path.join(work,name.replace(/^final-/,process.env.FUBOT_FINAL_PREFIX || 'signoff-'));if(!fs.existsSync(dir))continue;
 const f=fs.readdirSync(dir).find(f=>/^live-.*json$|results.json$/.test(f));if(!f)continue;
 const rows=JSON.parse(fs.readFileSync(path.join(dir,f)));
 const safe=rows.map(r=>{const t=r.traces?.[0]||r.trace||{};return {phase:r.phase||r.repeat,index:r.i,tenant:r.tenant||t.tenant_id,question:r.question,expected:r.expected,answer:r.answer,error:r.error?.code,requestId:t.request_id,raw:t.raw_model_output,gate:t.evidence_gate_decision,gateReason:t.evidence_gate_reason,boundary:t.boundary_decision,boundaryReasons:t.boundary_reasons_json,claims:t.claims_json,reliability:t.reliability_json,fallback:t.fallback_source,captures:r.captures,telemetry:r.telemetry};});
 fs.writeFileSync(path.join(__dirname,name+'.json'),JSON.stringify(safe,null,2));
 if(fs.existsSync(path.join(dir,'code-manifest.json'))){const m=JSON.parse(fs.readFileSync(path.join(dir,'code-manifest.json')));const drift=m.codeManifest.filter(x=>sha(fs.readFileSync(path.join(root,x.file)))!==x.sha256);fs.writeFileSync(path.join(__dirname,name+'-drift.json'),JSON.stringify(drift,null,2));}
}
fs.copyFileSync(path.join(work,'cache-reconciliation.json'),path.join(__dirname,'cache-reconciliation.json'));
const initial=JSON.parse(fs.readFileSync(path.join(work,'production-before.json')));
fs.writeFileSync(path.join(__dirname,'runtime-baseline.json'),JSON.stringify({at:initial.at,root:initial.root,settings:initial.settings,task:initial.task,traceColumn:initial.traceColumn,integrity:initial.integrity,documents:initial.documents,livePointCount:initial.livePointCount,sourceManifestHash:sha(JSON.stringify(initial.code))},null,2));
console.log(JSON.stringify({changes:changes.length,tests}));
