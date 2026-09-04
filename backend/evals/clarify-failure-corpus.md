# CLARIFY failure corpus

This diagnosis was frozen before the production change. Historical traces are
reported only where the saved evaluator captured them; unavailable stages were
not regenerated and presented as historical telemetry.

| Case | Expected | Actual | Referent resolved? | Missing information | Provider | First divergent layer | Root cause |
|---|---|---|---|---|---|---|---|
| `electronics-c-03` — `بدي الضمان تبعه` | CLARIFY | ANSWER | No | referent | USER | Evidence Gate | attached possessive was not represented as an unresolved referent |
| `log-c1` — `وين وصلت؟` | CLARIFY | ANSWER | No | action/state target | USER | Evidence Gate | short elliptical question was treated as sufficiently specified |
| `hold-c1` — `شو شروطها؟` | CLARIFY | ANSWER | No | attribute target | USER | Evidence Gate | attached pronoun was not represented generically |
| `arc-c1` — `قديش تكلفتها؟` | CLARIFY | ANSWER | No | referent | USER | Evidence Gate | generic attached pronoun missed |
| `arc-c2` — `متى؟` | CLARIFY | ANSWER | No | temporal target | USER | Evidence Gate | bare interrogative target missed |
| `lau-c2` — `بدي أغيرها` | CLARIFY | ANSWER | No | action target | USER | Evidence Gate | action target attachment missed |
| `pri-c1` — `شو شروطها؟` | CLARIFY | ANSWER | No | attribute target | USER | Evidence Gate | generic attached pronoun missed |
| `pri-c2` — `وين وصلت؟` | CLARIFY | ANSWER | No | action/state target | USER | Evidence Gate | short elliptical target missed |
| `lab-c1` — `بدي أعدله` | CLARIFY | NO_ANSWER | No | action target | USER | Evidence Gate | user-resolvable target reached downstream fallback |
| `lab-c2` — `قديش نتيجته؟` | CLARIFY | ANSWER | No | referent | USER | Evidence Gate | masculine attachment missed |

Baseline on `clarify-generalization-dev.json`: CLARIFY precision 100%, recall
12.5%, F1 22.2%; ANSWER controls 100%; NO_ANSWER 100%; tenant leakage and
unsupported output 0. The common first divergent layer was Evidence Gate in
10/10 collected failures. All were user-resolvable; none required business/live
state. The corresponding live-state and knowledge-missing controls correctly
remained NO_ANSWER.
