'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ShoppingBag } from 'lucide-react';
import { formatDate, formatMoney, formatNumber, numberValue } from '@/lib/format';
import { detailedPaymentLabels, detailedPaymentMethods } from '@/lib/payment-methods';

const paymentOrder = detailedPaymentMethods;

function amount(value: unknown) {
  return numberValue(value);
}

function dayKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function displayDay(key: string) {
  return formatDate(`${key}T00:00:00`);
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
        <div className="mt-2 text-2xl font-black">{formatNumber(soldCount)}</div>
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
                  {displayDay(key)} ({formatNumber(items.reduce((sum, sale) => sum + Number(sale.cardCount || 0), 0))})
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
                    <div className="text-sm text-slate-500">{detailedPaymentLabels[method]}</div>
                    <div className="mt-2 text-xl font-black">{formatMoney(totals.get(method) || 0)}</div>
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
                        <td>{formatMoney(sale.denomination, '$')}</td>
                        <td>{formatNumber(sale.cardCount || 0)}</td>
                        <td>
                          {formatMoney(sale.pricePerCard, sale.currency?.symbol || '')}
                        </td>
                        <td className="font-bold">
                          {formatMoney(sale.totalAmount, sale.currency?.symbol || '')}
                        </td>
                        <td>{detailedPaymentLabels[sale.paymentMethod as keyof typeof detailedPaymentLabels] || sale.paymentMethod}</td>
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
