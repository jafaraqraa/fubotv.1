'use strict';
const crypto = require('crypto');
const defaultDb = require('../database/connection');

const J = value => JSON.stringify(value ?? null);
function P(value, fallback = null) { try { return value == null ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
function key(scope) { return [scope.tenant_id, scope.conversation_id, scope.contact_id, scope.channel]; }
function blank(scope) { return { ...scope, active_topic:null, active_entities:[], last_user_intent:null,
    pending_action:null, pending_slots:[], last_explicit_user_subject:null, last_answered_subject:null,
    conversation_summary:'', summary_source_range:null, state_version:0, updated_at:null }; }
function map(row, scope) { if (!row) return blank(scope); return {
    tenant_id:row.tenant_id, conversation_id:row.conversation_id, contact_id:row.contact_id, channel:row.channel,
    active_topic:P(row.active_topic_json), active_entities:P(row.active_entities_json,[]), last_user_intent:row.last_user_intent,
    pending_action:P(row.pending_action_json), pending_slots:P(row.pending_slots_json,[]),
    last_explicit_user_subject:P(row.last_explicit_user_subject_json), last_answered_subject:P(row.last_answered_subject_json),
    conversation_summary:row.conversation_summary || '', summary_source_range:P(row.summary_source_range_json),
    state_version:row.state_version, updated_at:row.updated_at }; }

class ConversationStateRepository {
    constructor(db = defaultDb) { this.db = db; }
    get(scope) { return map(this.db.prepare(`SELECT * FROM conversation_resolver_states
        WHERE tenant_id=? AND conversation_id=? AND contact_id=? AND channel=?`).get(...key(scope)), scope); }
    events(scope) { return this.db.prepare(`SELECT * FROM conversation_resolver_events
        WHERE tenant_id=? AND conversation_id=? AND contact_id=? AND channel=? ORDER BY sequence_number`).all(...key(scope))
        .map(r => ({ ...r, payload:P(r.event_payload_json,{}) })); }
    commit(scope, { messageId, eventType='USER_RESOLVED', nextState, expectedVersion }) {
        return this.db.transaction(() => {
            const duplicate = this.db.prepare(`SELECT 1 FROM conversation_resolver_events WHERE tenant_id=? AND conversation_id=? AND contact_id=? AND channel=? AND message_id=? AND event_type=?`)
                .get(...key(scope), String(messageId), eventType);
            if (duplicate) return { duplicate:true, state:this.get(scope) };
            const current = this.get(scope);
            if (current.state_version !== expectedVersion) { const e=new Error('Conversation state version conflict'); e.code='CONVERSATION_STATE_CONFLICT'; throw e; }
            const version = expectedVersion + 1;
            const full = { ...current, ...nextState, ...scope, state_version:version };
            const update = this.db.prepare(`UPDATE conversation_resolver_states SET active_topic_json=?,active_entities_json=?,last_user_intent=?,pending_action_json=?,pending_slots_json=?,last_explicit_user_subject_json=?,last_answered_subject_json=?,conversation_summary=?,summary_source_range_json=?,state_version=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND conversation_id=? AND contact_id=? AND channel=? AND state_version=?`)
                .run(J(full.active_topic),J(full.active_entities),full.last_user_intent,J(full.pending_action),J(full.pending_slots),J(full.last_explicit_user_subject),J(full.last_answered_subject),full.conversation_summary||'',J(full.summary_source_range),version,...key(scope),expectedVersion);
            if (!update.changes && expectedVersion === 0) this.db.prepare(`INSERT INTO conversation_resolver_states(tenant_id,conversation_id,contact_id,channel,active_topic_json,active_entities_json,last_user_intent,pending_action_json,pending_slots_json,last_explicit_user_subject_json,last_answered_subject_json,conversation_summary,summary_source_range_json,state_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                .run(...key(scope),J(full.active_topic),J(full.active_entities),full.last_user_intent,J(full.pending_action),J(full.pending_slots),J(full.last_explicit_user_subject),J(full.last_answered_subject),full.conversation_summary||'',J(full.summary_source_range),version);
            else if (!update.changes) { const e=new Error('Conversation state version conflict'); e.code='CONVERSATION_STATE_CONFLICT'; throw e; }
            this.db.prepare(`INSERT INTO conversation_resolver_events(event_id,tenant_id,conversation_id,contact_id,channel,message_id,event_type,sequence_number,event_payload_json) VALUES(?,?,?,?,?,?,?,?,?)`)
                .run(crypto.randomUUID(),...key(scope),String(messageId),eventType,version,J({ state_after:full }));
            return { duplicate:false, state:{...full, state_version:version} };
        })();
    }
    rebuild(scope) { const events=this.events(scope); return events.length ? { ...blank(scope), ...events.at(-1).payload.state_after } : blank(scope); }
    trace(scope, trace) { const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
        this.db.prepare(`INSERT INTO conversation_resolver_traces(trace_id,tenant_id,conversation_hash,contact_hash,message_id,message_type,intent,metadata_json,latency_ms) VALUES(?,?,?,?,?,?,?,?,?)`)
            .run(trace.trace_id||crypto.randomUUID(),scope.tenant_id,hash(scope.conversation_id),hash(scope.contact_id),trace.message_id||null,trace.message_type,trace.intent,J(trace.metadata||{}),trace.latency_ms||0); }
}
module.exports = { ConversationStateRepository, blank };
