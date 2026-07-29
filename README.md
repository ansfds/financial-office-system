# منظومة المكتب المالي

منظومة عربية RTL مبنية باستخدام Next.js وTypeScript وTailwind وPostgreSQL وPrisma.

## الوظائف المنفذة

- دخول بأسماء المستخدمين الثلاثة وكلمات مرور مشفرة في قاعدة البيانات.
- Cookie موقعة وآمنة من نوع httpOnly.
- تحديد عدد محاولات الدخول وتسجيل المحاولات الفاشلة.
- إدارة الأشخاص وأرشفتهم بالحذف الناعم.
- إنشاء المعاملات بأرقام تلقائية.
- حركات مالية جزئية متعددة لكل معاملة عبر API.
- صندوق منفصل لكل عملة، ولا يتم جمع العملات.
- سجل تعديلات ومحاولات دخول.
- تقارير ملخصة حسب العملة والحالة.
- عملات وأنواع معاملات افتراضية من Seed.
- واجهة عربية متجاوبة مع الهاتف والكمبيوتر.

## التشغيل المحلي

1. ثبّت Node.js 20 أو أحدث وPostgreSQL.
2. انسخ `.env.example` إلى `.env`.
3. أدخل رابط قاعدة البيانات ومفتاح جلسة طويلًا وكلمات مرور المستخدمين الثلاثة.
4. نفّذ:

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
npm run seed:users
npm run dev
```

ثم افتح `http://localhost:3000`.

## إنشاء SESSION_SECRET

```bash
openssl rand -hex 48
```

## النشر على Vercel

1. ارفع المشروع إلى GitHub بدون ملف `.env`.
2. أنشئ قاعدة PostgreSQL سحابية.
3. أضف في Vercel: `DATABASE_URL`, `SESSION_SECRET`, `USER_MOHAMMED_PASSWORD`, `USER_HOSSAM_PASSWORD`, `USER_ANS_PASSWORD`, `RESET_SYSTEM_PASSWORD` وباقي المتغيرات.
4. شغّل migration على قاعدة الإنتاج:

```bash
npx prisma migrate deploy
npm run db:seed
npm run seed:users
```

5. انشر المشروع.

## الأمان

لا تضع كلمات المرور في أي متغير يبدأ بـ `NEXT_PUBLIC_` ولا ترفعها إلى GitHub. سكربت المستخدمين يحفظ `passwordHash` فقط، وكلمة مرور التصفير تقرأ من `RESET_SYSTEM_PASSWORD` كسر مستقل عن كلمات مرور الدخول، وجميع API المالية تتحقق من جلسة موجودة في قاعدة البيانات، والـCookie موقعة بـHMAC.

## النسخ الاحتياطي

استخدم النسخ التلقائي الذي يوفره مزود PostgreSQL بوصفه النسخة الأساسية.

قبل أي تصفير أو تعديل كبير شغّل نسخة JSON يدوية:

```bash
npm run backup
```

سيتم إنشاء ملف داخل مجلد `backups/` باسم مثل:

```text
financial-office-backup-2026-07-22T10-30-00-000Z.json
```

مجلد `backups/` موجود في `.gitignore` ولا يتم رفعه إلى GitHub. للاسترجاع الكامل يفضّل استخدام نسخة Neon/PostgreSQL الرسمية. ملفات JSON اليدوية مخصصة للمراجعة والاسترجاع الجزئي عند الحاجة.
