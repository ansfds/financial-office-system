'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChevronDown, Loader2, Plus, Repeat2 } from 'lucide-react';
import { toast } from 'sonner';

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value: unknown) {
  return numberValue(value).toLocaleString('en-US');
}

function dayKey(value: string) {
  const date = new Date(value);
  return date.toISOString().slice(0, 10);
}

export default function CashboxClient() {
  const [movements, setMovements] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [openDay, setOpenDay] = useState('');
  const [currencyFilterId, setCurrencyFilterId] = useState('');
  const [manualForm, setManualForm] = useState({
    currencyId: '',
    direction: 'IN',
    amount: '',
    reason: '',
    note: '',
    createdBy: '',
  });
  const [conversionForm, setConversionForm] = useState({
    fromCurrencyId: '',
    toCurrencyId: '',
    fromAmount: '',
    toAmount: '',
    operatorName: '',
    notes: '',
  });

  const conversionCurrencies = useMemo(() => currencies, [currencies]);

  const exchangeRate = useMemo(() => {
    const from = numberValue(conversionForm.fromAmount);
    const to = numberValue(conversionForm.toAmount);
    return from > 0 && to > 0 ? to / from : 0;
  }, [conversionForm.fromAmount, conversionForm.toAmount]);

  const groupedMovements = useMemo(() => {
    const result = new Map<string, any[]>();
    for (const movement of movements) {
      const key = dayKey(movement.occurredAt);
      result.set(key, [...(result.get(key) || []), movement]);
    }
    return Array.from(result.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [movements]);

  async function load(filterId = currencyFilterId) {
    setLoading(true);
    const query = filterId ? `?currencyId=${encodeURIComponent(filterId)}` : '';
    const [cashboxResponse, settingsResponse] = await Promise.all([
      fetch(`/api/cashbox${query}`),
      fetch('/api/settings'),
    ]);
    const cashboxData = await cashboxResponse.json();
    const settingsData = await settingsResponse.json();
    setLoading(false);

    if (!cashboxResponse.ok) return toast.error(cashboxData.error || 'تعذر تحميل الصندوق');
    if (!settingsResponse.ok) return toast.error(settingsData.error || 'تعذر تحميل الإعدادات');

    setMovements(Array.isArray(cashboxData) ? cashboxData : []);
    setCurrencies(settingsData.currencies || []);

    const defaultCurrencyId = settingsData.currencies?.[0]?.id || '';
    const usd = settingsData.currencies?.find((currency: any) => currency.code === 'USD');
    const lyd = settingsData.currencies?.find((currency: any) => currency.code === 'LYD');
    const loadedConversionCurrencies = settingsData.currencies || [];

    setManualForm((value) => ({ ...value, currencyId: value.currencyId || defaultCurrencyId }));
    setConversionForm((value) => ({
      ...value,
      fromCurrencyId: value.fromCurrencyId || usd?.id || loadedConversionCurrencies[0]?.id || '',
      toCurrencyId: value.toCurrencyId || lyd?.id || loadedConversionCurrencies[1]?.id || '',
    }));
    setOpenDay((value) => value || (cashboxData[0] ? dayKey(cashboxData[0].occurredAt) : ''));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialCurrencyFilter = params.get('currencyId') || '';
    setCurrencyFilterId(initialCurrencyFilter);
    load(initialCurrencyFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addManualMovement(event: React.FormEvent) {
    event.preventDefault();
    if (!window.confirm('تأكيد تسجيل حركة تؤثر على رصيد الصندوق؟')) return;

    const response = await fetch('/api/cashbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manualForm),
    });
    const data = await response.json();
    if (!response.ok) return toast.error(data.error || 'تعذر تسجيل حركة الصندوق');

    toast.success('تم تسجيل حركة الصندوق');
    setManualForm((value) => ({ ...value, amount: '', reason: '', note: '' }));
    load();
  }

  async function convertCurrency(event: React.FormEvent) {
    event.preventDefault();
    if (!window.confirm('تأكيد تحويل العملة وتحديث أرصدة الصندوق؟')) return;

    const response = await fetch('/api/cashbox/conversions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conversionForm),
    });
    const data = await response.json();
    if (!response.ok) return toast.error(data.error || 'تعذر تنفيذ تحويل العملة');

    toast.success('تم تنفيذ تحويل العملة وتحديث الصندوق');
    setConversionForm((value) => ({ ...value, fromAmount: '', toAmount: '', notes: '' }));
    load();
  }

  function swapConversionCurrencies() {
    setConversionForm((value) => ({
      ...value,
      fromCurrencyId: value.toCurrencyId,
      toCurrencyId: value.fromCurrencyId,
      fromAmount: value.toAmount,
      toAmount: value.fromAmount,
    }));
  }

  function changeFilter(value: string) {
    setCurrencyFilterId(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('currencyId', value);
    else url.searchParams.delete('currencyId');
    window.history.replaceState(null, '', url.toString());
    load(value);
  }

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-black">حركة صندوق يدوية</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              استخدمها للإيداع أو السحب اليدوي فقط، أما البيع والتصفية والتحويل فتسجل تلقائيًا.
            </p>
          </div>
          <select className="md:max-w-xs" value={currencyFilterId} onChange={(event) => changeFilter(event.target.value)}>
            <option value="">كل العملات</option>
            {currencies.map((currency) => (
              <option key={currency.id} value={currency.id}>
                {currency.name}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={addManualMovement} className="grid gap-3 md:grid-cols-3">
          <select
            value={manualForm.currencyId}
            onChange={(event) => setManualForm({ ...manualForm, currencyId: event.target.value })}
          >
            {currencies.map((currency) => (
              <option key={currency.id} value={currency.id}>
                {currency.name}
              </option>
            ))}
          </select>
          <select
            value={manualForm.direction}
            onChange={(event) => setManualForm({ ...manualForm, direction: event.target.value })}
          >
            <option value="IN">إيداع</option>
            <option value="OUT">سحب</option>
          </select>
          <input
            type="number"
            step="0.000001"
            min="0"
            placeholder="المبلغ"
            value={manualForm.amount}
            onChange={(event) => setManualForm({ ...manualForm, amount: event.target.value })}
          />
          <input
            placeholder="السبب"
            value={manualForm.reason}
            onChange={(event) => setManualForm({ ...manualForm, reason: event.target.value })}
          />
          <input
            placeholder="اسم منفذ العملية"
            value={manualForm.createdBy}
            onChange={(event) => setManualForm({ ...manualForm, createdBy: event.target.value })}
          />
          <input
            placeholder="ملاحظة"
            value={manualForm.note}
            onChange={(event) => setManualForm({ ...manualForm, note: event.target.value })}
          />
          <button className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-500 md:col-span-3">
            <Plus size={18} />
            تسجيل الحركة
          </button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-black">
          <ArrowLeftRight size={20} />
          تحويل عملة
        </h2>
        <form onSubmit={convertCurrency} className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
          <div className="grid gap-3">
            <select
              value={conversionForm.fromCurrencyId}
              onChange={(event) => setConversionForm({ ...conversionForm, fromCurrencyId: event.target.value })}
            >
              {conversionCurrencies.map((currency) => (
                <option key={currency.id} value={currency.id}>
                  {currency.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.000001"
              placeholder="المبلغ الأول"
              value={conversionForm.fromAmount}
              onChange={(event) => setConversionForm({ ...conversionForm, fromAmount: event.target.value })}
            />
          </div>

          <button
            type="button"
            onClick={swapConversionCurrencies}
            className="grid h-12 w-12 place-items-center self-center justify-self-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            aria-label="قلب العملات"
          >
            <Repeat2 size={20} />
          </button>

          <div className="grid gap-3">
            <select
              value={conversionForm.toCurrencyId}
              onChange={(event) => setConversionForm({ ...conversionForm, toCurrencyId: event.target.value })}
            >
              {conversionCurrencies.map((currency) => (
                <option key={currency.id} value={currency.id}>
                  {currency.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.000001"
              placeholder="المبلغ الثاني"
              value={conversionForm.toAmount}
              onChange={(event) => setConversionForm({ ...conversionForm, toAmount: event.target.value })}
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-bold dark:border-slate-800 dark:bg-slate-950 md:col-span-3">
            سعر الصرف = {exchangeRate ? exchangeRate.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '0'}
          </div>
          <input
            placeholder="اسم منفذ العملية"
            value={conversionForm.operatorName}
            onChange={(event) => setConversionForm({ ...conversionForm, operatorName: event.target.value })}
          />
          <input
            className="md:col-span-2"
            placeholder="ملاحظة"
            value={conversionForm.notes}
            onChange={(event) => setConversionForm({ ...conversionForm, notes: event.target.value })}
          />
          <button className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-500 md:col-span-3">
            <ArrowLeftRight size={18} />
            تنفيذ التحويل
          </button>
        </form>
      </section>

      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black">سجل الصندوق اليومي</h2>
          {loading ? <Loader2 className="animate-spin text-slate-500" size={20} /> : null}
        </div>

        <div className="space-y-3">
          {groupedMovements.map(([date, items]) => (
            <div key={date} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setOpenDay(openDay === date ? '' : date)}
                className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-right font-black dark:bg-slate-950"
              >
                <span>معاملات يوم {new Date(date).toLocaleDateString('en-GB')}</span>
                <span className="inline-flex items-center gap-2 text-sm text-slate-500">
                  {items.length} حركة
                  <ChevronDown size={18} />
                </span>
              </button>

              {openDay === date ? (
                <div className="table-wrap rounded-none border-0">
                  <table>
                    <thead>
                      <tr>
                        <th>نوع الحركة</th>
                        <th>المبلغ</th>
                        <th>العملة</th>
                        <th>الرصيد قبل</th>
                        <th>الرصيد بعد</th>
                        <th>السبب</th>
                        <th>الشخص</th>
                        <th>الموظف</th>
                        <th>التاريخ والوقت</th>
                        <th>ملاحظة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((movement) => (
                        <tr key={movement.id}>
                          <td>{movement.direction === 'IN' ? 'داخل' : movement.direction === 'OUT' ? 'خارج' : 'بدون أثر'}</td>
                          <td className={movement.direction === 'IN' ? 'font-bold text-emerald-600' : 'font-bold text-red-600'}>
                            {formatAmount(movement.amount)}
                          </td>
                          <td>{movement.currency?.symbol || movement.currency?.name}</td>
                          <td>{formatAmount(movement.balanceBefore)}</td>
                          <td>{formatAmount(movement.balanceAfter)}</td>
                          <td>{movement.reason}</td>
                          <td>{movement.person?.fullName || movement.transaction?.person?.fullName || '—'}</td>
                          <td>{movement.createdBy || 'system'}</td>
                          <td>{new Date(movement.occurredAt).toLocaleString('en-GB')}</td>
                          <td>{movement.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ))}
          {!groupedMovements.length ? (
            <div className="rounded-lg border border-slate-200 p-6 text-center text-slate-500 dark:border-slate-800">
              لا توجد حركات صندوق
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
