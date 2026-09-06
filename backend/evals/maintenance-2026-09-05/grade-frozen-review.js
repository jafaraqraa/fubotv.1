'use strict';
// Records human/model-assisted manual review of these exact frozen answers.
// NOT an automatic grader and NOT reusable as a live-generation substitute.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hashes={shorouq:'ac5092857d754538be46cb84851b0935e915e856751d77a0192fb10ede58fcf5',boundaries:'980d33d02f119b1f1c12c971ece74607e737cdd5d7b3369528e1fafe1e4b8c52',heldout:'1f4f8f00af9209e375941efcc4127ff2b7ff7c61a8b357140bffc62c41af4b7c','new-sectors':'a8634cb7b404a5da4376c453bcde02dba4398a7592a9430b121fc137af7d5472',madar:'ab353efcec7b60c9f7fb570d33e708495b874d28a8a22891878951b202476548'};
const shorouq=['18700 ILS base','12900 ILS base','CLARIFY kWh/kW','11800 ILS + 350 ILS existing-system installation','80 ILS standard area','180 ILS','300 ILS with cleaning referent','300 ILS with cleaning referent','300 ILS with cleaning referent','120 ILS without parts','eligible 5% base only','not eligible','17765 ILS','26505 ILS','battery excluded','80 deduction only paid same-visit labor >=250; parts excluded','249 no deduction','labor 200 excludes parts; no deduction','no current Jenin office','Nablus + Ramallah complete list','Nablus Friday closed','Ramallah Saturday 09:00–15:00','13:00 until 2026-04-30; 15:00 from 2026-05-01','15:00 with office referent','live stock unknown','catalog does not prove stock','live schedule unknown; request not confirmed booking','tomorrow schedule unknown; no booking/action promise','coverage does not prove today availability','8 days full refund','7 days 50%','3 days 50%','2 days nonrefundable','6 days 50%, not full'];
const boundaryExpected=require('../shorouq-repair-2026-09-05/boundaries.json').map(x=>x.expected);
const madar=['420 ILS daily','2450 ILS weekly','1500 ILS refundable deposit','price excludes deposit','SL10 minimum 2 days','renter >=21; operator >=23; 22 does not satisfy operator rule','prior rental not automatic credit; prior approval','24h 50%','47h 50%','48h inclusive 50%','60min inclusive no fee','61min 50% daily','4h inclusive 50% daily','4h01 full extra day','live stock unknown','catalog not proof of stock','no fixed fuel price; actual return cost','insurer name unknown'];
const labels=['rawcorrect','verifiedexcerptcorrect','properclarify','properabstain','overabstain','wrongnonresponsive','providerfailure'];
const counts=()=>Object.fromEntries(labels.map(x=>[x,0]));
const all=[],batches=[],total=counts();
for(const [name,digest] of Object.entries(hashes)){
 const bytes=fs.readFileSync(path.join(__dirname,`final-${name}.json`));
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('Unreviewed output changed: '+name);
 const rows=JSON.parse(bytes),summary={batch:'signoff-'+name,requests:rows.length,counts:counts(),providerOutputsInTrace:rows.filter(r=>r.raw).length,directlyCapturedProviderCalls:rows.reduce((s,r)=>s+(r.captures||[]).filter(x=>x.stage==='actual_provider').length,0)};
 for(const [i,r] of rows.entries()){
  const unknown=name==='shorouq'&&[24,27].includes(r.index)||name==='boundaries'&&r.index===3||name==='madar'&&[14,17].includes(i%18);
  const clarify=r.gate==='CLARIFY'||name==='shorouq'&&r.index===2;
  const classification=r.error?'providerfailure':clarify?'properclarify':r.fallback==='verified_source_excerpt'?'verifiedexcerptcorrect':unknown?'properabstain':/^لا تتوفر/u.test(r.answer||'')?'overabstain':'rawcorrect';
  let expected=name==='shorouq'?shorouq[r.index]:name==='boundaries'?boundaryExpected[r.index]:name==='madar'?madar[i%18]:r.expected;
  if(clarify&&name==='shorouq'&&r.index!==2)expected='CLARIFY: no user referent in independent request; '+expected;
  let firstFailure=null;
  if(classification==='verifiedexcerptcorrect'){
   firstFailure=name==='shorouq'&&r.index===15?'generation: paid same-visit condition omitted':
    name==='shorouq'&&r.index===22?'generation: requested history omitted despite selected evidence':
    name==='shorouq'&&r.index===26?'generation: confirmation rule alone does not answer live slot availability':
    name==='madar'&&i%18===7?'generation: 24-hour inclusive refund boundary answered incorrectly':
    'validation: raw paraphrase not fully supported; final repaired by verified source excerpt';
  }
  all.push({batch:summary.batch,phase:r.phase,index:r.index??i%18,tenant:r.tenant,requestId:r.requestId,question:r.question,expected,raw:r.raw,answer:r.answer,classification,fallback:r.fallback,rawValidation:r.telemetry?.pipelineTelemetry?.rawValidation,firstFailure,
   note:'Manual review of frozen final outcome only. Verified excerpt is not raw-model success. Full source IDs, post-budget traces and captures are in the corresponding final-*.json.'});
  summary.counts[classification]++;total[classification]++;
 }
 batches.push(summary);
}
fs.writeFileSync(path.join(__dirname,'reviewed-cases.json'),JSON.stringify(all,null,2));
const result={batches,requests:all.length,counts:total,inputHashes:hashes,notAUniversalAccuracyScore:true,providerOutputsInTrace:batches.reduce((s,b)=>s+b.providerOutputsInTrace,0),directlyCapturedProviderCalls:batches.reduce((s,b)=>s+b.directlyCapturedProviderCalls,0)};
fs.writeFileSync(path.join(__dirname,'review-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
