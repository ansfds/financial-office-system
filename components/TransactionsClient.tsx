'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Eye, Link2, Loader2, Save, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, formatMoney, formatNumber, numberValue } from '@/lib/format';
import {
  paymentMethodLabel,
  simplePaymentLabels,
} from '@/lib/payment-methods';

const statusLabels: Record<string, string> = {
  COMPLETED: 'مكتمل',
  RECEIVABLE: 'دين لنا',
  PAYABLE: 'دين علينا',
  PARTIAL: 'دفع جزئي',
  IN_PROGRESS: 'قيد التنفيذ',
  OVERDUE: 'متأخرة',
  CANCELLED: 'ملغاة',
};

type ExecutionStatus = 'PENDING' | 'COMPLETED' | 'NOT_EXECUTED';

const executionStatusLabels: Record<ExecutionStatus, string> = {
  PENDING: 'في انتظار التنفيذ',
  COMPLETED: 'تم التنفيذ',
  NOT_EXECUTED: 'لم يتم التنفيذ',
};

const notExecutedActionLabels: Record<string, string> = {
  REFUND: 'إرجاع المبلغ للزبون',
  CONVERT_TO_WALLET: 'تحويله إلى رصيد للزبون في المحفظة',
  KEEP_WITH_NOTE: 'إبقاؤه مع ملاحظة',
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

function decimal(value: any) {
  return numberValue(value);
}

function remaining(transaction: any) {
  if (
    transaction.operationKind === 'CARD_OPERATION' &&
    transaction.operationDetails?.action === 'RECEIVE_CARD'
  ) {
    return 0;
  }

  return Math.max(
    decimal(transaction.agreedAmount) - decimal(transaction.receivedAmount) - decimal(transaction.paidAmount),
    0,
  );
}

function executionLabel(transaction: any) {
  return transaction.executionType || transaction.description || transaction.type?.name || transaction.customType || '—';
}

function amountText(value: any, symbol?: string) {
  return formatMoney(value, symbol || '');
}

function detailsLabel(transaction: any) {
  const details = transaction.operationDetails || {};
  const symbol = transaction.currency?.symbol || '';

  if (transaction.operationKind === 'CARD_OPERATION') {
    return `${formatNumber(details.cardCount || 0)} بطاقات × ${amountText(details.cardValue, symbol)} = ${amountText(
      details.cardTotal,
      symbol,
    )}`;
  }

  if (transaction.operationKind === 'USDT') {
    if (details.totalUsd !== undefined) {
      const paymentLabel = details.paymentCurrencyCode === 'LYD' ? 'دينار' : 'دولار';
      const paymentTotal =
        details.paymentCurrencyCode === 'LYD'
          ? amountText(details.totalLyd || details.paymentTotal, symbol)
          : amountText(details.totalUsd, '$');

      return `${amountText(details.usdtAmount, 'USDT')} عبر ${details.network || '—'} - عمولة ${
        details.commissionPercent ?? 0
      }% - الإجمالي ${amountText(details.totalUsd, '$')} - الدفع ${paymentLabel}: ${paymentTotal}`;
    }

    return `${amountText(details.usdtAmount, 'USDT')} عبر ${details.network || '—'} - ${
      simplePaymentLabels[details.paymentMethod as keyof typeof simplePaymentLabels] || '—'
    }`;
  }

  if (transaction.operationKind === 'SHEIN_CARD_SALE') {
    return `${formatNumber(details.cardCount || 0)} كروت × ${amountText(details.pricePerCard, symbol)} = ${amountText(
      details.totalAmount,
      symbol,
    )}`;
  }

  if (transaction.operationKind === 'MONEY_TRANSFER') {
    return `${details.destination || '—'} / ${details.receiverName || '—'} - ${
      simplePaymentLabels[details.paymentMethod as keyof typeof simplePaymentLabels] || '—'
    }`;
  }

  if (transaction.operationKind === 'CURRENCY_CONVERSION') {
    return `${amountText(details.fromAmount)} إلى ${amountText(details.toAmount)} - سعر ${details.exchangeRate || '—'}`;
  }

  if (transaction.operationKind === 'EXPENSE') {
    return `${details.payee || '—'} - ${details.expenseType || '—'} - ${
      simplePaymentLabels[details.paymentMethod as keyof typeof simplePaymentLabels] || '—'
    }`;
  }

  if (transaction.operationKind === 'CASHBOX_MOVEMENT') {
    return `${details.reason || '—'} - ${simplePaymentLabels[details.movementMethod as keyof typeof simplePaymentLabels] || '—'}`;
  }

  if (transaction.operationKind === 'MANUAL') {
    return details.cashDirection ? `اتجاه العملية: ${details.cashDirection}` : '—';
  }

  return transaction.sheinPaymentMethod ? paymentMethodLabel(transaction.sheinPaymentMethod) : '—';
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
  initialExecutionStatus = 'PENDING',
}: {
  initialTransactions: any[];
  initialPage: number;
  initialTotal: number;
  pageSize: number;
  initialQuery?: string;
  initialExecutionStatus?: ExecutionStatus;
}) {
  const router = useRouter();
  const [transactions, setTransactions] = useState(initialTransactions);
  const [q, setQ] = useState(initialQuery);
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(initialTotal);
  const [activeExecutionStatus, setActiveExecutionStatus] = useState<ExecutionStatus>(initialExecutionStatus);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [availableCards, setAvailableCards] = useState<any[]>([]);
  const [executionLoading, setExecutionLoading] = useState(false);
  const [noteModal, setNoteModal] = useState<{ open: boolean; text: string }>({ open: false, text: '' });
  const [editor, setEditor] = useState<{ transaction: any; draft: any } | null>(null);

  useEffect(() => {
    setTransactions(initialTransactions);
    setPage(initialPage);
    setTotal(initialTotal);
    setQ(initialQuery);
    setActiveExecutionStatus(initialExecutionStatus);
  }, [initialExecutionStatus, initialPage, initialQuery, initialTotal, initialTransactions]);

  function updateLocal(id: string, patch: any) {
    setTransactions((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function load(nextPage = page, search = q, executionStatus = activeExecutionStatus) {
    setLoading(true);
    const response = await fetch(
      `/api/transactions?q=${encodeURIComponent(search)}&page=${nextPage}&pageSize=${pageSize}&executionStatus=${executionStatus}`,
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
    url.searchParams.set('executionStatus', executionStatus);
    window.history.replaceState(null, '', url.toString());
  }

  async function search() {
    await load(1, q, activeExecutionStatus);
  }

  async function switchExecutionStatus(status: ExecutionStatus) {
    setActiveExecutionStatus(status);
    await load(1, q, status);
  }

  async function loadExecutionDetails(transactionId: string) {
    setExecutionLoading(true);
    const response = await fetch(`/api/transactions/${transactionId}/execution-items`, { cache: 'no-store' });
    const data = await response.json();
    setExecutionLoading(false);

    if (!response.ok) {
      toast.error(data.error || 'تعذر تحميل تفاصيل التنفيذ');
      return null;
    }

    setAvailableCards(data.availableCards || []);
    updateLocal(transactionId, data.transaction);
    return data.transaction;
  }

  async function openEditor(transaction: any) {
    setAvailableCards([]);
    const detailedTransaction =
      transaction.operationKind === 'SHEIN_CARD_SALE' ? (await loadExecutionDetails(transaction.id)) || transaction : transaction;

    setEditor({
      transaction: detailedTransaction,
      draft: {
        receivedAmount: decimal(detailedTransaction.receivedAmount),
        paidAmount: decimal(detailedTransaction.paidAmount),
        bankName: detailedTransaction.bankName || '',
        executionType: detailedTransaction.executionType || '',
        executionStatus: detailedTransaction.executionStatus || 'COMPLETED',
        executionNote: detailedTransaction.executionNote || '',
        notExecutedAction: detailedTransaction.notExecutedAction || '',
        verificationReceived: Boolean(detailedTransaction.verificationReceived),
        secureInternalNote: detailedTransaction.secureInternalNote || '',
        notes: detailedTransaction.notes || '',
      },
    });
  }

  async function saveEditor() {
    if (!editor) return;
    if (
      editor.draft.executionStatus === 'NOT_EXECUTED' &&
      (decimal(editor.transaction.receivedAmount) > 0 || decimal(editor.transaction.paidAmount) > 0) &&
      !editor.draft.notExecutedAction
    ) {
      return toast.error('اختر طريقة التعامل مع المبلغ');
    }
    if (
      editor.draft.executionStatus === 'NOT_EXECUTED' &&
      editor.draft.notExecutedAction === 'KEEP_WITH_NOTE' &&
      !editor.draft.executionNote.trim()
    ) {
      return toast.error('اكتب ملاحظة واضحة');
    }
    if (!window.confirm('تأكيد تعديل المعاملة وتحديث أثر الصندوق حسب فرق المبلغ؟')) return;

    setSavingId(editor.transaction.id);
    const response = await fetch(`/api/transactions/${editor.transaction.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receivedAmount: decimal(editor.draft.receivedAmount),
        paidAmount: decimal(editor.draft.paidAmount),
        bankName: editor.draft.bankName || null,
        executionType: editor.draft.executionType || null,
        executionStatus: editor.draft.executionStatus,
        executionNote: editor.draft.executionNote || null,
        notExecutedAction:
          editor.draft.executionStatus === 'NOT_EXECUTED' ? editor.draft.notExecutedAction || null : null,
        verificationReceived: Boolean(editor.draft.verificationReceived),
        secureInternalNote: editor.draft.secureInternalNote || null,
        notes: editor.draft.notes || null,
      }),
    });
    const data = await response.json();
    setSavingId('');

    if (!response.ok) return toast.error(data.error || 'تعذر حفظ التعديل');

    updateLocal(editor.transaction.id, data);
    setEditor(null);
    toast.success('تم تعديل المعاملة وتحديث الصندوق بالفرق فقط');
    router.refresh();
  }

  async function refreshEditorTransaction(transactionId: string, transaction?: any) {
    const nextTransaction = transaction || (await loadExecutionDetails(transactionId));
    if (!nextTransaction) return;

    setEditor((current) => (current ? { ...current, transaction: nextTransaction } : current));
    updateLocal(transactionId, nextTransaction);
  }

  async function updateExecutionItem(item: any, payload: any) {
    if (!editor) return;

    setSavingId(item.id);
    const response = await fetch(`/api/transactions/${editor.transaction.id}/execution-items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setSavingId('');

    if (!response.ok) return toast.error(data.error || 'تعذر تحديث عنصر التنفيذ');

    toast.success('تم تحديث عنصر التنفيذ');
    await refreshEditorTransaction(editor.transaction.id, data);
    await loadExecutionDetails(editor.transaction.id);
    router.refresh();
  }

  async function completeAllExecutionItems() {
    if (!editor) return;

    setSavingId(editor.transaction.id);
    const response = await fetch(`/api/transactions/${editor.transaction.id}/execution-items`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'COMPLETE_ALL' }),
    });
    const data = await response.json();
    setSavingId('');

    if (!response.ok) return toast.error(data.error || 'تعذر تنفيذ الطلب بالكامل');

    toast.success('تم تنفيذ الطلب بالكامل');
    await refreshEditorTransaction(editor.transaction.id, data);
    await loadExecutionDetails(editor.transaction.id);
    router.refresh();
  }

  function renderExecutionItemsPanel() {
    if (!editor || editor.transaction.operationKind !== 'SHEIN_CARD_SALE') return null;

    const items = editor.transaction.executionItems || [];
    const completed = items.filter((item: any) => item.status === 'COMPLETED').length;
    const allLinked = items.length > 0 && items.every((item: any) => item.sheinCardId);

    return (
      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800 md:col-span-2">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-black">كروت التنفيذ</div>
            <div className="mt-1 text-sm text-slate-500">
              تم تنفيذ {formatNumber(completed)} من {formatNumber(items.length)}
            </div>
          </div>
          <button
            type="button"
            onClick={completeAllExecutionItems}
            disabled={!allLinked || completed === items.length || savingId === editor.transaction.id}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {savingId === editor.transaction.id ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
            تم تنفيذ الطلب بالكامل
          </button>
        </div>

        {executionLoading ? (
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm font-bold text-slate-500 dark:bg-slate-950">
            <Loader2 className="animate-spin" size={16} />
            جار تحميل الكروت
          </div>
        ) : null}

        <div className="grid gap-3">
          {items.map((item: any) => {
            const availableOptions = availableCards.filter((card) => card.id !== item.sheinCardId);
            return (
              <div
                key={item.id}
                className="grid gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800 lg:grid-cols-[110px_150px_1fr_auto]"
              >
                <div className="font-black">كرت {item.itemNumber}</div>
                <div className="font-bold">
                  {executionStatusLabels[(item.status || 'PENDING') as ExecutionStatus] || item.status}
                </div>
                <select
                  value={item.sheinCardId || ''}
                  onChange={(event) => updateExecutionItem(item, { sheinCardId: event.target.value || null })}
                  disabled={savingId === item.id || item.status === 'COMPLETED'}
                >
                  <option value="">
                    {availableCards.length || item.sheinCard ? 'اختر كرت من المخزون' : 'لا توجد كروت متوفرة حاليا'}
                  </option>
                  {item.sheinCard ? (
                    <option value={item.sheinCard.id}>
                      {item.sheinCard.code} - مرتبط
                    </option>
                  ) : null}
                  {availableOptions.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.code}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => updateExecutionItem(item, { status: 'COMPLETED' })}
                  disabled={!item.sheinCardId || item.status === 'COMPLETED' || savingId === item.id}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300"
                >
                  {savingId === item.id ? <Loader2 className="animate-spin" size={16} /> : <Link2 size={16} />}
                  تم التنفيذ
                </button>
                {item.sheinCard ? (
                  <div className="text-xs font-bold text-slate-500 lg:col-span-4">
                    الكرت الفعلي: {item.sheinCard.code}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!items.length ? <div className="text-sm text-slate-500">لا توجد عناصر تنفيذ لهذا الطلب.</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(executionStatusLabels) as ExecutionStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => switchExecutionStatus(status)}
            className={`rounded-lg border px-4 py-3 text-sm font-black ${
              activeExecutionStatus === status
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            {executionStatusLabels[status]}
          </button>
        ))}
      </div>

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
              <th>عدد العناصر</th>
              <th>التفاصيل</th>
              <th>نوع التنفيذ</th>
              <th>المستلم</th>
              <th>المدفوع</th>
              <th>المتبقي</th>
              <th>ملاحظات</th>
              <th>أضيفت بواسطة</th>
              <th>حالة التنفيذ</th>
              <th>الحالة</th>
              <th>عرض / تعديل</th>
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
                <td className="font-bold">
                  {formatNumber(transaction.operationDetails?.cardCount || transaction.executionItems?.length || 0)}
                </td>
                <td className="min-w-64 text-sm text-slate-600 dark:text-slate-300">
                  <div>{detailsLabel(transaction)}</div>
                  {transaction.operationKind === 'CARD_OPERATION' &&
                  transaction.operationDetails?.action === 'RECEIVE_CARD' &&
                  transaction.operationDetails?.receivedCardBatchId ? (
                    <button
                      type="button"
                      onClick={() => router.push(`/inventory/received-cards?batchId=${transaction.operationDetails.receivedCardBatchId}`)}
                      className="mt-2 rounded-md bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-200"
                    >
                      عرض البطاقات
                    </button>
                  ) : null}
                </td>
                <td className="min-w-72 text-sm font-bold text-slate-700 dark:text-slate-200">
                  {executionLabel(transaction)}
                </td>
                <td>
                  {formatMoney(transaction.receivedAmount, transaction.currency?.symbol)}
                </td>
                <td>
                  {formatMoney(transaction.paidAmount, transaction.currency?.symbol)}
                </td>
                <td className={remaining(transaction) === 0 ? 'font-bold text-emerald-600' : 'font-bold text-amber-600'}>
                  {formatMoney(remaining(transaction), transaction.currency?.symbol)}
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
                <td>{transaction.createdBy || 'system'}</td>
                <td className="font-bold">
                  {executionStatusLabels[(transaction.executionStatus || 'COMPLETED') as ExecutionStatus] ||
                    transaction.executionStatus}
                </td>
                <td>{remaining(transaction) === 0 ? 'مكتمل' : statusLabels[transaction.status] || transaction.status}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => openEditor(transaction)}
                    disabled={savingId === transaction.id}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:bg-indigo-400"
                  >
                    <Eye size={16} />
                    عرض / تعديل
                  </button>
                </td>
              </tr>
            ))}
            {!transactions.length ? (
              <tr>
                <td colSpan={13} className="text-center text-slate-500">
                  {loading ? 'جار تحميل المعاملات...' : 'لا توجد معاملات'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="card flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="font-bold text-slate-600 dark:text-slate-300">
          الصفحة {formatNumber(page)} من {formatNumber(Math.max(Math.ceil(total / pageSize), 1))} - إجمالي {formatNumber(total)}
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

      {editor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black">عرض / تعديل المعاملة {editor.transaction.number}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {operationLabels[editor.transaction.operationKind] || editor.transaction.type?.name || editor.transaction.customType || '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق نافذة تعديل المعاملة"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Info label="الزبون" value={editor.transaction.person?.fullName || '—'} />
              <Info label="التاريخ" value={editor.transaction.transactionAt ? formatDateTime(editor.transaction.transactionAt) : '—'} />
              <Info label="التفاصيل" value={detailsLabel(editor.transaction)} className="md:col-span-2" />

              <Field label="نوع التنفيذ" className="md:col-span-2">
                <textarea
                  rows={3}
                  value={editor.draft.executionType}
                  onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, executionType: event.target.value } })}
                />
              </Field>
              <Field label="حالة التنفيذ">
                <select
                  value={editor.draft.executionStatus}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      draft: { ...editor.draft, executionStatus: event.target.value, notExecutedAction: '' },
                    })
                  }
                >
                  {(Object.keys(executionStatusLabels) as ExecutionStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {executionStatusLabels[status]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ملاحظة التنفيذ">
                <input
                  value={editor.draft.executionNote}
                  onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, executionNote: event.target.value } })}
                />
              </Field>
              {editor.draft.executionStatus === 'NOT_EXECUTED' ? (
                <Field label="طريقة التعامل مع المبلغ" className="md:col-span-2">
                  <select
                    value={editor.draft.notExecutedAction}
                    onChange={(event) =>
                      setEditor({ ...editor, draft: { ...editor.draft, notExecutedAction: event.target.value } })
                    }
                  >
                    <option value="">اختر الإجراء</option>
                    {Object.entries(notExecutedActionLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="المستلم">
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={editor.draft.receivedAmount}
                  onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, receivedAmount: event.target.value } })}
                />
              </Field>
              <Field label="المدفوع">
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={editor.draft.paidAmount}
                  onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, paidAmount: event.target.value } })}
                />
              </Field>
              <Field label="اسم المصرف">
                <input
                  value={editor.draft.bankName}
                  onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, bankName: event.target.value } })}
                />
              </Field>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-3 text-sm font-bold dark:border-slate-800">
                <input
                  type="checkbox"
                  checked={editor.draft.verificationReceived}
                  onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, verificationReceived: event.target.checked } })}
                />
                تم استلام التحقق
              </label>
              <Field label="ملاحظة داخلية آمنة" className="md:col-span-2">
                <textarea
                  rows={3}
                  value={editor.draft.secureInternalNote}
                  onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, secureInternalNote: event.target.value } })}
                />
              </Field>
              <Field label="ملاحظات" className="md:col-span-2">
                <textarea
                  rows={3}
                  value={editor.draft.notes}
                  onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, notes: event.target.value } })}
                />
              </Field>

              {renderExecutionItemsPanel()}

              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800 md:col-span-2">
                <div className="mb-2 text-sm font-black">تفاصيل العملية الخام</div>
                <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-left text-xs leading-6 dark:bg-slate-950" dir="ltr">
                  {JSON.stringify(editor.transaction.operationDetails || {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={saveEditor}
                disabled={savingId === editor.transaction.id}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-500 disabled:bg-indigo-400"
              >
                <Save size={18} />
                {savingId === editor.transaction.id ? 'جار الحفظ...' : 'حفظ التعديل'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">{label}</label>
      {children}
    </div>
  );
}

function Info({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 p-3 dark:border-slate-800 ${className}`}>
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{value}</div>
    </div>
  );
}
