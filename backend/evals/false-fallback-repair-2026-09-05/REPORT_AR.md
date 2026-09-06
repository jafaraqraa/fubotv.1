# FuBot — إصلاح False Fallback للحساب المشتق

## النتيجة

**STATUS: PASS على الكود والاختبارات، والخدمة الحالية حمّلت النسخة المعدّلة.** أُعيد تشغيل الخدمة بعد اكتمال الاختبارات؛ PID الخادم الحالي `495192` وبدأ في `2026-09-05 20:25:20 +03`، و`/health` يعيد `runtime=ready`. اكتملت تهيئة WhatsApp في سجل الإقلاع بلا `auth_failure` أو `disconnected`، ولم تُرسل رسالة اختبار لأي عميل. لم تتغير Qdrant أو الفهرسة أو embeddings أو chunking أو Top-K أو thresholds أو ingestion.

## أول طبقة انحراف

- `FIRST_DIVERGENT_LAYER = Derived arithmetic validation`
- `EXPECTED = SUPPORTED_DERIVED: (2 × 220 ILS) + 60 ILS = 500 ILS`
- `ACTUAL BEFORE = NOT_PROVEN / premises_not_proven`
- `ROOT_CAUSE = validateBinary كان يمثل عملية ثنائية واحدة فقط، ولا يمثل ADD_MULTIPLY أو يستخرج العدد اللفظي «وحدتين» كمدخل مستخدم. بعد إثبات الحساب ظهر انحراف تالٍ في Boundary: دليل المطابقة العام لا يحمل عبارة الحصرية التي أثبتت أن الرسم لا يتكرر.`

الأثر السابق `9df23741-1289-408b-8ac2-cf422445c44a` يثبت: Gate=`ANSWER`، المقطع الصحيح بعد الميزانية، prompt فعلي يحتوي 220 و60، والمزوّد `OpenRouterProvider/openai/gpt-4.1-mini` ولّد 500؛ ثم المتحقق أعاد `NOT_PROVEN` وصار الرد fallback. لا يوجد Structured Output parser مستقل في هذا المسار؛ الناتج نص طبيعي ثم Claim extraction. Conditional Policy Guard لم يكن صاحب القرار في حالة السعر المركب.

## الإصلاح الدقيق

أضيف داخل `derivedClaimValidator` مسار عام ضيق لـ`TOTAL_PRICE / ADD_MULTIPLY`:

1. العدد الصريح أو اللفظي من السؤال يسجل `USER_INPUT / QUANTITY` ولا يصبح دليل شركة.
2. سعر الوحدة يستخرج من proposition سعر/وحدة موثوق ومملوك للشركة.
3. الرسم يستخرج من proposition تركيب/تهيئة/توصيل/زيارة، ويُقبل كرسم مرة واحدة فقط إذا كانت دلالة الإجمالي/عدم التكرار ملاصقة لنفس proposition.
4. الوحدة والعملة يجب أن تتطابقا، والحساب يجب أن يساوي الناتج حرفيًا.
5. كل business input يحتفظ بـevidenceId. اختلاف الشركات أو غياب ID يفشل مغلقًا.
6. الأرقام الواردة في إجابة النموذج—بما فيها subtotal—يجب أن تطابق المدخلات أو النتائج المشتقة.
7. يمرر Answer Validator إلى Boundary مقتطف العلاقة الذي أثبت الحصرية، بدل جملة مطابقة عامة أو كامل المقطع.

لا توجد أسماء شركات أو منتجات أو 220/60/500 في كود الإنتاج. لم يتغير Gate أو Boundary أو threshold عام.

## الحالة الحقيقية بعد الإصلاح

الأثر النهائي: `c61b8056-202f-4361-aa74-8bf669a491fa` في `false-fallback-signoff.json`.

| المرحلة | النتيجة |
|---|---|
| Retrieval/context | المقطع الصحيح موجود؛ لم يتغير المسار |
| Evidence Gate | `ANSWER / evidence_available` |
| Prompt | system prompt موجود، evidence موجود؛ prompt SHA-256 `b2341fe65e0a36cd7dcf5c6c23e7f18c609e4830e6d66e4602de2e7d53dec16e`، system SHA-256 `81f3cfd632c7fc7897b3e58f2977ca372d23b18790afe9dab29a6925a41e6dae` |
| Raw generation | `سعر وحدتين Mesh مع التركيب بنفس الزيارة هو 220 × 2 + 60 = 500 شيكل.` |
| Claim extraction | ادعاء factual واحد |
| Derived validation | `SUPPORTED_DERIVED`, operation=`ADD_MULTIPLY`, relation=`TOTAL_PRICE` |
| Provenance | 2=`USER_INPUT`; 220=`UNIT_PRICE/EVIDENCE`; 60=`ONE_TIME_FEE/EVIDENCE`; كلا مدخلي الشركة يحملان ID المقطع الموثوق |
| Answer Validator | `SUPPORTED`, numeric=`ENTAILED` |
| Boundary | `ALLOW`; tenant/numeric/negation/relevance كلها PASS |
| Renderer/final | لا توجد طبقة renderer مستقلة تعيد التحقق؛ `ai.js` يستخدم outputAnswer. النهائي هو 500، بلا fallback |

## السلامة والاختبارات

