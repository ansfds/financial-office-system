'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/format';

export default function DangerSettings() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    password: '',
    backupConfirmed: false,
    includeSheinCards: false,
    includeReceivedCards: false,
  });

  async function resetTransactions(event: React.FormEvent) {
    event.preventDefault();
    if (!form.password.trim()) return toast.error('أدخل كلمة المرور');
    if (!window.confirm('تأكيد نهائي: سيتم أرشفة جميع المعاملات القديمة ولن يتم حذف الزبائن أو العملات.')) return;

    setLoading(true);
    const response = await fetch('/api/admin/reset-transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const result = await response.json();
    setLoading(false);

    if (!response.ok) return toast.error(result.error || 'تعذر تصفير المعاملات القديمة');

    toast.success(`تمت أرشفة ${formatNumber(result.archivedTransactions)} معاملة`);
    setOpen(false);
    setForm({ password: '', backupConfirmed: false, includeSheinCards: false, includeReceivedCards: false });
    router.refresh();
  }

  return (
    <>
      <div className="card border-red-200 p-5 dark:border-red-900">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-black text-red-700 dark:text-red-300">
              <AlertTriangle size={20} />
              حذف جميع المعاملات القديمة
            </h2>
            <p className="mt-2 text-sm leading-7 text-slate-500">
              يتم تنفيذها كأرشفة للمعاملات وحركاتها، ولا تمس الزبائن أو العملات أو المخزون إلا بخيار صريح.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 font-bold text-white hover:bg-red-500"
          >
            <Trash2 size={18} />
            حذف جميع المعاملات القديمة
          </button>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={resetTransactions}
            className="w-full max-w-xl rounded-lg border border-red-200 bg-white p-5 shadow-xl dark:border-red-900 dark:bg-slate-900"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-red-700 dark:text-red-300">تحذير مهم</h2>
                <p className="mt-2 text-sm leading-7 text-slate-500">
                  سيتم أرشفة كل المعاملات القديمة فقط. الزبائن والعملات والإعدادات تبقى كما هي.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق نافذة التصفير"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-4">
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                placeholder="كلمة المرور"
              />

              <label className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <input
                  type="checkbox"
                  checked={form.backupConfirmed}
                  onChange={(event) => setForm({ ...form, backupConfirmed: event.target.checked })}
                />
                أؤكد أنني أخذت نسخة احتياطية قبل تنفيذ الأرشفة
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm font-bold dark:border-slate-800 dark:bg-slate-900">
                <input
                  type="checkbox"
                  checked={form.includeSheinCards}
                  onChange={(event) => setForm({ ...form, includeSheinCards: event.target.checked })}
                />
                أرشفة كروت شي إن أيضًا
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm font-bold dark:border-slate-800 dark:bg-slate-900">
                <input
                  type="checkbox"
                  checked={form.includeReceivedCards}
                  onChange={(event) => setForm({ ...form, includeReceivedCards: event.target.checked })}
                />
                أرشفة البطاقات المستلمة أيضًا
              </label>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                disabled={loading}
                className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-400"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                {loading ? 'جار التنفيذ...' : 'تأكيد الأرشفة'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
