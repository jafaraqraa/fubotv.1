# Evidence Forensics: electronics-n-01

## Reconstruction status

The exact user payload is reconstructable for all three measured runs. Each saved row contains the ordered `retrievedEvidence` array used by the experimental runner, and the runner serialized each item as `<VERIFIED_EVIDENCE id="…">text</VERIFIED_EVIDENCE>`. The three arrays are byte-for-byte identical.

The model did **not** receive retrieval scores, tenant ID, document filename, source ID, validity dates, chunk metadata, or neighbor-expansion annotations. The saved artifact retains only ID, text, order, and score. Original document filename/source can be cross-referenced offline from `companies.json`, but it was not part of the model payload. No neighbor expansion is indicated: each supplied text equals its complete one-chunk source document.

## Requested proposition

- Question: `هل عندكم فرع في نابلس؟`
- Expected decision: `NO_ANSWER`
- Expected facts: none.
- Entity: the tenant/business.
- Attribute: existence of a branch.
- Scope: Nablus.
- Time: current/general present.
- Condition: none.
- Proposition required for a valid ANSWER: **The business currently has a branch in Nablus, or explicitly does not have a branch in Nablus.**

## Exact supplied payload (identical in runs 1–3)

```text
USER_QUESTION:
هل عندكم فرع في نابلس؟

VERIFIED_EVIDENCE:
<VERIFIED_EVIDENCE id="elec-contact_chunk_0_c37eea929623">
# التواصل
المعرض الوحيد في البيرة قرب دوار المنارة، ويفتح من السبت إلى الخميس من التاسعة صباحاً حتى السابعة مساءً. صورة معتمدة: واجهة معرض برق تك ذات اللافتة الزرقاء.
</VERIFIED_EVIDENCE>
<VERIFIED_EVIDENCE id="elec-products_chunk_0_a742c3d593ef">
# المنتجات
حاسوب ندى 14 بسعر 2890 شيكل. حاسوب ندى 14 برو بسعر 3490 شيكل. هاتف رمال X بسعر 1790 شيكل. خدمة إعداد الهاتف ونقل البيانات تكلف 80 شيكل.
</VERIFIED_EVIDENCE>
<VERIFIED_EVIDENCE id="elec-returns_chunk_0_72a86ecb5c5a">
# الإرجاع والمخزون
يمكن إرجاع الجهاز غير المفتوح خلال 10 أيام. يبلغ المتجر عن العيب المصنعي خلال 3 أيام من الاستلام. الملحقات المخفضة لا ترد. عند نفاد هاتف رمال X يمكن تسجيل طلب تنبيه عند عودته، ولا يوجد موعد ثابت لعودته.
</VERIFIED_EVIDENCE>
<VERIFIED_EVIDENCE id="elec-offers_chunk_0_9b609c61d4a8">
# عروض سبتمبر
خصم 12% على هاتف رمال X ساري من 1 سبتمبر 2026 حتى 10 سبتمبر 2026. عرض سماعات البرق المنتهي كان بقيمة 20% وانتهى في 31 أغسطس 2026.
</VERIFIED_EVIDENCE>
<VERIFIED_EVIDENCE id="elec-delivery_chunk_0_3eb67cb4db8c">
# الشحن
الشحن مجاني عندما تتجاوز قيمة السلة 450 شيكل. رسوم الشحن العادي 25 شيكلاً، والمدة المتوقعة من يومين إلى أربعة أيام عمل. تركيب الشاشة خدمة منفصلة عن التوصيل وسعرها 120 شيكلاً.
</VERIFIED_EVIDENCE>
```

## Evidence support table

| Order | Evidence ID | Saved score | Offline source | Classification | What it proves | What it does not prove |
|---:|---|---:|---|---|---|---|
| 1 | `elec-contact_chunk_0_c37eea929623` | 0.56460168 | `elec-contact`; `الفروع والتواصل.md` | RELATED_ONLY | There is one showroom described as the only showroom, located in Al-Bireh; its hours and an approved facade image are also stated. | It does not explicitly state whether a legally or operationally distinct “branch” exists in Nablus. Equating `المعرض` with every possible `فرع` is unstated. |
| 2 | `elec-products_chunk_0_a742c3d593ef` | 0.55983608 | `elec-products`; `دليل المنتجات والأسعار.md` | IRRELEVANT | Product and setup-service prices. | Any branch location or absence. |
| 3 | `elec-returns_chunk_0_72a86ecb5c5a` | 0.556424904 | `elec-returns`; `الإرجاع والمخزون.md` | IRRELEVANT | Return and stock-notification rules. | Any branch location or absence. |
| 4 | `elec-offers_chunk_0_9b609c61d4a8` | 0.53861464 | `elec-offers`; `العروض المؤقتة.md` | IRRELEVANT | Dated discounts. | Any branch location or absence. |
| 5 | `elec-delivery_chunk_0_3eb67cb4db8c` | 0.53858924 | `elec-delivery`; `الشحن والتركيب.md` | IRRELEVANT | Shipping price/duration and installation terms. | Any branch location or absence. |

Counts: DIRECT_SUPPORT 0; PARTIAL_SUPPORT 0; RELATED_ONLY 1; CONTRADICTS 0; IRRELEVANT 4.

## Support leakage and packaging

The phrase `المعرض الوحيد` is a strong closed-world/exclusivity cue. It sits first, in the highest-ranked chunk, under a broad contact heading and alongside business hours and a verified storefront image. That presentation makes it easy to treat “only showroom in Al-Bireh” as a complete branch directory even though the key equivalence `showroom = every branch` is absent. The original filename contains `الفروع`, but that filename was not sent; the misleading force comes from the actual phrase `المعرض الوحيد`, not hidden metadata. Four unrelated chunks add context volume but do not supply the missing proposition.

## Claim/evidence link and three-run consistency

Runs 1, 2, and 3 are identical:

- Decision: `ANSWER`.
- Answer/claim: `المعرض الوحيد يقع في البيرة قرب دوار المنارة.`
- Cited evidence: `elec-contact_chunk_0_c37eea929623`.
- Validator: `SUPPORTED`, accepted.

The factual claim is `SUPPORTED_BY_CITED_EVIDENCE`. The unsupported inference is at the answer-selection level: a true alternative-location/showroom statement was treated as sufficient to answer whether a branch exists in Nablus. It neither affirms nor denies the requested proposition. The behavior is SYSTEMATIC 3/3.

## Counterfactual packages (offline hypotheses only)

- PACKAGE A — current exact five-chunk package: control condition reproducing the strong exclusivity cue plus four distractions.
- PACKAGE B — remove RELATED_ONLY and IRRELEVANT chunks: empty evidence; tests whether the erroneous ANSWER depends entirely on the related exclusivity statement.
- PACKAGE C — atomically split the contact chunk without rewording into showroom location/exclusivity, hours, and image propositions; tests whether mixed-chunk breadth causes scope promotion.
- PACKAGE D — direct evidence for the requested branch-in-Nablus attribute only: empty evidence; tests the expected NO_ANSWER behavior under strict direct relevance.

## Finding

The expected label is correct under the benchmark's strict grounded-answer policy. Root cause is **MIXED**: packaging supplies a prominent closed-world-looking but category-mismatched statement, and the model systematically accepts a supported related claim as an answer to a different proposition.
