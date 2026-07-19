import Page from '@/components/Page';
import DangerSettings from '@/components/DangerSettings';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SettingsPage() {
  const [currencies, transactionTypes] = await Promise.all([
    db.currency.findMany({ orderBy: { code: 'asc' } }),
    db.transactionType.findMany({ orderBy: { name: 'asc' } }),
  ]);

  return (
    <Page title="الإعدادات">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 font-black">العملات</h2>
          {currencies.map((currency) => (
            <div key={currency.id} className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800">
              <span>{currency.name}</span>
              <b>
                {currency.code} - {currency.symbol}
              </b>
            </div>
          ))}
        </div>

        <div className="card p-5">
          <h2 className="mb-4 font-black">أنواع المعاملات</h2>
          {transactionTypes.map((type) => (
            <div key={type.id} className="border-b border-slate-100 py-2 dark:border-slate-800">
              {type.name}
            </div>
          ))}
        </div>

        <div className="card p-5 lg:col-span-2">
          <h2 className="font-black">الأمان</h2>
          <p className="mt-2 text-sm leading-7 text-slate-500">
            غيّر رمز الدخول من متغير البيئة SYSTEM_ACCESS_CODE في الاستضافة ثم أعد النشر. لا يتم حفظ CVV داخل قاعدة
            البيانات، وتستخدم المنظومة فقط خيار استلام بيانات التحقق أو ملاحظات داخلية آمنة.
          </p>
        </div>

        <div className="lg:col-span-2">
          <DangerSettings />
        </div>
      </div>
    </Page>
  );
}
