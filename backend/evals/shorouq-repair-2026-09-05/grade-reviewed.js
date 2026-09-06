'use strict';
// Labels encode manual review of final-audit-v4, not a general-purpose grader.
const fs=require('fs'),path=require('path');
const rows=require('./live-results.json');
const expected=['18700','12900','CLARIFY kWh/kW','11800 + 350','80 standard area','180','300 with cleaning referent','300 with cleaning referent','300 with cleaning referent','120 without parts','5% eligible','not eligible','17765','26505','battery excluded','80 only paid same-visit labor >=250','no deduction','no deduction; labor 200 excludes parts','no Jenin office','Nablus + Ramallah complete','closed Friday','Saturday 15:00','13:00 until April 30; 15:00 from May 1','Saturday 15:00 with user referent','unknown live stock','catalog does not prove stock','request possible, confirmation required; no live slot','unknown tomorrow slot','service coverage does not prove availability','full refund','50% with cancellation referent','50% with cancellation referent','nonrefundable with cancellation referent','no, 50%'];
const over=new Set(['sequence:25','independent:12','independent:26','independent:28']);
const evaluated=rows.map(r=>{
 const key=`${r.phase}:${r.i}`;
 let classification=over.has(key)?'overabstain':r.gate==='CLARIFY'||r.i===2?'properclarify':r.answer.startsWith('لا تتوفر')?'properabstain':r.fallback==='verified_source_excerpt'?'verifiedexcerptcorrect':'rawcorrect';
 if(r.phase==='sequence'&&r.i===27)classification='wrongnonresponsive';
 return {phase:r.phase,index:r.i,question:r.question,expected:expected[r.i],requestId:r.requestId,raw:r.raw,answer:r.answer,classification,
  caveat:'Manual review of this frozen output only; classification describes final outcome, raw output remains separate.',
  firstFailure:over.has(key)?(r.i===28?'generation: raw abstention despite explicit denial evidence':'validation: supported raw paraphrase/calculation rejected'):
   classification==='wrongnonresponsive'?'generation: confirmation rule does not answer tomorrow availability':null};
});
fs.writeFileSync(path.join(__dirname,'reviewed-cases.json'),JSON.stringify(evaluated,null,2));
const counts={};for(const r of evaluated)counts[r.classification]=(counts[r.classification]||0)+1;
fs.writeFileSync(path.join(__dirname,'review-summary.json'),JSON.stringify({batch:'final-audit-v4',requests:rows.length,actualProviderCalls:rows.filter(r=>r.provider).length,counts,notAUniversalAccuracyScore:true},null,2));
console.log(counts);
