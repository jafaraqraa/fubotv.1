'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'../../..'),work='/tmp/fubot-maintenance-wY5Gse',baseline=path.join(work,'false-fallback-baseline');
fs.rmSync(baseline,{recursive:true,force:true});fs.mkdirSync(baseline,{recursive:true});let r=spawnSync('tar',['-xzf',path.join(work,'source-before.tgz'),'-C',baseline]);if(r.status)throw Error('baseline extract failed');
r=spawnSync('git',['apply',path.join(root,'backend/evals/maintenance-2026-09-05/repair.patch')],{cwd:baseline});if(r.status)throw Error(String(r.stderr));
const files=['backend/src/rag/intelligence/derivedClaimValidator.js','backend/src/rag/intelligence/answerValidator.js','backend/src/rag/intelligence/numericIdentity.js','backend/test/false_fallback_derived_total.test.js','backend/evals/maintenance-2026-09-05/trace-false-fallback.js'];
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),changes=[];let patch='';
for(const rel of files){const current=path.join(root,rel),old=path.join(baseline,rel);changes.push({file:rel,before:fs.existsSync(old)?sha(old):null,after:sha(current)});patch+=spawnSync('diff',['-u','--label','a/'+rel,'--label','b/'+rel,fs.existsSync(old)?old:'/dev/null',current],{encoding:'utf8'}).stdout||'';}
fs.writeFileSync(path.join(__dirname,'changed-files.json'),JSON.stringify(changes,null,2));fs.writeFileSync(path.join(__dirname,'repair.patch'),patch);
for(const name of ['false-fallback-before.json','false-fallback-after-2.json','false-fallback-signoff.json'])fs.copyFileSync(path.join(work,name),path.join(__dirname,name));
const logs=['false-fallback-targeted-1.log','false-fallback-targeted-2.log','false-fallback-targeted-3.log','false-fallback-adversarial-final.log','false-fallback-safety-final.log','final-rel.log','final-full.log'];
const results=logs.map(log=>{const t=fs.readFileSync(path.join(work,log),'utf8'),sum=k=>[...t.matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))].reduce((s,m)=>s+Number(m[1]),0);return {log,tests:sum('tests'),pass:sum('pass'),fail:sum('fail'),exit:sum('fail')?1:0};});
fs.writeFileSync(path.join(__dirname,'test-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({changes,results}));
