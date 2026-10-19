import Link from 'next/link';
import Page from '@/components/Page';
import CardStatistics from '@/components/CardStatistics';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getCardCounts } from '@/lib/card-queries';
import { formatDateTime, formatMoney } from '@/lib/format';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export default async function Dashboard() {
  if (!(await getSession())) redirect('/login');
  const [counts, recent] = await Promise.all([
    getCardCounts(),
    db.customerWalletSettlement.findMany({
      where: { deletedAt: null, person: { deletedAt: null, status: 'ACTIVE' } },
      include: { person: { select: { id: true, fullName: true, customerNo: true } }, currency: true },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 8,
    }),
  ]);
  return (
    <Page title="الرئيسية">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <CardStatistics counts={counts} />
        <section className="card p-4" data-recent-financial>
          <h2 className="mb-3 font-black">آخر الحركات المالية</h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {recent.map((movement) => (
              <div key={movement.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link className="font-bold" href={`/customers/${movement.personId}`}>
                    {movement.person.customerNo} · {movement.person.fullName}
                  </Link>
                  <span
                    className={
                      movement.accountType === 'DEBT'
                        ? 'font-bold text-emerald-700 dark:text-emerald-300'
                        : 'font-bold text-red-700 dark:text-red-300'
                    }
                  >
                    {movement.accountType === 'DEBT' ? 'لنا' : 'علينا'} ·{' '}
                    {formatMoney(movement.amount, movement.currency)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                  <span>{movement.reason}</span>
                  <time dateTime={movement.occurredAt.toISOString()}>
                    {formatDateTime(movement.occurredAt)}
                  </time>
                </div>
              </div>
            ))}
            {!recent.length && <p className="py-3 text-sm text-slate-500">لا توجد حركات مالية بعد.</p>}
          </div>
        </section>
      </div>
    </Page>
  );
}
