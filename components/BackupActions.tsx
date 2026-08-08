'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DatabaseBackup, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/format';

export default function BackupActions({
  backups,
}: {
  backups: Array<{ id: string; type: string; filename: string; status: string; createdAt: string | Date }>;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function createBackup() {
    setLoading(true);
    const response = await fetch('/api/admin/backup', { method: 'POST', cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) return toast.error(result.error || 'تعذر إنشاء النسخة الاحتياطية');
    toast.success('تم إنشاء النسخة الاحتياطية');
    router.refresh();
  }

  return (
    <div className="card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-black">النسخ الاحتياطي والتصدير</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={createBackup}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-indigo-400"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <DatabaseBackup size={18} />}
            نسخة احتياطية
          </button>
          <a
            href="/api/export/customers"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 font-bold text-white dark:bg-slate-100 dark:text-slate-950"
          >
            <Download size={18} />
            تصدير Excel
          </a>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {backups.map((backup) => (
          <div key={backup.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
            <span className="font-bold">{backup.filename}</span>
            <span className="text-slate-500">{formatDateTime(backup.createdAt)}</span>
          </div>
        ))}
        {!backups.length ? <div className="text-sm text-slate-500">لا توجد نسخ احتياطية مسجلة.</div> : null}
      </div>
    </div>
  );
}
