# Conversation Resolver v2 — implementation and audit

## Confirmed causes

The inbound path resolves tenant/contact/conversation, rejects duplicate webhooks, and persists the inbound message before `getAIResponse`. The legacy AI path then loads only six recent turns. It has no durable active subject, entity, workflow, correction, or recall state. Its referent resolver receives a separate user-only window and recall-like questions can be routed as company knowledge. Consequently, a greeting consumes window space, short follow-ups depend on text heuristics, and retrieved subjects can diverge from the user's subject. Assistant text is present in the prompt but has no authority classification.

## Implemented flow (inactive by default)

`message persistence -> conversation runtime -> intent/entity/reference/recall resolution -> atomic state/event commit -> route`

In `v2`, casual and recall turns can bypass RAG, ambiguous references return one focused question, knowledge turns use a standalone retrieval query containing the resolved canonical subject, and transactional turns use configured capabilities/slots. In `shadow`, the legacy answer remains authoritative; resolver errors cannot alter it. `legacy` does not invoke the resolver.

Conversation memory is not company evidence. A previous assistant statement is labeled as prior speech and marked for RAG revalidation when the user asks for a current fact. Only `known_entities` derived from authorized tenant knowledge/configuration can become explicit entities. Retrieved or assistant-created text cannot silently replace one.

## Persistence and concurrency

Migration `035` creates a scoped state snapshot, append-only idempotent events, and privacy-safe traces. The compound scope is tenant + conversation + contact + channel. Commits compare `state_version`, retry conflicts at most three times, and use one SQLite transaction. A stable message/event uniqueness constraint makes webhook replays idempotent. State rebuild uses ordered append-only events.

No production database migration was run in this work. Tests applied it only to isolated SQLite databases.

## Rollout and rollback

Default and current configuration:

```text
RAG_IMPLEMENTATION=legacy
CONVERSATION_RESOLVER_IMPLEMENTATION=legacy
```

For a future controlled rollout, apply migration 035 during a maintenance window, populate authorized entity catalogs and business capabilities, then use tenant-scoped shadow evaluation before v2. The kill switch is `CONVERSATION_RESOLVER_SHADOW_KILL_SWITCH=1`; shadow concurrency defaults to 2.

Rollback is operationally safe by setting the resolver flag to `legacy`. Preserve state/event tables for audit. If schema removal is later required, back them up and drop only `conversation_resolver_traces`, `conversation_resolver_events`, and `conversation_resolver_states` in that order during an approved maintenance operation.

## Validation and limitations

The deterministic suite covers greeting preservation, recall, three unrelated companies, transactions, unknown/ambiguous references, correction, assistant poisoning, replay idempotency, rebuild, optimistic concurrency, and tenant separation. Existing RAG v2 and channel/security regressions pass. A real OpenRouter generation probe used synthetic content only.

Remaining before shadow: connect each tenant's authorized entity catalog and workflow capability configuration to the runtime arguments; add an isolated full webhook-to-Qdrant-to-outbound harness; expand evaluation beyond the current small deterministic dataset; add production metrics aggregation/retention enforcement. Shadow and v2 remain disabled.
