'use client';

import Link from 'next/link';
import { Calculator, Eye, Loader2, Receipt, WalletCards, X } from 'lucide-react';
import { useState } from 'react';
import type {
  DashboardAccountingDetailKind,
  DashboardAccountingDetails,
  DashboardAccountingSummary,
  DashboardCurrency,
  DashboardCurrencyAmount,
} from '@/lib/dashboard-accounting';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import ModalLayer, { ModalBackdrop } from '@/components/ModalLayer';

const periodLabels = {
  today: 'اليوم',
  week: 'الأسبوع',
  month: 'الشهر',
  all: 'الكل',
} as const;

const periods = ['today', 'week', 'month', 'all'] as const;

function periodHref(period: string) {
  return period === 'all' ? '/dashboard' : `/dashboard?accountingPeriod=${period}`;
}

function fallbackDollar(): DashboardCurrency {
  return { id: 'USD', code: 'USD', name: 'USD', symbol: '$' };
}

function zeroMoney(currency = fallbackDollar()) {
  return formatMoney(0, currency);
}

function currencyTotalsText(totals: DashboardCurrencyAmount[], fallback = fallbackDollar()) {
  if (!totals.length) return zeroMoney(fallback);
  return totals.map((total) => formatMoney(total.amount, total.currency)).join(' | ');
}

function firstCurrency(totals: DashboardCurrencyAmount[]) {
  return totals[0]?.currency || fallbackDollar();
}

function DetailButton({
  title,
  count,
  value,
  tone,
  kind,
  loadingKind,
  onOpen,
}: {
  title: string;
  count: number;
  value?: string;
  tone?: 'green' | 'red' | 'blue' | 'slate';
  kind: DashboardAccountingDetailKind;
  loadingKind: DashboardAccountingDetailKind | '';
  onOpen: (kind: DashboardAccountingDetailKind) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(kind)}
      className={`accounting-tile accounting-tile--${tone || 'slate'}`}
    >
      <span>{title}</span>
      <b className="num">{formatNumber(count)}</b>
      {value ? <em className="num">{value}</em> : null}
      {loadingKind === kind ? <Loader2 className="accounting-tile__loader animate-spin" size={16} /> : <Eye className="accounting-tile__loader" size={16} />}
    </button>
  );
}

