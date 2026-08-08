import Page from '@/components/Page';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; action?: string; username?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() || '';
  const action = params.action?.trim() || '';
  const username = params.username?.trim() || '';
  const from = params.from ? new Date(params.from) : null;
  const to = params.to ? new Date(params.to) : null;

  const logs = await db.auditLog.findMany({
    where: {
      action: action ? { contains: action, mode: 'insensitive' } : undefined,
      username: username ? { contains: username, mode: 'insensitive' } : undefined,
      createdAt:
        from || to
          ? {
              gte: from || undefined,
              lte: to || undefined,
            }
          : undefined,
      OR: q
        ? [
            { action: { contains: q, mode: 'insensitive' } },
            { username: { contains: q, mode: 'insensitive' } },
            { entityType: { contains: q, mode: 'insensitive' } },
            { entityId: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ]
        : undefined,
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });

  return (
    <Page title="سجل العمليات">
      <form className="card mb-5 grid gap-3 p-5 md:grid-cols-5">
        <input name="q" defaultValue={q} placeholder="بحث عام" />
        <input name="action" defaultValue={action} placeholder="نوع العملية" />
        <input name="username" defaultValue={username} placeholder="المستخدم" />
        <input type="date" name="from" defaultValue={params.from || ''} />
        <input type="date" name="to" defaultValue={params.to || ''} />
        <button className="rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white md:col-span-5">
          تطبيق التصفية
        </button>
      </form>

      <div className="table-wrap hidden md:block">
        <table>
          <thead>
            <tr>
              <th>المستخدم</th>
              <th>العملية</th>
              <th>الوصف</th>
              <th>القسم</th>
              <th>المرجع</th>
              <th>IP</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{log.username || 'system'}</td>
                <td className="font-bold">{log.action}</td>
                <td>{log.description || '-'}</td>
                <td>{log.entityType || '-'}</td>
                <td className="max-w-56 truncate">{log.entityId || '-'}</td>
                <td>{log.ip || '-'}</td>
                <td>{formatDateTime(log.createdAt)}</td>
              </tr>
            ))}
            {!logs.length ? (
              <tr>
                <td colSpan={7} className="text-center text-slate-500">
                  لا توجد عمليات مطابقة.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {logs.map((log) => (
          <article key={log.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-black">{log.action}</div>
                <div className="mt-1 text-xs text-slate-500">{log.username || 'system'} · {formatDateTime(log.createdAt)}</div>
              </div>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                {log.entityType || 'عام'}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{log.description || '-'}</p>
            <div className="mt-2 truncate text-xs text-slate-500">{log.entityId || '-'}</div>
          </article>
        ))}
        {!logs.length ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500 dark:border-slate-700">
            لا توجد عمليات مطابقة.
          </div>
        ) : null}
      </div>
    </Page>
  );
}
