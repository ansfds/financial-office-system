import Page from '@/components/Page';
import BackupActions from '@/components/BackupActions';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function SettingsPage() {
  const [users, currencies, backups] = await Promise.all([
    db.user.findMany({
      select: { id: true, username: true, isActive: true, createdAt: true, updatedAt: true },
      orderBy: { username: 'asc' },
    }),
    db.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    db.backupRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
  ]);

  return (
    <Page title="الإعدادات">
      <div className="grid gap-5">
        <section className="card p-5">
          <h2 className="mb-4 font-black">المستخدمون</h2>
          <div className="table-wrap hidden md:block">
            <table>
              <thead>
                <tr>
                  <th>اسم المستخدم</th>
                  <th>الحالة</th>
                  <th>تاريخ الإنشاء</th>
                  <th>آخر تحديث</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="font-bold">{user.username}</td>
                    <td>
                      <span className={user.isActive ? 'font-bold text-emerald-600' : 'font-bold text-red-600'}>
                        {user.isActive ? 'نشط' : 'موقوف'}
                      </span>
                    </td>
                    <td>{formatDateTime(user.createdAt)}</td>
                    <td>{formatDateTime(user.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {users.map((user) => (
              <div key={user.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black">{user.username}</div>
                    <div className="mt-1 text-xs text-slate-500">آخر تحديث: {formatDateTime(user.updatedAt)}</div>
                  </div>
                  <span className={user.isActive ? 'font-bold text-emerald-600' : 'font-bold text-red-600'}>
                    {user.isActive ? 'نشط' : 'موقوف'}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-500">تاريخ الإنشاء: {formatDateTime(user.createdAt)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-black">العملات</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {currencies.map((currency) => (
              <div key={currency.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="font-black">{currency.name}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {currency.code} · {currency.symbol}
                </div>
              </div>
            ))}
          </div>
        </section>

        <BackupActions backups={JSON.parse(JSON.stringify(backups))} />
      </div>
    </Page>
  );
}
