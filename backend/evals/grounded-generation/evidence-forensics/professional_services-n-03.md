# Evidence Forensics: professional_services-n-03

## Reconstruction status

The exact user payload is reconstructable for all three measured runs, and the ordered evidence arrays are byte-for-byte identical. Scores and source metadata were saved but not sent. Original document filenames/source IDs can be cross-referenced offline from `companies.json`; no neighbor expansion is indicated because each supplied chunk equals its complete one-chunk document.

## Requested proposition

- Question: `هل الدعم متاح يوم الجمعة؟`
- Expected decision: `NO_ANSWER`
- Expected facts: none.
- Entity: the tenant's support service.
- Attribute: availability.
- Scope: support generally; the evidence narrows one channel to email.
- Time: Friday, without a specific date.
- Condition: none.
- Proposition required for a valid ANSWER: **Support is available on Friday, or support is unavailable on Friday, for the scope/channel intended by the question.**

## Exact supplied payload (identical in runs 1–3)

```text
USER_QUESTION:
هل الدعم متاح يوم الجمعة؟

VERIFIED_EVIDENCE:
<VERIFIED_EVIDENCE id="svc-support_chunk_0_19dc9459f9ae">
# الدعم
الدعم عبر البريد من الأحد إلى الخميس بين التاسعة والخامسة. باقة النمو تشمل دعماً تقنياً لمدة 60 يوماً بعد التسليم، بينما باقة الانطلاق تشمل 14 يوماً.
</VERIFIED_EVIDENCE>
<VERIFIED_EVIDENCE id="svc-cancel_chunk_0_c587235e4c1e">
# الإلغاء
يمكن إلغاء المشروع قبل جلسة الاكتشاف مع استرداد كامل. بعد جلسة الاكتشاف تخصم 25% من قيمة المشروع. يمكن تأجيل البداية مرة واحدة لمدة لا تتجاوز 30 يوماً.
</VERIFIED_EVIDENCE>
<VERIFIED_EVIDENCE id="svc-timeline_chunk_0_436f7e90adf9">
# التنفيذ
تستغرق باقة الانطلاق 12 يوم عمل، وباقة النمو 25 يوم عمل بعد استلام المحتوى. يبدأ المشروع بدفعة 40%، ثم 30% عند اعتماد الاتجاه، و30% عند التسليم.
</VERIFIED_EVIDENCE>
<VERIFIED_EVIDENCE id="svc-revisions_chunk_0_8b7e5fd6d9fa">
# التعديلات
باقة الانطلاق تشمل جولتي تعديل، وباقة النمو تشمل أربع جولات. الجولة الإضافية تكلف 180 شيكلاً. كتابة المحتوى العربي إضافة اختيارية بسعر 600 شيكل حتى عشر صفحات.
</VERIFIED_EVIDENCE>
<VERIFIED_EVIDENCE id="svc-packages_chunk_0_d8ee877512fc">
# الباقات
باقة الانطلاق لهوية العلامة بسعر 2200 شيكل وتشمل شعاراً ودليل ألوان. باقة النمو بسعر 4800 شيكل وتشمل الهوية وموقعاً تعريفياً من خمس صفحات. إدارة الإعلانات ليست ضمن أي من الباقتين.
</VERIFIED_EVIDENCE>
```

## Evidence support table

| Order | Evidence ID | Saved score | Offline source | Classification | What it proves | What it does not prove |
|---:|---|---:|---|---|---|---|
| 1 | `svc-support_chunk_0_19dc9459f9ae` | 0.79447184 | `svc-support`; `الدعم والتواصل.md` | RELATED_ONLY | Email support is available Sunday–Thursday, 09:00–17:00; package-specific post-delivery support durations. | It does not explicitly say Friday is unavailable, that the listed days are exhaustive, or that email is the only support channel. |
| 2 | `svc-cancel_chunk_0_c587235e4c1e` | 0.66212312 | `svc-cancel`; `الإلغاء والتأجيل.md` | IRRELEVANT | Cancellation/refund and postponement rules. | Friday support availability. |
| 3 | `svc-timeline_chunk_0_436f7e90adf9` | 0.61352048 | `svc-timeline`; `المدة والمراحل.md` | IRRELEVANT | Project durations and payment milestones. | Friday support availability. |
| 4 | `svc-revisions_chunk_0_8b7e5fd6d9fa` | 0.597352024 | `svc-revisions`; `التعديلات والنطاق.md` | IRRELEVANT | Revision counts and add-on prices. | Friday support availability. |
| 5 | `svc-packages_chunk_0_d8ee877512fc` | 0.538315632 | `svc-packages`; `الباقات.md` | IRRELEVANT | Package scope and prices. | Friday support availability. |

Counts: DIRECT_SUPPORT 0; PARTIAL_SUPPORT 0; RELATED_ONLY 1; CONTRADICTS 0; IRRELEVANT 4.

## Support leakage and packaging

The first chunk has the broad heading `# الدعم`, then presents a compact weekday range in the grammatical form normally used for an operating schedule. This looks closed-world even though it does not contain `فقط`, `أيام العمل كاملة`, or an explicit Friday rule. The same chunk mixes channel hours with package support-duration entitlements, which broadens the apparent scope of “support.” Four irrelevant business-policy chunks add context but do not establish Friday availability. The original filename was not sent.

## Claim/evidence link and three-run consistency

Runs 1, 2, and 3 are identical:

- Decision: `ANSWER`.
- Answer/claim: `الدعم عبر البريد متاح من الأحد إلى الخميس.`
- Cited evidence: `svc-support_chunk_0_19dc9459f9ae`.
- Validator: `SUPPORTED`, accepted.

The claim is `SUPPORTED_BY_CITED_EVIDENCE`. The exact logical gap is that availability Sunday–Thursday does not, without an exhaustiveness statement, prove availability or unavailability on Friday. The model avoids making an explicit Friday claim but still marks the related schedule as a complete ANSWER. This answer-selection failure is SYSTEMATIC 3/3.

## Counterfactual packages (offline hypotheses only)

- PACKAGE A — current exact five-chunk package: control condition containing a closed-world-looking schedule plus unrelated policies.
- PACKAGE B — remove RELATED_ONLY and IRRELEVANT chunks: empty evidence; tests whether the schedule statement alone drives false authorization.
- PACKAGE C — split the support chunk verbatim into email schedule, growth-package duration, and starter-package duration propositions; tests whether mixed support attributes inflate scope.
- PACKAGE D — only direct evidence about Friday support availability: empty evidence; tests strict NO_ANSWER behavior when no direct Friday proposition exists.

## Finding

The expected label is correct under the strict benchmark definition, although the source wording is pragmatically easy to read as a complete schedule. Root cause is **MIXED**: packaging makes a partial schedule look exhaustive, while the model systematically substitutes a supported adjacent fact for the requested Friday proposition.
