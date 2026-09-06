'use strict';
const { norm } = require('./entityTracker');

const ELLIPSIS = /(?:\bit\b|\bthat\b|\bthis\b|\bone\b|\bthem\b|how much|available|include|i want(?: to buy)?|buy it|بدي|منه|حقه|سعره|وضعه|هذا|هاد|هي|في تركيب|متوفر)/iu;
const FIRST = /(?:\bfirst\b|الاول|أول واحد|المنتج الاول)/iu;
const SECOND = /(?:\bsecond\b|\bother one\b|الثاني|التاني|اللي بعده|الاخر)/iu;
const PREVIOUS = /(?:\bprevious\b|before that|go back|اللي قبله|قبل هيك|ارجع)/iu;

function compatible(entities, capability) {
    const types = capability?.supported_entity_types;
    return !Array.isArray(types) || !types.length ? entities : entities.filter(e => types.includes(e.entity_type));
}
function resolveReference({ message, entities = [], state = {}, capability = null }) {
    const active = compatible(entities.filter(e => e.status !== 'resolved'), capability);
    const explicit = active.filter(e => e.source === 'explicit_user' && e.salience >= .75);
    const ordered = (explicit.length ? explicit : active).sort((a,b) => b.salience-a.salience);
    let selected = null;
    if (FIRST.test(message)) selected = [...ordered].sort((a,b) => String(a.introduced_turn_id).localeCompare(String(b.introduced_turn_id)))[0];
    else if (SECOND.test(message) || PREVIOUS.test(message)) selected = ordered[1] || null;
    else if (ELLIPSIS.test(message) && ordered.length === 1) selected = ordered[0];
    else if (ELLIPSIS.test(message) && ordered.length > 1 && ordered[0].salience - ordered[1].salience >= .25) selected = ordered[0];
    const ambiguous = ELLIPSIS.test(message) && !selected && ordered.length > 1;
    const unresolved = ELLIPSIS.test(message) && !selected && ordered.length === 0;
    return { selected, candidates: ordered, ambiguous, unresolved,
        referenced_turn_ids: selected ? [selected.last_referenced_turn_id] : [],
        reason: selected ? 'compatible_active_entity' : ambiguous ? 'multiple_compatible_entities' : unresolved ? 'missing_reference' : 'no_ellipsis' };
}
function standalone(message, entity) {
    if (!entity) return String(message || '').trim();
    const value=String(message||'').trim();
    const alreadyExplicit=[entity.canonical_name,entity.display_name].some(name=>name&&norm(value).includes(norm(name)));
    if(alreadyExplicit)return value;
    return `${value} الموضوع المقصود هو ${entity.canonical_name}`;
}
function clarification(candidates) {
    const names = candidates.slice(0,3).map(x => x.display_name);
    if (!names.length) return 'شو المنتج أو الخدمة اللي بتقصدها؟';
    return `بتقصد ${names.join(' ولا ')}؟`;
}
module.exports = { resolveReference, standalone, clarification, ELLIPSIS };
