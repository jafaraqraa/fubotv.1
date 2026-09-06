'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../../..'),out=process.env.FUBOT_EVAL_OUTPUT_DIR;
if(!out || !process.env.SQLITE_DB_PATH || fs.realpathSync(process.env.SQLITE_DB_PATH)===fs.realpathSync(path.join(root,'backend/data/app.db')) || !/^fubot_(fix|audit)_/.test(process.env.QDRANT_COLLECTION||''))throw Error('Isolation required');
require(path.join(root,'backend/node_modules/dotenv')).config({path:path.join(root,'backend/.env'),quiet:true});
const {getConfig}=require(path.join(root,'backend/src/rag/config/ragConfig'));
if(getConfig('QDRANT_COLLECTION')!==process.env.QDRANT_COLLECTION)throw Error('Effective collection mismatch');
fs.mkdirSync(out,{recursive:true});
const extraction=require(path.join(root,'backend/src/rag/loaders/documentExtractionService'));
extraction.docsDir=path.join(out,'documents');fs.mkdirSync(extraction.docsDir,{recursive:true});
const docs=require(path.join(root,'backend/src/rag/services/knowledgeDocumentService'));
const {getAIResponse}=require(path.join(root,'backend/src/services/ai'));
const db=require(path.join(root,'backend/src/database/connection'));
const questions=['قديش إيجار الحفارة الصغيرة لليوم؟','قديش إيجار الحفارة الصغيرة بالأسبوع؟','قديش مبلغ التأمين المسترد للحفارة الصغيرة؟','هل السعر اليومي للحفارة الصغيرة يشمل التأمين؟','الرافعة المقصية SL10 بقدر آخذها ليوم واحد؟','عمري 22 سنة، بقدر أستأجر الحفارة MX20 وأشغلها أنا؟','صاحبي استأجر منكم قبل، يعني أكيد إله حساب آجل صح؟',...([24,47,48].map(n=>`إذا ألغيت قبل ${n} ساعة، كم بسترد؟`)),...(['60 دقيقة','61 دقيقة','4 ساعات بالضبط','4 ساعات ودقيقة'].map(t=>`تأخرت بإرجاع المعدة ${t}، شو الرسوم؟`)),'هل MX20 متوفرة حالياً؟','وجود MX20 بالكتالوج يعني إنها متوفرة اليوم، صح؟','قديش سعر لتر الوقود؟','شو اسم شركة تأمين المعدات؟'];
async function main(){
 const tenantId='shorouq-regression-madar',rows=[];
 await docs.uploadAndRegisterDocument('Madar_Equipment.md','text/markdown',fs.readFileSync(process.env.FUBOT_MADAR_SOURCE),{tenantId,overwriteAction:'replace'});
 for(let repeat=1;repeat<=3;repeat++)for(const question of questions){
  const id=`madar-${Date.now()}-${repeat}`,telemetry={pipelineTelemetry:{},retrievalTelemetry:{},validationTelemetry:{}};
  const answer=await getAIResponse(id,question,'text',null,{tenantId,channel:'isolated_shorouq_no_delivery',conversationId:id,knowledgeBaseOnly:true,...telemetry});
  const trace=db.prepare('select * from rag_request_traces where conversation_id=?').get(id);
  rows.push({repeat,question,answer,trace,telemetry});fs.writeFileSync(path.join(out,'madar-results.json'),JSON.stringify(rows,null,2));
  console.log(JSON.stringify({repeat,question,answer}));
 }
 db.close();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
