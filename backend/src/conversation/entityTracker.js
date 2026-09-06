'use strict';
const crypto = require('crypto');

function norm(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[إأآٱ]/g,'ا').replace(/ى/g,'ي').replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
function id(name, type) { return crypto.createHash('sha256').update(`${type}\0${norm(name)}`).digest('hex').slice(0,24); }
function candidateMatch(message, candidate) {
    const hay = ` ${norm(message)} `; return [candidate.canonical_name, candidate.display_name, ...(candidate.aliases || [])]
        .some(alias => alias && hay.includes(` ${norm(alias)} `));
}
function trackEntities({ message, turnId, knownEntities = [], previousEntities = [] }) {
    const explicit = knownEntities.filter(candidate => candidateMatch(message, candidate)).map(candidate => ({
        entity_id: candidate.entity_id || id(candidate.canonical_name || candidate.display_name, candidate.entity_type || 'custom'),
        canonical_name: candidate.canonical_name || candidate.display_name, display_name: candidate.display_name || candidate.canonical_name,
        entity_type: candidate.entity_type || 'custom', source: 'explicit_user', introduced_turn_id: turnId,
        last_referenced_turn_id: turnId, salience: 1, status: 'active', attributes: candidate.attributes || {},
        knowledge_source_ids: candidate.knowledge_source_ids || [], authority:candidate.authority || 'authoritative',
        allowed_actions:candidate.allowed_actions || [], source_type:candidate.source_type || 'configuration', source_id:candidate.source_id || null
    }));
    const explicitIds = new Set(explicit.map(x => x.entity_id));
    const decayed = previousEntities.filter(x => !explicitIds.has(x.entity_id)).map(x => ({ ...x, salience: Math.max(0, Number(x.salience || 0) - .12), status: 'background' }));
    return [...explicit, ...decayed].filter(x => x.salience > 0).sort((a,b) => b.salience - a.salience);
}
module.exports = { norm, trackEntities };
