import Page from '@/components/Page';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AuditPage() {
  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 300,
  });

  return (
    <Page title="سجل التعديلات">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>المستخدم</th>
              <th>العملية</th>
              <th>الوصف</th>
              <th>القسم</th>
              <th>IP</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{log.username || 'system'}</td>
                <td>{log.action}</td>
                <td>{log.description || '-'}</td>
                <td>{log.entityType || '-'}</td>
                <td>{log.ip || '-'}</td>
                <td>{formatDateTime(log.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