| المجموعة | النتيجة النهائية |
|---|---:|
| Mesh + الحسابات المشتقة + numeric/comparator + tenant + policy targeted | 115/115 |
| adversarial النهائي للإلغاء/التأخير والحساب المركب | 48/48 |
| derived/Boundary/Gate/grounding tests | 106/106 |
| `npm run test:reliability --prefix backend` | 151/151، خروج 0 |
| Grounding safety frozen shadow | 88/88 scored؛ missed unsafe=0؛ tenant leakage=0؛ numeric/temporal/negation misses=0 |
| `npm test --prefix backend` | 696/696، خروج 0 |

الحالات الإلزامية مرّت: إلغاء 49→كامل، 48/47/24→50%، 23→غير مسترد؛ تأخير 60 دقيقة→لا رسم، 61 دقيقة و4 ساعات بالضبط→50% يومي، و4 ساعات ودقيقة→يوم كامل. كما رُفض استخدام نتيجة التأخير للإلغاء والعكس.

محاولتا targeted الأوليان فشلتا أثناء تقوية اختبار «عبارة one-time بعيدة داخل نفس chunk»، ثم ضُيق الربط إلى proposition المجاور ونجحت المحاولة الثالثة. لم نغيّر المتوقع لتمريرهما.

`MISSED UNSAFE = 0`. `TENANT LEAKAGE = 0`. للمجموعة المجمدة 4 candidate false blocks، وهي موجودة في النظام الحالي وليست إجابات خطرة؛ حالة ساعات دعم غير مرتبطة بهذا التعديل تفسر الفرق عن HEAD التاريخي. لا يفعّل إصلاح هذه الجولة مسار الحساب المركب فيها لأنها لا تحتوي كمية+سعر وحدة+رسم مرة واحدة.

## حالات False Fallback الإضافية التي أُصلحت

| الحالة | النتيجة | أول انحراف المثبت |
|---|---|---|
| قائمة مراكز كاملة، سؤال قلقيلية | `SUPPORTED` ثم `ALLOW`؛ النهائي «لا يوجد» | إثبات العضو داخل قائمة نفي صريحة، مع رفض مدينة غير مدرجة |
| تخفيض قبل 48 ساعة بالضبط | جواب الدورة التالية صحيح | لا انحراف |
| تعليق 31 يومًا | 40 شيكل صحيح | لا انحراف نهائي؛ provenance الحالي واسع الأرقام ويحتاج تدقيقًا مستقلًا |
| سعر Fiber 300 في مايو 2026 | `SUPPORTED_DERIVED / HISTORICAL_RANGE_LOOKUP`؛ النهائي 119 | ربط الشهر بنطاق التاريخ وبهوية المنتج ومصدره |
| سعر Fiber 1000 المباشر | `SUPPORTED` ثم `ALLOW`؛ النهائي 229 | فصل رقم هوية المنتج عن الأرقام التجارية وحفظ قسم المنتج حتى العنوان التالي |
| إعفاء تركيب Fiber 1000 مع 12 شهرًا | 0 شيكل صحيح | لا انحراف |
| single-referent follow-up «وإذا أخذت وحدتين؟» | شُغّل على DB الاختبار؛ المرجع `Mesh` وصل للمولد، لكن المولد أضاف رسم تهيئة غير مطلوب فرفضه المتحقق بأمان | لا توجد إجابة خاطئة مسلّمة، لكن هذه الصياغة تبقى false fallback وتحتاج إصلاح توليد/partial recovery منفصلًا |

الإصلاحات الإضافية عامة وغير مرتبطة بأسماء الشركات أو قيم الاختبار: قائمة نفي صريحة، نطاق سعر تاريخي، وربط قسم كتالوج بهوية منتج. اختُبرت أيضًا قيم خاطئة وأعضاء غير مدرجين لضمان الفشل المغلق.

## الملفات والرجوع

`changed-files.json` و`repair.patch` يمثلان هذه الجولة فقط، وقد بُني baseline بإعادة تطبيق فرق جولة الصيانة السابقة على أرشيف بدايتها. تغيّر منطق الإنتاج في ثلاثة ملفات فقط:

- `backend/src/rag/intelligence/derivedClaimValidator.js`
- `backend/src/rag/intelligence/answerValidator.js`
- `backend/src/rag/intelligence/numericIdentity.js`

والباقي اختبار وأداة trace. للرجوع: طبّق `repair.patch` عكسيًا بعد مطابقة بصمات `after`، على هذه الملفات فقط. لا تسترجع SQLite، ولا تحذف رسائل، ولا تعِد Qdrant، ولا تستخدم git reset شاملًا.

## القيود وحالة الإنتاج

الدعم الجديد مقصود للحساب: `quantity × proven unit price + proven one-time fee`. الجمع والطرح والضرب والقسمة البسيطة والنسب السابقة بقيت كما هي ونجحت اختباراتُها؛ هذا ليس parser دلاليًا عامًا لكل فاتورة متعددة البنود أو ضرائب أو رسوم متداخلة. الصياغات التي لا تثبت علاقة الرسم لمرة واحدة تفشل مغلقًا.

الخدمة القديمة PID `348195` أوقفت، والخدمة الحالية PID `495192` بدأت بعد البصمات النهائية وتستخدم مسار المشروع الحالي. `runtime=ready`، إعدادات Gate وBoundary بقيت مفعلة بنسبة 100%، وتهيئة WhatsApp اكتملت. يوجد تحذير قائم عن نقطتي Qdrant بلا مالك؛ لم ألمسه لأن هذا الإصلاح لا يحتاج إعادة فهرسة ولأن تغيير الفهرس الحي خارج نطاق هذه الجولة.
