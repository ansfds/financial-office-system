'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

const operationLabels: Record<string, string> = {
  MANUAL: 'نوع يدوي',
  USDT: 'USDT',
  CARD_OPERATION: 'عمليات بطاقة',
  CASHBOX_MOVEMENT: 'حركة صندوق',
  CURRENCY_CONVERSION: 'صرف / تحويل عملة',
  MONEY_TRANSFER: 'حوالة مالية',
  SHEIN_CARD_SALE: 'كروت شي إن',
  EXPENSE: 'مصروف / دفع فاتورة',
};

const simplePaymentLabels: Record<string, string> = {
  CASH: 'كاش',
  TRANSFER: 'حوالة',
  CARD: 'بطاقة مصرفية',
};

const detailedPaymentLabels: Record<string, string> = {
  LYD_CASH: 'كاش دينار',
  USD_CASH: 'كاش دولار',
  LYD_TRANSFER: 'حوالة دينار',
  USD_TRANSFER: 'حوالة دولار',
  CARD: 'بطاقة مصرفية',
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

function amountText(value: any, symbol?: string) {
  return `${decimal(value).toLocaleString('en-US')} ${symbol || ''}`.trim();
}

function detailsLabel(transaction: any) {
  const details = transaction.operationDetails || {};
  const symbol = transaction.currency?.symbol || '';

  if (transaction.operationKind === 'CARD_OPERATION') {
    return `${Number(details.cardCount || 0).toLocaleString('en-US')} بطاقات × ${amountText(details.cardValue, symbol)} = ${amountText(
      details.cardTotal,
      symbol,
    )}`;
  }

  if (transaction.operationKind === 'USDT') {
    return `${amountText(details.usdtAmount, 'USDT')} عبر ${details.network || '—'} - ${simplePaymentLabels[details.paymentMethod] || '—'}`;
  }

  if (transaction.operationKind === 'SHEIN_CARD_SALE') {
    return `${Number(details.cardCount || 0).toLocaleString('en-US')} كروت × ${amountText(details.pricePerCard, symbol)} = ${amountText(
      details.totalAmount,
      symbol,
    )}`;
  }

  if (transaction.operationKind === 'MONEY_TRANSFER') {
    return `${details.destination || '—'} / ${details.receiverName || '—'} - ${simplePaymentLabels[details.paymentMethod] || '—'}`;
  }

  if (transaction.operationKind === 'CURRENCY_CONVERSION') {
    return `${amountText(details.fromAmount)} إلى ${amountText(details.toAmount)} - سعر ${details.exchangeRate || '—'}`;
  }

  if (transaction.operationKind === 'EXPENSE') {
    return `${details.payee || '—'} - ${details.expenseType || '—'} - ${simplePaymentLabels[details.paymentMethod] || '—'}`;
  }

  if (transaction.operationKind === 'CASHBOX_MOVEMENT') {
    return `${details.reason || '—'} - ${simplePaymentLabels[details.movementMethod] || '—'}`;
  }

  if (transaction.operationKind === 'MANUAL') {
    return details.cashDirection ? `اتجاه العملية: ${details.cashDirection}` : '—';
  }

  return transaction.sheinPaymentMethod ? detailedPaymentLabels[transaction.sheinPaymentMethod] || transaction.sheinPaymentMethod : '—';
}

function shortNote(text?: string | null) {
  if (!text) return '—';
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

export default function TransactionsClient({
  initialTransactions,
  initialPage,
  initialTotal,
  pageSize,
  initialQuery = '',
}: {
  initialTransactions: any[];
  initialPage: number;
  initialTotal: number;
  pageSize: number;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [transactions, setTransactions] = useState(initialTransactions);
  const [q, setQ] = useState(initialQuery);
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [noteModal, setNoteModal] = useState<{ open: boolean; text: string }>({ open: false, text: '' });

  useEffect(() => {
    setTransactions(initialTransactions);
    setPage(initialPage);
    setTotal(initialTotal);
    setQ(initialQuery);
  }, [initialPage, initialQuery, initialTotal, initialTransactions]);

  function updateLocal(id: string, patch: any) {
    setTransactions((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function load(nextPage = page, search = q) {
    setLoading(true);
    const response = await fetch(
      `/api/transactions?q=${encodeURIComponent(search)}&page=${nextPage}&pageSize=${pageSize}`,
      { cache: 'no-store' },
    );
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return toast.error(data.error || 'تعذر البحث');
    const items = Array.isArray(data) ? data : data.items || [];
    setTransactions(items);
    setTotal(Array.isArray(data) ? items.length : data.total || 0);
    setPage(Array.isArray(data) ? 1 : data.page || nextPage);
    const url = new URL(window.location.href);
    if (search) url.searchParams.set('q', search);
    else url.searchParams.delete('q');
    url.searchParams.set('page', String(nextPage));
    window.history.replaceState(null, '', url.toString());
  }

  async function search() {
    await load(1, q);
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
    router.refresh();
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
          {loading ? 'جار...' : 'بحث'}
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الزبون</th>
              <th>النوع</th>
              <th>التفاصيل</th>
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
                <td>{operationLabels[transaction.operationKind] || transaction.type?.name || transaction.customType || '—'}</td>
                <td className="min-w-64 text-sm text-slate-600 dark:text-slate-300">{detailsLabel(transaction)}</td>
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
            {!transactions.length ? (
              <tr>
                <td colSpan={10} className="text-center text-slate-500">
                  {loading ? 'جار تحميل المعاملات...' : 'لا توجد معاملات'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="card flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="font-bold text-slate-600 dark:text-slate-300">
          الصفحة {page.toLocaleString('en-US')} من {Math.max(Math.ceil(total / pageSize), 1).toLocaleString('en-US')} - إجمالي{' '}
          {total.toLocaleString('en-US')}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => load(Math.max(page - 1, 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg border border-slate-200 px-4 py-2 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            السابق
          </button>
          <button
            type="button"
            onClick={() => load(page + 1)}
            disabled={page * pageSize >= total || loading}
            className="rounded-lg border border-slate-200 px-4 py-2 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            التالي
          </button>
        </div>
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
