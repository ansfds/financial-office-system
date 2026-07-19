'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ShoppingBag } from 'lucide-react';

const paymentMethodLabels: Record<string, string> = {
  USD_CASH: 'دولار كاش',
  USD_TRANSFER: 'دولار حوالة',
  LYD_CASH: 'دينار كاش',
  LYD_TRANSFER: 'دينار حوالة',
  CARD: 'بطاقة مصرفية',
};

const paymentOrder = ['USD_CASH', 'USD_TRANSFER', 'LYD_CASH', 'LYD_TRANSFER', 'CARD'];

function amount(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dayKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function displayDay(key: string) {
  const [year, month, day] = key.split('-');
  return `${Number(day)}-${Number(month)}-${year}`;
}

export default function SheinSalesReportClient({
  soldCount,
  sales,
}: {
  soldCount: number;
  sales: any[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState('');

  const grouped = useMemo(() => {
    const result = new Map<string, any[]>();
    for (const sale of sales) {
      const key = dayKey(sale.occurredAt);
      result.set(key, [...(result.get(key) || []), sale]);
    }
    return Array.from(result.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [sales]);

  const selectedSales = selectedDay ? grouped.find(([key]) => key === selectedDay)?.[1] || [] : [];
  const totals = useMemo(() => {
    const result = new Map<string, number>();
    for (const sale of selectedSales) {
      result.set(sale.paymentMethod, (result.get(sale.paymentMethod) || 0) + amount(sale.totalAmount));
    }
    return result;
  }, [selectedSales]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!selectedDay && grouped[0]) setSelectedDay(grouped[0][0]);
        }}
        className="card p-5 text-right hover:-translate-y-0.5 hover:shadow-lg"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-slate-500">عدد كروت شي إن المباعة</div>
          <ShoppingBag size={20} className="text-indigo-600" />
        </div>
        <div className="mt-2 text-2xl font-black">{soldCount.toLocaleString('en-US')}</div>
      </button>

      {open ? (
        <div className="card p-5 sm:col-span-2 xl:col-span-4">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="flex items-center gap-2 font-black">
              مبيعات كروت شي إن حسب التاريخ
              <ChevronDown size={18} />
            </h2>
            <div className="flex flex-wrap gap-2">
              {grouped.map(([key, items]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setSelectedDay(key)}
                  className={`rounded-lg px-3 py-2 text-sm font-bold ${
                    selectedDay === key
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100'
                  }`}
                >
                  {displayDay(key)} ({items.reduce((sum, sale) => sum + Number(sale.cardCount || 0), 0).toLocaleString('en-US')})
                </button>
              ))}
              {!grouped.length ? <span className="text-sm text-slate-500">لا توجد مبيعات مسجلة بعد</span> : null}
            </div>
          </div>

          {selectedSales.length ? (
            <div className="grid gap-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {paymentOrder.map((method) => (
                  <div key={method} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                    <div className="text-sm text-slate-500">{paymentMethodLabels[method]}</div>
                    <div className="mt-2 text-xl font-black">{(totals.get(method) || 0).toLocaleString('en-US')}</div>
                  </div>
                ))}
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>الفئة</th>
                      <th>العدد</th>
                      <th>سعر الكرت</th>
                      <th>الإجمالي</th>
                      <th>طريقة الدفع</th>
                      <th>الزبون</th>
                      <th>الكروت المرتبطة</th>
                      <th>ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{amount(sale.denomination).toLocaleString('en-US')}$</td>
                        <td>{Number(sale.cardCount || 0).toLocaleString('en-US')}</td>
                        <td>
                          {amount(sale.pricePerCard).toLocaleString('en-US')} {sale.currency?.symbol || ''}
                        </td>
                        <td className="font-bold">
                          {amount(sale.totalAmount).toLocaleString('en-US')} {sale.currency?.symbol || ''}
                        </td>
                        <td>{paymentMethodLabels[sale.paymentMethod] || sale.paymentMethod}</td>
                        <td>{sale.person?.fullName || '—'}</td>
                        <td>
                          {sale.items?.length
                            ? sale.items.map((item: any) => item.card?.code).filter(Boolean).join(', ')
                            : 'غير مربوط بالمخزن'}
                        </td>
                        <td>{sale.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