export default function DashboardAccountingSection({ summary }: { summary: DashboardAccountingSummary }) {
  const [details, setDetails] = useState<DashboardAccountingDetails | null>(null);
  const [loadingKind, setLoadingKind] = useState<DashboardAccountingDetailKind | ''>('');

  async function openDetails(kind: DashboardAccountingDetailKind) {
    setLoadingKind(kind);
    try {
      const response = await fetch(`/api/dashboard/accounting-details?period=${summary.period}&kind=${kind}`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) return;
      setDetails(data);
    } finally {
      setLoadingKind('');
    }
  }

  return (
    <section className="dashboard-accounting card mt-5 p-3 md:mt-6 md:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-700 dark:bg-blue-950 dark:text-blue-200">
            <Calculator size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-black md:text-lg">الحسابات</h2>
            <p className="truncate text-xs font-bold text-slate-500">سحبات، فواتير، وحالات البطاقات</p>
          </div>
        </div>

        <div className="accounting-periods" aria-label="فلترة الحسابات">
          {periods.map((period) => (
            <Link
              key={period}
              href={periodHref(period)}
              className={summary.period === period ? 'accounting-periods__active' : ''}
            >
              {periodLabels[period]}
            </Link>
          ))}
        </div>
      </div>

      <div className="accounting-total-strip">
        <button type="button" onClick={() => openDetails('gift-100')} className="accounting-total-strip__item">
          <WalletCards size={15} />
          <span>السحبات</span>
          <b className="num">{formatNumber(summary.totals.giftDrawCount)}</b>
          <em className="num">{currencyTotalsText(summary.totals.giftDrawTotals)}</em>
        </button>
        <button type="button" onClick={() => openDetails('invoices')} className="accounting-total-strip__item">
          <Receipt size={15} />
          <span>الفواتير</span>
          <b className="num">{formatNumber(summary.totals.invoiceCount)}</b>
          <em className="num">{currencyTotalsText(summary.totals.invoiceTotals)}</em>
        </button>
        <button type="button" onClick={() => openDetails('cards-total')} className="accounting-total-strip__item">
          <WalletCards size={15} />
          <span>البطاقات</span>
          <b className="num">{formatNumber(summary.cards.total)}</b>
          <em>{formatNumber(summary.cards.active)} نشطة</em>
        </button>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="accounting-grid">
          {summary.gifts.map((gift) => (
            <DetailButton
              key={gift.kind}
              title={gift.label}
              count={gift.count}
              value={currencyTotalsText(gift.totals, firstCurrency(gift.totals))}
              kind={gift.kind as DashboardAccountingDetailKind}
              tone="blue"
              loadingKind={loadingKind}
              onOpen={openDetails}
            />
          ))}
          <DetailButton
            title="فواتير الزبائن"
            count={summary.invoices.count}
            value={currencyTotalsText(summary.invoices.totals, firstCurrency(summary.invoices.totals))}
            kind="invoices"
            tone="slate"
            loadingKind={loadingKind}
            onOpen={openDetails}
          />
        </div>

        <div className="accounting-grid accounting-grid--statuses">
          <DetailButton title="مصفاة" count={summary.cards.settled} kind="cards-settled" tone="green" loadingKind={loadingKind} onOpen={openDetails} />
          <DetailButton title="غير مصفاة" count={summary.cards.unsettled} kind="cards-unsettled" tone="blue" loadingKind={loadingKind} onOpen={openDetails} />
          <DetailButton title="متوقفة" count={summary.cards.stopped} kind="cards-stopped" tone="red" loadingKind={loadingKind} onOpen={openDetails} />
          <DetailButton title="مرفوضة" count={summary.cards.rejected} kind="cards-rejected" tone="red" loadingKind={loadingKind} onOpen={openDetails} />
        </div>
      </div>

      {details ? (
        <ModalLayer name="dashboard-accounting-details" onClose={() => setDetails(null)} className="md:items-center">
          <ModalBackdrop onClick={() => setDetails(null)} />
          <aside className="modal-panel modal-panel--auto sheet-panel max-w-5xl dark:bg-slate-950">
            <div className="modal-header flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-bold text-indigo-600">{periodLabels[details.period]}</div>
                <h3 className="truncate text-lg font-black">{details.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{formatNumber(details.count)} نتيجة{details.limited ? '، تظهر أحدث النتائج فقط' : ''}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetails(null)}
                className="modal-close text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="إغلاق"
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body p-3 md:p-4" data-modal-scroll-body>
              <div className="accounting-details-table table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>اسم الزبون</th>
                      <th>البطاقة</th>
                      <th>آخر 4</th>
                      <th>العدد</th>
                      <th>القيمة</th>
                      <th>الإجمالي</th>
                      <th>التاريخ</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div className="font-black">{row.customerName}</div>
                          <div className="text-xs text-slate-500">{row.customerNo || 'بدون رقم'}</div>
                        </td>
                        <td>{row.cardLabel || row.cardCode}</td>
                        <td className="num">{row.cardLast4 || '0000'}</td>
                        <td className="num font-black">{formatNumber(row.quantity)}</td>
                        <td className="num">{formatMoney(row.amount, row.currency)}</td>
                        <td className="num font-black">{formatMoney(row.totalAmount, row.currency)}</td>
                        <td>{formatDateTime(row.date)}</td>
                        <td>{row.status}</td>
                      </tr>
                    ))}
                    {!details.rows.length ? (
                      <tr>
                        <td colSpan={8} className="text-center text-slate-500">
                          لا توجد تفاصيل لهذه الفترة.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </aside>
        </ModalLayer>
      ) : null}
    </section>
  );
}
