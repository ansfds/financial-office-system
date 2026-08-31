import Link from 'next/link';
import Page from '@/components/Page';
import DashboardAccountingSection from '@/components/DashboardAccountingSection';
import { db } from '@/lib/db';
import { getDashboardAccountingSummary, parseDashboardAccountingPeriod } from '@/lib/dashboard-accounting';
import { formatDateTime, formatMoney, formatNumber, numberValue } from '@/lib/format';
import { Prisma } from '@prisma/client';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type DashboardProps = {
  searchParams?: Promise<{ accountingPeriod?: string | string[] }>;
};

type CurrencyTotalRow = {
  currencyId: string | null;
  currencyCode: string | null;
  currencyName: string | null;
  currencySymbol: string | null;
  original?: unknown;
  deducted?: unknown;
  remaining?: unknown;
  agreed?: unknown;
  delivered?: unknown;
};

async function getAccountPeopleStats() {
  const rows = await db.$queryRaw<Array<{ our: unknown; their: unknown }>>(Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON ("personId", "currencyId", "paymentMethod", "accountType")
        "personId",
        "accountType",
        "balanceAfter",
        "occurredAt",
        "createdAt"
      FROM "CustomerWalletSettlement"
      WHERE "deletedAt" IS NULL
      ORDER BY "personId", "currencyId", "paymentMethod", "accountType", "occurredAt" DESC, "createdAt" DESC
    )
    SELECT
      COUNT(DISTINCT latest."personId") FILTER (
        WHERE latest."accountType" = 'DEBT' AND latest."balanceAfter" > 0
      ) AS "our",
      COUNT(DISTINCT latest."personId") FILTER (
        WHERE latest."accountType" = 'CREDIT' AND latest."balanceAfter" > 0
      ) AS "their"
    FROM latest
    JOIN "Person" person_row ON person_row."id" = latest."personId"
    WHERE person_row."deletedAt" IS NULL
      AND person_row."status" = 'ACTIVE'
  `);

  return {
    our: numberValue(rows[0]?.our),
    their: numberValue(rows[0]?.their),
  };
}

async function getCardCurrencyTotals() {
  return db.$queryRaw<CurrencyTotalRow[]>(Prisma.sql`
    SELECT
      COALESCE(settlement_currency."id", batch_currency."id") AS "currencyId",
      COALESCE(settlement_currency."code", batch_currency."code", 'USD') AS "currencyCode",
      COALESCE(settlement_currency."name", batch_currency."name", 'USD') AS "currencyName",
      COALESCE(settlement_currency."symbol", batch_currency."symbol", '$') AS "currencySymbol",
      COALESCE(SUM(card_row."valueUsd"), 0) AS "original",
      COALESCE(SUM(COALESCE(card_row."totalDeducted", card_row."receivedAmount", 0)), 0) AS "deducted",
      COALESCE(SUM(COALESCE(card_row."remainingAmount", GREATEST(card_row."valueUsd" - card_row."receivedAmount", 0))), 0) AS "remaining",
      COALESCE(SUM(card_row."agreedAmount"), 0) AS "agreed"
    FROM "ReceivedCustomerCard" card_row
    JOIN "ReceivedCardBatch" batch ON batch."id" = card_row."batchId"
    LEFT JOIN "Currency" batch_currency ON batch_currency."id" = batch."currencyId"
    LEFT JOIN "Currency" settlement_currency ON settlement_currency."id" = card_row."settlementCurrencyId"
    WHERE card_row."deletedAt" IS NULL
      AND card_row."status" <> 'CANCELLED'
    GROUP BY
      COALESCE(settlement_currency."id", batch_currency."id"),
      COALESCE(settlement_currency."code", batch_currency."code", 'USD'),
      COALESCE(settlement_currency."name", batch_currency."name", 'USD'),
      COALESCE(settlement_currency."symbol", batch_currency."symbol", '$')
    ORDER BY "currencyCode" ASC
  `);
}

async function getDeliveryCurrencyTotals() {
  return db.$queryRaw<CurrencyTotalRow[]>(Prisma.sql`
    SELECT
      currency_row."id" AS "currencyId",
      currency_row."code" AS "currencyCode",
      currency_row."name" AS "currencyName",
      currency_row."symbol" AS "currencySymbol",
      COALESCE(SUM(delivery."amount"), 0) AS "delivered"
    FROM "CustomerCardDelivery" delivery
    JOIN "Currency" currency_row ON currency_row."id" = delivery."currencyId"
    WHERE delivery."deletedAt" IS NULL
    GROUP BY currency_row."id", currency_row."code", currency_row."name", currency_row."symbol"
    ORDER BY currency_row."code" ASC
  `);
}

function currencyFromRow(row: CurrencyTotalRow) {
  const code = row.currencyCode || 'USD';
  return {
    id: row.currencyId || code,
    code,
    name: row.currencyName || code,
    symbol: row.currencySymbol || code,
  };
}

export default async function Dashboard({ searchParams }: DashboardProps) {
  const params = searchParams ? await searchParams : {};
  const accountingPeriod = parseDashboardAccountingPeriod(params.accountingPeriod);
  const [
    customers,
    totalCards,
    newCards,
    drawingCards,
    settledCards,
    accountPeopleStats,
    cardTotalsRows,
    deliveryTotalsRows,
    accountingSummary,
    recentCards,
    recentCardOperations,
    recentSettlements,
  ] = await Promise.all([
    db.person.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    db.receivedCustomerCard.count({ where: { deletedAt: null, status: { not: 'CANCELLED' } } }),
    db.receivedCustomerCard.count({ where: { deletedAt: null, status: 'RECEIVED' } }),
    db.receivedCustomerCard.count({ where: { deletedAt: null, status: { in: ['IN_SETTLEMENT', 'PARTIAL'] } } }),
    db.receivedCustomerCard.count({ where: { deletedAt: null, status: { in: ['SETTLED', 'COMPLETED'] } } }),
    getAccountPeopleStats(),
    getCardCurrencyTotals(),
    getDeliveryCurrencyTotals(),
    getDashboardAccountingSummary(accountingPeriod),
    db.receivedCustomerCard.findMany({
      where: { deletedAt: null },
      include: {
        batch: { include: { person: true, currency: true } },
        settlementCurrency: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    }),
    db.receivedCardOperation.findMany({
      where: { deletedAt: null },
      include: { card: { include: { batch: { include: { person: true, currency: true } }, settlementCurrency: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 8,
    }),
    db.customerWalletSettlement.findMany({
      where: { deletedAt: null },
      include: { person: true, currency: true },
      orderBy: { occurredAt: 'desc' },
      take: 8,
    }),
  ]);

  const cardTotalsByCurrency = new Map<
    string,
    { currency: any; original: number; deducted: number; remaining: number; agreed: number; delivered: number }
  >();

  for (const row of cardTotalsRows) {
    const currency = currencyFromRow(row);
    const current =
      cardTotalsByCurrency.get(currency.id) ||
      { currency, original: 0, deducted: 0, remaining: 0, agreed: 0, delivered: 0 };
    current.original += numberValue(row.original);
    current.deducted += numberValue(row.deducted);
    current.remaining += numberValue(row.remaining);
    current.agreed += numberValue(row.agreed);
    cardTotalsByCurrency.set(currency.id, current);
  }

  for (const delivery of deliveryTotalsRows) {
    const currency = currencyFromRow(delivery);
    const current =
      cardTotalsByCurrency.get(currency.id) ||
      { currency, original: 0, deducted: 0, remaining: 0, agreed: 0, delivered: 0 };
    current.delivered += numberValue(delivery.delivered);
    cardTotalsByCurrency.set(currency.id, current);
  }

  const cardCurrencyTotals = Array.from(cardTotalsByCurrency.values());

  return (
    <Page title="الصفحة الرئيسية">
      <div className="stagger-list grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <Stat title="إجمالي الزبائن" value={formatNumber(customers)} href="/people" />
        <Stat title="إجمالي البطاقات" value={formatNumber(totalCards)} href="/people" />
        <Stat title="البطاقات الجديدة" value={formatNumber(newCards)} href="/people" />
        <Stat title="قيد السحب" value={formatNumber(drawingCards)} href="/people" />
        <Stat title="البطاقات المصفاة" value={formatNumber(settledCards)} href="/people" />
        <Stat title="حسابات لنا" value={formatNumber(accountPeopleStats.our)} href="/accounts" tone="green" />
        <Stat title="حسابات علينا" value={formatNumber(accountPeopleStats.their)} href="/accounts" tone="red" />
        <Stat title="آخر تحديث" value={formatNumber(recentCards.length + recentSettlements.length)} href="/audit" />
      </div>

      <DashboardAccountingSection summary={accountingSummary} />

      <section className="mt-5 card p-4 md:mt-6 md:p-5">
        <h2 className="mb-4 font-black">مجاميع البطاقات حسب العملة</h2>
        <div className="stagger-list grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cardCurrencyTotals.map((row) => (
            <div key={row.currency.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="font-black">{row.currency.name}</div>
              <div className="mt-3 grid gap-2 text-sm">
                <span>الأصل: <b>{formatMoney(row.original, row.currency)}</b></span>
                <span>المسحوب: <b>{formatMoney(row.deducted, row.currency)}</b></span>
                <span>المتبقي في البطاقات: <b>{formatMoney(row.remaining, row.currency)}</b></span>
                <span>المتفق عليه: <b>{formatMoney(row.agreed, row.currency)}</b></span>
                <span>المسلّم: <b>{formatMoney(row.delivered, row.currency)}</b></span>
                <span>المتبقي للتسليم: <b>{formatMoney(Math.max(row.agreed - row.delivered, 0), row.currency)}</b></span>
              </div>
            </div>
          ))}
          {!cardCurrencyTotals.length ? <div className="text-sm text-slate-500">لا توجد بيانات بطاقات بعد.</div> : null}
        </div>
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <section className="card p-4 md:p-5">
          <h2 className="mb-4 font-black">آخر البطاقات المعدلة</h2>
          <div className="stagger-list space-y-3">
            {recentCards.map((card) => {
              const currency = card.settlementCurrency || card.batch.currency;
              return (
                <div key={card.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-black">{card.publicCode || `#C${String(card.sequence).padStart(4, '0')}`}</div>
                    <div className="text-sm text-slate-500">{formatDateTime(card.updatedAt)}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    {card.batch.person.customerNo || '—'} · {card.batch.person.fullName}
                  </div>
                  <div className="mt-2 grid gap-2 text-sm md:grid-cols-3">
                    <span>القيمة: {formatMoney(card.valueUsd, currency || '$')}</span>
                    <span>المتفق: {formatMoney(card.agreedAmount, currency || '$')}</span>
                    <span>المتبقي: {formatMoney(Math.max(Number(card.valueUsd || 0) - Number(card.receivedAmount || 0), 0), currency || '$')}</span>
                  </div>
                </div>
              );
            })}
            {!recentCards.length ? <div className="text-sm text-slate-500">لا توجد بطاقات بعد.</div> : null}
          </div>
        </section>

        <section className="card p-4 md:p-5">
          <h2 className="mb-4 font-black">آخر عمليات البطاقات</h2>
          <div className="stagger-list space-y-3">
            {recentCardOperations.map((operation) => {
              const currency = operation.card.settlementCurrency || operation.card.batch.currency;
              return (
                <div key={operation.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-black">{operation.operationType} · {formatMoney(operation.amount, currency || '$')}</div>
                    <div className="text-sm text-slate-500">{formatDateTime(operation.occurredAt)}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    {operation.card.batch.person.customerNo || 'لا يوجد'} · {operation.card.batch.person.fullName}
                  </div>
                  <div className="mt-1 text-sm">{operation.note || operation.reason || 'لا توجد ملاحظة'}</div>
                </div>
              );
            })}
            {!recentCardOperations.length ? <div className="text-sm text-slate-500">لا توجد عمليات بطاقات بعد.</div> : null}
          </div>
        </section>

        <section className="card p-4 md:p-5">
          <h2 className="mb-4 font-black">آخر الحركات المالية</h2>
          <div className="stagger-list space-y-3">
            {recentSettlements.map((settlement) => {
              const isOur = settlement.accountType === 'DEBT';
              return (
                <div key={settlement.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className={isOur ? 'font-black text-emerald-600' : 'font-black text-red-600'}>
                      {isOur ? 'لنا' : 'علينا'} · {formatMoney(settlement.amount, settlement.currency)}
                    </div>
                    <div className="text-sm text-slate-500">{formatDateTime(settlement.occurredAt)}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    {settlement.person.customerNo || '—'} · {settlement.person.fullName}
                  </div>
                  <div className="mt-1 text-sm">{settlement.reason}</div>
                </div>
              );
            })}
            {!recentSettlements.length ? <div className="text-sm text-slate-500">لا توجد حركات مالية بعد.</div> : null}
          </div>
        </section>
      </div>
    </Page>
  );
}

function Stat({ title, value, href, tone }: { title: string; value: ReactNode; href?: string; tone?: 'green' | 'red' }) {
  const content = (
    <div className="card h-full p-3 hover:-translate-y-0.5 hover:shadow-lg md:p-5">
      <div className="text-xs text-slate-500 md:text-sm">{title}</div>
      <div className={`num mt-2 text-2xl font-black md:text-3xl ${tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : ''}`}>
        {value}
      </div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
