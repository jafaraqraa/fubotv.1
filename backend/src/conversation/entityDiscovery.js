'use strict';
const {norm}=require('./entityTracker');
const TYPES=new Set(['product','service','plan','package','policy','location','department','custom']);
function validateDiscoveredCandidates({tenantId,document,candidates=[]}){if(!tenantId||document?.tenant_id!==tenantId||document.status!=='active'||!document.is_current)throw Object.assign(new Error('Unauthorized or inactive document'),{code:'CATALOG_SOURCE_REJECTED'});const text=norm(document.original_text||'');
 return candidates.filter(c=>TYPES.has(c.entity_type)&&c.canonical_name&&text.includes(norm(c.exact_source_wording||c.canonical_name))).map(c=>({...c,display_name:c.display_name||c.canonical_name,aliases:(c.aliases||[]).filter(a=>text.includes(norm(a))),authority:'informational',source_type:'knowledge',source_id:document.document_id,source_version_id:document.document_version_id,supporting_chunk_ids:(c.supporting_chunk_ids||[]).filter(id=>(document.chunk_ids||[]).includes(id)),allowed_actions:[]}));}
module.exports={validateDiscoveredCandidates};
