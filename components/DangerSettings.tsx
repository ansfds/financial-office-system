'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, DatabaseZap, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/format';
import ModalLayer, { ModalBackdrop } from '@/components/ModalLayer';

const TRANSACTION_RESET_CONFIRMATION_TEXT = 'RESET SYSTEM DATA';
const FULL_RESET_CONFIRMATION_TEXT = 'RESET FULL SYSTEM DATA';

type DangerSettingsProps = {
  resetEnabled: boolean;
};

export default function DangerSettings({ resetEnabled }: DangerSettingsProps) {
  const router = useRouter();
  const [transactionsOpen, setTransactionsOpen] = useState(false);
  const [fullResetOpen, setFullResetOpen] = useState(false);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [fullResetLoading, setFullResetLoading] = useState(false);
  const [transactionForm, setTransactionForm] = useState({
    resetPassword: '',
    confirmationText: '',
    includeSheinCards: false,
    includeReceivedCards: false,
  });
  const [fullResetForm, setFullResetForm] = useState({
    resetPassword: '',
    confirmationText: '',
  });

  function ensureResetEnabled() {
    if (resetEnabled) return true;
    toast.error('التصفير معطل حتى يتم ضبط RESET_SYSTEM_PASSWORD في متغيرات البيئة');
    return false;
  }

  function resetTransactionForm() {
    setTransactionForm({
      resetPassword: '',
      confirmationText: '',
      includeSheinCards: false,
      includeReceivedCards: false,
    });
  }

  function resetFullResetForm() {
    setFullResetForm({
      resetPassword: '',
      confirmationText: '',
    });
  }

  async function resetTransactions(event: React.FormEvent) {
    event.preventDefault();
    if (!ensureResetEnabled()) return;
    if (!transactionForm.resetPassword.trim()) return toast.error('أدخل كلمة مرور التصفير');
    if (transactionForm.confirmationText !== TRANSACTION_RESET_CONFIRMATION_TEXT) {
      return toast.error(`اكتب عبارة التأكيد كما هي: ${TRANSACTION_RESET_CONFIRMATION_TEXT}`);
    }
    if (
      !window.confirm(
        'تأكيد نهائي: سيتم أرشفة جميع المعاملات القديمة بعد إنشاء نسخة احتياطية تلقائية. لن يتم حذف الزبائن أو العملات.',
      )
    ) {
      return;
    }

    setTransactionsLoading(true);
    const response = await fetch('/api/admin/reset-transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transactionForm),
    });
    const result = await response.json();
    setTransactionsLoading(false);

    if (!response.ok) return toast.error(result.error || 'تعذر تصفير المعاملات القديمة');

    toast.success(`تمت أرشفة ${formatNumber(result.archivedTransactions)} معاملة`);
    setTransactionsOpen(false);
    resetTransactionForm();
    router.refresh();
  }

  async function resetFullSystem(event: React.FormEvent) {
    event.preventDefault();
    if (!ensureResetEnabled()) return;
    if (!fullResetForm.resetPassword.trim()) return toast.error('أدخل كلمة مرور التصفير');
    if (fullResetForm.confirmationText !== FULL_RESET_CONFIRMATION_TEXT) {
      return toast.error(`اكتب عبارة التأكيد كما هي: ${FULL_RESET_CONFIRMATION_TEXT}`);
    }
    if (
      !window.confirm(
        'تأكيد نهائي وخطير: سيتم حذف بيانات الشغل بالكامل بعد إنشاء نسخة احتياطية. سيبقى تسجيل الدخول والإعدادات الأساسية فقط.',
      )
    ) {
      return;
    }

    setFullResetLoading(true);
    const response = await fetch('/api/admin/reset-system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullResetForm),
    });
    const result = await response.json();
    setFullResetLoading(false);

    if (!response.ok) return toast.error(result.error || 'تعذر تنفيذ التصفير الكامل');

    toast.success(`تم حذف ${formatNumber(result.deleted.people)} زبون و${formatNumber(result.deleted.financialTransactions)} معاملة`);
    setFullResetOpen(false);
    resetFullResetForm();
    router.refresh();
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card border-red-200 p-5 dark:border-red-900">
          <div className="flex h-full flex-col gap-4">
            <div className="flex-1">
              <h2 className="flex items-center gap-2 font-black text-red-700 dark:text-red-300">
                <AlertTriangle size={20} />
                تصفير المعاملات فقط
              </h2>
              <p className="mt-2 text-sm leading-7 text-slate-500">
                يتم تنفيذها كأرشفة للمعاملات وحركاتها فقط، ولا تمس الزبائن أو العملات أو المخزون إلا بخيار صريح.
              </p>
              <ResetStatus resetEnabled={resetEnabled} />
            </div>
            <button
              type="button"
              onClick={() => ensureResetEnabled() && setTransactionsOpen(true)}
              disabled={!resetEnabled}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
            >
              <Trash2 size={18} />
              تصفير المعاملات فقط
            </button>
          </div>
        </section>

        <section className="card border-red-300 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/40">
          <div className="flex h-full flex-col gap-4">
            <div className="flex-1">
              <h2 className="flex items-center gap-2 font-black text-red-800 dark:text-red-200">
                <DatabaseZap size={20} />
                تصفير كامل للمنظومة
              </h2>
              <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                يحذف بيانات الشغل بالكامل: الزبائن، المعاملات، الصندوق، المخزون، البطاقات، المحفظة، وسجل التعديلات القديم. يبقي المستخدمين والإعدادات الأساسية.
              </p>
              <ResetStatus resetEnabled={resetEnabled} />
            </div>
            <button
              type="button"
              onClick={() => ensureResetEnabled() && setFullResetOpen(true)}
              disabled={!resetEnabled}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-3 font-black text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
            >
              <DatabaseZap size={18} />
              تصفير كامل للمنظومة
            </button>
          </div>
        </section>
      </div>

      {transactionsOpen ? (
        <ResetModal
          title="تصفير المعاملات فقط"
          description="سيتم إنشاء نسخة احتياطية تلقائية داخل قاعدة البيانات ثم أرشفة كل المعاملات القديمة فقط. الزبائن والعملات والإعدادات تبقى كما هي."
          confirmationText={TRANSACTION_RESET_CONFIRMATION_TEXT}
          loading={transactionsLoading}
          submitLabel="تأكيد الأرشفة"
          loadingLabel="جار الأرشفة..."
          onClose={() => setTransactionsOpen(false)}
          onSubmit={resetTransactions}
        >
          <input
            type="password"
            value={transactionForm.resetPassword}
            onChange={(event) => setTransactionForm({ ...transactionForm, resetPassword: event.target.value })}
            placeholder="كلمة مرور التصفير"
            autoComplete="off"
          />

          <input
            value={transactionForm.confirmationText}
            onChange={(event) => setTransactionForm({ ...transactionForm, confirmationText: event.target.value })}
            placeholder={TRANSACTION_RESET_CONFIRMATION_TEXT}
            autoComplete="off"
          />

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            سيتم تسجيل نسخة احتياطية تلقائية قبل الأرشفة، وسيتم حفظ اسم المستخدم الحالي في سجل التعديلات.
          </div>

          <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm font-bold dark:border-slate-800 dark:bg-slate-900">
            <input
              type="checkbox"
              checked={transactionForm.includeSheinCards}
              onChange={(event) => setTransactionForm({ ...transactionForm, includeSheinCards: event.target.checked })}
            />
            أرشفة كروت شي إن أيضًا
          </label>

          <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm font-bold dark:border-slate-800 dark:bg-slate-900">
            <input
              type="checkbox"
              checked={transactionForm.includeReceivedCards}
              onChange={(event) => setTransactionForm({ ...transactionForm, includeReceivedCards: event.target.checked })}
            />
            أرشفة البطاقات المستلمة أيضًا
          </label>
        </ResetModal>
      ) : null}

      {fullResetOpen ? (
        <ResetModal
          title="تصفير كامل للمنظومة"
          description="سيتم أخذ Backup كامل ثم حذف كل بيانات الشغل فقط. لا يتم حذف المستخدمين أو كلمات المرور المشفرة أو العملات أو أنواع المعاملات أو إعدادات النظام الأساسية."
          confirmationText={FULL_RESET_CONFIRMATION_TEXT}
          loading={fullResetLoading}
          submitLabel="تأكيد التصفير الكامل"
          loadingLabel="جار التصفير الكامل..."
          onClose={() => setFullResetOpen(false)}
          onSubmit={resetFullSystem}
          severe
        >
          <input
            type="password"
            value={fullResetForm.resetPassword}
            onChange={(event) => setFullResetForm({ ...fullResetForm, resetPassword: event.target.value })}
            placeholder="كلمة مرور التصفير"
            autoComplete="off"
          />

          <input
            value={fullResetForm.confirmationText}
            onChange={(event) => setFullResetForm({ ...fullResetForm, confirmationText: event.target.value })}
            placeholder={FULL_RESET_CONFIRMATION_TEXT}
            autoComplete="off"
          />

          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-black leading-7 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            هذا الخيار يمسح الزبائن والمعاملات وحركات الصندوق والمخزون والمحفظة وسجل التعديلات القديم. بعده تبقى المنظومة فارغة وجاهزة كبداية جديدة.
          </div>
        </ResetModal>
      ) : null}
    </>
  );
}

