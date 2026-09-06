const test=require('node:test');
const assert=require('node:assert/strict');
const {validateDetailed}=require('../src/rag/intelligence/answerValidator');
const {applyGroundingSafetyBoundary}=require('../src/rag/security/groundingSafetyBoundary');
// Held-out synthetic companies: deterministic cell/tenant checks, no claim of
// measured model accuracy, live retrieval, or production replay.
for(const [sector,code,price] of [['clinic','C17',275],['bakery','B32',95],['electronics','E91',860],['ceramics','P74',185]]){
 test(`${sector}: correct cell passes; changed value and foreign tenant fail`,()=>{
  const tenantId=`heldout-${sector}`;
  const evidence=[{id:`${sector}-table`,tenantId,text:`| المنتج | السعر شيكل |\n|---|---|\n| ${code} | ${price} |`,retrievalScore:.9}];
  const question=`كم سعر ${code}؟`;
  const answer=`سعر ${code} ${price} شيكل.`;
  const validation=validateDetailed(answer,evidence,{question,tenantId});
  assert.equal(validation.overallStatus,'SUPPORTED');
  assert.notEqual(validateDetailed(`سعر ${code} ${price+10} شيكل.`,evidence,{question,tenantId}).overallStatus,'SUPPORTED');
  const input={answer,question,validation,serverEvidence:evidence,route:'COMPANY_KNOWLEDGE',tenantId,shadowMode:false,enforcementActive:true};
  assert.equal(applyGroundingSafetyBoundary(input).decision,'ALLOW');
  assert.equal(applyGroundingSafetyBoundary({...input,tenantId:'foreign-tenant'}).decision,'BLOCK');
 });
}
