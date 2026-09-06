const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
if(!process.env.SQLITE_DB_PATH || !process.env.FUBOT_EVAL_OUTPUT_DIR)throw Error('Isolated DB and output required');
const backend=path.resolve(__dirname,'../..'),out=process.env.FUBOT_EVAL_OUTPUT_DIR;
fs.mkdirSync(out,{recursive:true});
const commands=require('../../package.json').scripts.test.split(' && ');
const failed=commands.findIndex(c=>c==='node test/ai_pipeline.test.js');
if(failed<0)throw Error('Stopped command not found');
const results=[];
for(const [i,command] of commands.slice(failed+1).entries()){
 const r=spawnSync(command,{cwd:backend,shell:true,env:process.env,encoding:'utf8',maxBuffer:20*1024*1024,timeout:120000});
 const log=(r.stdout||'')+(r.stderr||'');fs.writeFileSync(path.join(out,`remaining-${i}.log`),log);
 results.push({command,exitCode:r.status,signal:r.signal,tests:[...log.matchAll(/^# tests (\d+)$/gm)].reduce((n,m)=>n+Number(m[1]),0),fail:[...log.matchAll(/^# fail (\d+)$/gm)].reduce((n,m)=>n+Number(m[1]),0)});
}
fs.writeFileSync(path.join(out,'remaining-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
process.exit(results.some(r=>r.exitCode!==0)?1:0);