function ResetStatus({ resetEnabled }: { resetEnabled: boolean }) {
  return (
    <p
      className={`mt-2 text-sm font-bold ${
        resetEnabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
      }`}
    >
      {resetEnabled
        ? 'التصفير محمي بكلمة مرور مستقلة من RESET_SYSTEM_PASSWORD وعبارة تأكيد.'
        : 'زر التصفير معطل حتى يتم ضبط RESET_SYSTEM_PASSWORD في Vercel Environment Variables.'}
    </p>
  );
}

function ResetModal({
  title,
  description,
  confirmationText,
  loading,
  submitLabel,
  loadingLabel,
  onClose,
  onSubmit,
  children,
  severe = false,
}: {
  title: string;
  description: string;
  confirmationText: string;
  loading: boolean;
  submitLabel: string;
  loadingLabel: string;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  children: React.ReactNode;
  severe?: boolean;
}) {
  return (
    <ModalLayer name="danger-reset" onClose={onClose}>
      <ModalBackdrop onClick={onClose} />
      <form
        onSubmit={onSubmit}
        className={`modal-panel sheet-panel max-w-xl dark:bg-slate-900 ${
          severe ? 'border-red-400 dark:border-red-800' : 'border-red-200 dark:border-red-900'
        }`}
      >
        <div className="modal-header flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-red-700 dark:text-red-300">{title}</h2>
            <p className="mt-2 text-sm leading-7 text-slate-500">{description}</p>
            <p className="mt-2 text-sm font-bold text-slate-600 dark:text-slate-300">
              عبارة التأكيد المطلوبة: <span className="font-black text-red-700 dark:text-red-300">{confirmationText}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="modal-close text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="إغلاق نافذة التصفير"
          >
            <X size={20} />
          </button>
        </div>

        <div className="modal-body grid gap-4 p-5" data-modal-scroll-body>{children}</div>

        <div className="modal-footer grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            إلغاء
          </button>
          <button
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-400"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
            {loading ? loadingLabel : submitLabel}
          </button>
        </div>
      </form>
    </ModalLayer>
  );
}
