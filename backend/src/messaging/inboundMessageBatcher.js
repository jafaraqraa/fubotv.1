'use strict';
const pendingBatches = new Map();
function batchWindowMs() { const value=Number(process.env.AI_MESSAGE_BATCH_WINDOW_MS||1400); return Number.isFinite(value)?Math.max(0,Math.min(5000,Math.trunc(value))):1400; }
function batchKey({tenantId,channel,externalUserId}) { return `${tenantId}\u0000${channel}\u0000${externalUserId}`; }
function flush(key) { const batch=pendingBatches.get(key); if(!batch)return; pendingBatches.delete(key); const combinedText=batch.entries.map(x=>x.content.trim()).filter(Boolean).join('\n'),leader=batch.entries.length-1,messageIds=batch.entries.map(x=>x.messageId).filter(Boolean); batch.entries.forEach((entry,index)=>entry.resolve({leader:index===leader,combinedText,messageIds,count:batch.entries.length})); }
function collectTextMessage(identity,content,messageId,options={}) { const delayMs=options.delayMs===undefined?batchWindowMs():options.delayMs; if(!String(content||'').trim()||delayMs<=0)return Promise.resolve({leader:true,combinedText:String(content||'').trim(),messageIds:[messageId].filter(Boolean),count:1}); const key=batchKey(identity); return new Promise(resolve=>{let batch=pendingBatches.get(key)||{entries:[],timer:null};if(batch.timer)clearTimeout(batch.timer);batch.entries.push({content:String(content),messageId,resolve});batch.timer=setTimeout(()=>flush(key),delayMs);pendingBatches.set(key,batch);}); }
function clearPendingBatches(){for(const batch of pendingBatches.values())clearTimeout(batch.timer);pendingBatches.clear();}
module.exports={collectTextMessage,batchWindowMs,clearPendingBatches,_test:{batchKey}};
