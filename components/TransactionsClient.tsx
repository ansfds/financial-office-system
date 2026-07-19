'use client';

import { useEffect, useState } from 'react';
import { Save, Search, X } from 'lucide-react';
import { toast } from 'sonner';

const statusLabels: Record<string, string> = {
  COMPLETED: 'مكتمل',
  RECEIVABLE: 'دين لنا',
  PAYABLE: 'دين علينا',
  PARTIAL: 'دفع جزئي',
  IN_PROGRESS: 'قيد التنفيذ',
  OVERDUE: 'متأخرة',
  CANCELLED: 'ملغاة',
};

function decimal(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function remaining(transaction: any) {
  return Math.max(
    decimal(transaction.agreedAmount) - decimal(transaction.receivedAmount) - decimal(transaction.paidAmount),
    0,
  );
}

function executionLabel(transaction: any) {
  return transaction.executionType || transaction.description || transaction.type?.name || transaction.customType || '—';
}

function shortNote(text?: string | null) {
  if (!text) return '—';
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

export default function TransactionsClient({ initialTransactions }: { initialTransactions: any[] }) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [q, setQ] = useState('');
  const [savingId, setSavingId] = useState('');
  const [noteModal, setNoteModal] = useState<{ open: boolean; text: string }>({ open: false, text: '' });

  useEffect(() => {
    setTransactions(initialTransactions);
  }, [initialTransactions]);

  function updateLocal(id: string, patch: any) {
    setTransactions((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function search() {
    const response = await fetch(`/api/transactions?q=${encodeURIComponent(q)}`);
    const data = await response.json();
    if (!response.ok) return toast.error(data.error || 'تعذر البحث');
    setTransactions(data);
  }

  async function save(transaction: any) {
    setSavingId(transaction.id);
    const response = await fetch(`/api/transactions/${transaction.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receivedAmount: decimal(transaction.receivedAmount),
        paidAmount: decimal(transaction.paidAmount),
        verificationReceived: Boolean(transaction.verificationReceived),
        secureInternalNote: transaction.secureInternalNote || null,
      }),
    });
    const data = await response.json();
    setSavingId('');

    if (!response.ok) return toast.error(data.error || 'تعذر حفظ التعديل');

    updateLocal(transaction.id, data);
    toast.success('تم تعديل الدفعة');
  }

  return (
    <div className="space-y-4">
      <div className="card grid gap-2 p-4 md:grid-cols-[1fr_auto]">
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="بحث بالزبون أو النوع أو الملاحظة" />
        <button
          type="button"
          onClick={search}
          className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 font-bold text-white dark:bg-slate-100 dark:text-slate-950"
        >
          <Search size={18} />
          بحث
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الزبون</th>
              <th>النوع</th>
              <th>نوع التنفيذ</th>
              <th>المستلم</th>
              <th>المدفوع</th>
              <th>المتبقي</th>
              <th>ملاحظات</th>
              <th>الحالة</th>
              <th>حفظ</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td>
                  {transaction.person ? (
                    <div>
                      <div className="font-bold">{transaction.person.fullName}</div>
                      <div className="text-xs text-slate-500">{transaction.person.customerNo || '—'}</div>
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{transaction.type?.name || transaction.customType || '—'}</td>
                <td className="min-w-72 text-sm font-bold text-slate-700 dark:text-slate-200">
                  {executionLabel(transaction)}
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    value={transaction.receivedAmount?.toString() || '0'}
                    onChange={(event) => updateLocal(transaction.id, { receivedAmount: event.target.value })}
                    className="min-w-28"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    value={transaction.paidAmount?.toString() || '0'}
                    onChange={(event) => updateLocal(transaction.id, { paidAmount: event.target.value })}
                    className="min-w-28"
                  />
                </td>
                <td className={remaining(transaction) === 0 ? 'font-bold text-emerald-600' : 'font-bold text-amber-600'}>
                  {remaining(transaction).toLocaleString('en-US')}
                </td>
                <td>
                  {transaction.notes ? (
                    <button
                      type="button"
                      onClick={() => setNoteModal({ open: true, text: transaction.notes })}
                      className="max-w-56 text-right text-sm text-indigo-600 hover:text-indigo-500"
                    >
                      {shortNote(transaction.notes)}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{remaining(transaction) === 0 ? 'مكتمل' : statusLabels[transaction.status] || transaction.status}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => save(transaction)}
                    disabled={savingId === transaction.id}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:bg-indigo-400"
                  >
                    <Save size={16} />
                    {savingId === transaction.id ? 'جار...' : 'حفظ'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {noteModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-lg font-black">ملاحظة</h2>
              <button
                type="button"
                onClick={() => setNoteModal({ open: false, text: '' })}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق الملاحظة"
              >
                <X size={20} />
              </button>
            </div>
            <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 leading-7 text-slate-700 dark:bg-slate-950 dark:text-slate-200">
              {noteModal.text}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
