'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import CenteredDialog from './CenteredDialog';
import { invalidateFinanceClient } from '@/lib/client-cache';
import { apiFetch, readApiJson } from '@/lib/api-client';
export default function DangerSettings({ resetEnabled }: { resetEnabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(''),
    [challenge, setChallenge] = useState(''),
    [confirmation, setConfirmation] = useState('');
  function close() {
    if (busy) return;
    setOpen(false);
    setPassword('');
    setChallenge('');
    setConfirmation('');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const response = await apiFetch('/api/admin/reset-system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          challenge
            ? { step: 'confirm', challenge, confirmationText: confirmation }
            : { step: 'verify', resetPassword: password },
        ),
      });
      const result = await readApiJson(response);
      if (!response.ok) {
        if (challenge && response.status === 403) setChallenge('');
        throw new Error(result.error);
      }
      setPassword('');
      if (!challenge) {
        setChallenge(result.challenge);
        return;
      }
      toast.success(`تم التصفير وحفظ النسخة: ${result.filename}`);
      setOpen(false);
      setChallenge('');
      setConfirmation('');
      await invalidateFinanceClient();
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message || 'تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card border-red-300 p-5 dark:border-red-900">
      <h2 className="font-black text-red-700">تصفير المنظومة</h2>
      <p className="my-3 text-sm leading-7">
        عملية حساسة تحذف بيانات العمل: الزبائن والبطاقات والسحبات والمعاملات ولنا وعلينا والصندوق والمخزون
        والملاحظات اليومية. تبقى الحسابات والصلاحيات والإعدادات والعملات والنسخ الاحتياطية. تُحفظ نسخة كاملة
        قبل الحذف، وتُلغى العملية كلها عند أي فشل.
      </p>
      <button
        disabled={!resetEnabled}
        onClick={() => setOpen(true)}
        className="rounded-lg bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-40"
      >
        تصفير المنظومة
      </button>
      {!resetEnabled && (
        <p className="mt-2 text-sm text-slate-500">
          متاح فقط للمسؤول المخوّل بعد إعداد كلمة مرور التصفير على الخادم.
        </p>
      )}
      {open && (
        <CenteredDialog name="danger-reset" title="تصفير المنظومة" onClose={close} busy={busy}>
          <form onSubmit={submit} className="space-y-4">
            {!challenge ? (
              <label className="block">
                كلمة مرور التصفير
                <input
                  type="password"
                  required
                  value={password}
                  maxLength={500}
                  autoComplete="off"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            ) : (
              <>
                <p role="alert" className="rounded-lg bg-red-50 p-3 font-bold text-red-800">
                  سيتم حذف جميع بيانات العمل من المنظومة. هل أنت متأكد؟ التأكيد صالح لمدة خمس دقائق.
                </p>
                <label className="block">
                  اكتب «تصفير» للتأكيد النهائي
                  <input
                    value={confirmation}
                    required
                    onChange={(e) => setConfirmation(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
            <div className="flex gap-3">
              <button type="button" disabled={busy} onClick={close}>
                إلغاء
              </button>
              <button
                className="rounded-lg bg-red-700 px-4 py-2 text-white disabled:opacity-40"
                disabled={busy || Boolean(challenge && confirmation !== 'تصفير')}
              >
                {busy ? 'جار التنفيذ…' : challenge ? 'تأكيد التصفير النهائي' : 'التحقق من كلمة المرور'}
              </button>
            </div>
          </form>
        </CenteredDialog>
      )}
    </section>
  );
}
