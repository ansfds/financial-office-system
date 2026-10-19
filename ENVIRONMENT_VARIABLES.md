متغيرات البيئة المستخدمة فعليًا

لا تحفظ قيم الأسرار في Git أو سجلات التشغيل. لا تحتاج واجهة العميل إلى رابط قاعدة البيانات أو كلمات المرور.

| الاسم | التصنيف | الاستخدام |
| --- | --- | --- |
| DATABASE_URL | Required، سري، في كل بيئة متصلة بالبيانات | PostgreSQL عبر Prisma، وفحص المخطط والبناء والترحيلات. استخدم رابط البيئة الصحيحة مع SSL المناسب للمزوّد. |
| SESSION_SECRET | Required، سري، في كل بيئة تستخدم تسجيل الدخول | توقيع الجلسات وتأكيد التصفير، ومفتاح تشفير الحقول إذا لم يُضبط مفتاح مستقل. لا تغيّره لمعالجة مشكلة ترحيل. |
| CARD_ENCRYPTION_KEY | Optional، سري، server only | مفتاح مستقل لتشفير حقول البطاقات؛ يستخدم SESSION_SECRET عند غيابه. تغيير المفتاح دون خطة نقل يعطّل فك بيانات مشفّرة سابقًا. |
| RESET_SYSTEM_PASSWORD | Optional للتشغيل، مطلوب لميزة التصفير إن لم يوجد hash؛ سري | كلمة مرور التصفير على الخادم. |
| RESET_PASSWORD_HASH | Optional، سري، server only | بديل Argon2 لكلمة مرور التصفير؛ له الأولوية إذا كان مضبوطًا. |
| RESET_ADMIN_USERNAMES | Optional، server only | المستخدمون المسموح لهم بالتصفير، مفصولون بفواصل. غيابه يعطّل التصفير. |
| LOGIN_MAX_ATTEMPTS | Optional | الحد الافتراضي 5 لمحاولات الدخول الفاشلة. |
| LOGIN_WINDOW_MINUTES | Optional | نافذة المحاولات الافتراضية 15 دقيقة. |
| NODE_ENV | توفره بيئة التشغيل | production أو development؛ يتحكم في secure cookies ورسائل السجل التفصيلية. لا تستخدم قيم التطوير في الإنتاج. |
| USER_MOHAMMED_PASSWORD | Provisioning only، سري | سكربت seed-users؛ تسجيل الدخول أثناء التشغيل يتحقق من hash المخزن في PostgreSQL. |
| USER_HOSSAM_PASSWORD | Provisioning only، سري | سكربت seed-users فقط. |
| USER_ANS_PASSWORD | Provisioning only، سري | سكربت seed-users فقط؛ ليس شرطًا لقراءة الصفحات بعد إنشاء المستخدم. |
| ADMIN_USERNAME | Maintenance only | سكربت تغيير كلمة مرور مستخدم محدد عند طلب ذلك صراحة. |
| ADMIN_NEW_PASSWORD | Maintenance only، سري | كلمة المرور الجديدة في سكربت الصيانة؛ لا تُضبط لمعالجة أخطاء البيانات. |
| LOCAL_REVIEW | Development/test only | علامة النسخة المحلية التي تستخدم بيانات مستقلة. لا تُضبط على Production. |
| CONFIRM_RESET_SYSTEM_DATA | Development/test only | تأكيد سكربت التصفير المحلي؛ السكربت يرفض قواعد غير loopback. ليس جزءًا من نشر الإصلاح. |
| SMOKE_BASE_URL | Test only | عنوان المنظومة المراد اختبارها في سكربتات التحقق. |
| CHROME_PATH | Test only | مسار Chrome/Edge لاختبارات المتصفح. |
| VERIFY_CDP_PORT | Test only | منفذ متصفح التحقق الذي يسجل المستخدم دخوله فيه بنفسه عند اختبار الإنتاج؛ لا يقرأ كلمة المرور. |
| VERIFY_MIGRATION_BACKUP_ID | Test only | معرّف نسخة الأمان للتحقق من أن نسخة المنظومة المنشورة ترى القاعدة التي طُبقت عليها الترحيلات. |

لا توجد متغيرات أعمال إضافية Production only؛ يجب ضبط DATABASE_URL وSESSION_SECRET الصحيحين ضمن نطاق Production في Vercel، ولا تكفي قيم Preview. بيانات المراجعة في `.tmp/local-review-env.json` منفصلة ولا تُنشر.

أسماء قديمة لا يقرأها تطبيق المنظومة الحالي: `SESSION_DURATION_MINUTES` و`INACTIVITY_LOCK_MINUTES` و`SYSTEM_ACCESS_CODE` و`CARD_SECRET_KEY` و`OPENAI_API_KEY` و`OPENAI_TEXT_MODEL` و`OPENAI_TRANSCRIBE_MODEL` و`NEXT_PUBLIC_APP_NAME`. مدة الجلسة الحالية محددة في `lib/session-policy.ts`، واسم التطبيق في metadata. لم تُحذف أو تُغيّر أي قيمة Production قديمة ضمن هذا الإصلاح.

قبل النشر، اختبر الترحيلات على قاعدة مستقلة واحفظ نسخة أمان مناسبة للبيانات المتأثرة. طبّق الترحيلات المراجعة باستخدام `npm run db:deploy`. يفحص `npm run build` اتصال القاعدة والحقول والجداول والحالات التي يحتاجها الكود، ويتوقف إذا بقي المخطط ناقصًا. لا ينفّذ البناء ترحيلات تلقائية.
