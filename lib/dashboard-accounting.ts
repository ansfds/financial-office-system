import { Prisma, ReceivedCardStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { numberValue } from '@/lib/format';

export const dashboardAccountingPeriods = ['all', 'today', 'week', 'month'] as const;
export type DashboardAccountingPeriod = (typeof dashboardAccountingPeriods)[number];

export type DashboardCurrency = {
  id: string;
  code: string;
  name: string;
  symbol: string;
};

export type DashboardCurrencyAmount = {
  currency: DashboardCurrency;
  amount: number;
};

export type DashboardGiftDrawSummary = {
  kind: `gift-${string}`;
  categoryCode: string;
  label: string;
  drawValue: number;
  count: number;
  totals: DashboardCurrencyAmount[];
};

export type DashboardAccountingSummary = {
  period: DashboardAccountingPeriod;
  gifts: DashboardGiftDrawSummary[];
  invoices: {
    kind: 'invoices';
    count: number;
    totals: DashboardCurrencyAmount[];
  };
  cards: {
    total: number;
    active: number;
    settled: number;
    unsettled: number;
    stopped: number;
    rejected: number;
  };
  totals: {
    giftDrawCount: number;
    giftDrawTotals: DashboardCurrencyAmount[];
    invoiceCount: number;
    invoiceTotals: DashboardCurrencyAmount[];
  };
};

export type DashboardAccountingDetailKind =
  | 'gift-100'
  | 'gift-300'
  | 'gift-500'
  | 'invoices'
  | 'cards-total'
  | 'cards-active'
  | 'cards-settled'
  | 'cards-unsettled'
  | 'cards-stopped'
  | 'cards-rejected';

export type DashboardAccountingDetailRow = {
  id: string;
  type: 'operation' | 'card';
  customerName: string;
  customerNo: string | null;
  cardCode: string;
  cardLast4: string | null;
  cardLabel: string;
  quantity: number;
  amount: number;
  totalAmount: number;
  currency: DashboardCurrency;
  date: string;
  status: string;
  note: string | null;
};

export type DashboardAccountingDetails = {
  title: string;
  period: DashboardAccountingPeriod;
  kind: DashboardAccountingDetailKind;
  count: number;
  rows: DashboardAccountingDetailRow[];
  limited: boolean;
};

const detailLimit = 250;

export const giftDrawRules = [
  { code: '100', label: 'كروت 100$', faceValue: 100, drawValue: 100 },
  { code: '300', label: 'كروت 300$', faceValue: 300, drawValue: 292 },
  { code: '500', label: 'كروت 500$', faceValue: 500, drawValue: 476 },
] as const;

type GiftRule = (typeof giftDrawRules)[number];

type GiftAggregateRow = {
  categoryCode: string | null;
  quantity: unknown;
  currencyId: string | null;
  currencyCode: string | null;
  currencyName: string | null;
  currencySymbol: string | null;
};

type InvoiceAggregateRow = {
  count: unknown;
  amount: unknown;
  currencyId: string | null;
  currencyCode: string | null;
  currencyName: string | null;
  currencySymbol: string | null;
};

type CardAggregateRow = {
  total: unknown;
  active: unknown;
  settled: unknown;
  unsettled: unknown;
  stopped: unknown;
  rejected: unknown;
};

export function parseDashboardAccountingPeriod(value: unknown): DashboardAccountingPeriod {
  const first = Array.isArray(value) ? value[0] : value;
  return dashboardAccountingPeriods.includes(first as DashboardAccountingPeriod)
    ? (first as DashboardAccountingPeriod)
    : 'all';
}

export function parseDashboardAccountingDetailKind(value: unknown): DashboardAccountingDetailKind {
  const first = Array.isArray(value) ? value[0] : value;
  const allowed: DashboardAccountingDetailKind[] = [
    'gift-100',
    'gift-300',
    'gift-500',
    'invoices',
    'cards-total',
    'cards-active',
    'cards-settled',
    'cards-unsettled',
    'cards-stopped',
    'cards-rejected',
  ];
  return allowed.includes(first as DashboardAccountingDetailKind)
    ? (first as DashboardAccountingDetailKind)
    : 'gift-100';
}

function periodStart(period: DashboardAccountingPeriod, now = new Date()) {
  if (period === 'all') return null;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === 'week') {
    start.setDate(start.getDate() - start.getDay());
  }

  if (period === 'month') {
    start.setDate(1);
  }

  return start;
}

function operationPeriodSql(period: DashboardAccountingPeriod) {
  const start = periodStart(period);
  return start ? Prisma.sql`AND o."occurredAt" >= ${start}` : Prisma.empty;
}

function cardPeriodSql(period: DashboardAccountingPeriod) {
  const start = periodStart(period);
  return start ? Prisma.sql`AND card_row."updatedAt" >= ${start}` : Prisma.empty;
}

function operationDateWhere(period: DashboardAccountingPeriod) {
  const start = periodStart(period);
  return start ? { gte: start } : undefined;
}

function cardDateWhere(period: DashboardAccountingPeriod) {
  const start = periodStart(period);
  return start ? { gte: start } : undefined;
}

function currencyFromRaw(row: {
  currencyId?: string | null;
  currencyCode?: string | null;
  currencyName?: string | null;
  currencySymbol?: string | null;
}): DashboardCurrency {
  const code = row.currencyCode || 'USD';
  return {
    id: row.currencyId || code,
    code,
    name: row.currencyName || code,
    symbol: row.currencySymbol || code,
  };
}

function addCurrencyAmount(totals: Map<string, DashboardCurrencyAmount>, currency: DashboardCurrency, amount: number) {
  const key = currency.id || currency.code;
  const current = totals.get(key) || { currency, amount: 0 };
  current.amount += amount;
  totals.set(key, current);
}

function currencyForCard(card: {
  settlementCurrency?: DashboardCurrency | null;
  batch?: { currency?: DashboardCurrency | null } | null;
}) {
  return card.settlementCurrency || card.batch?.currency || {
    id: 'USD',
    code: 'USD',
    name: 'USD',
    symbol: '$',
  };
}

function publicCardCode(card: { publicCode?: string | null; sequence?: number | null }) {
  return card.publicCode || `#C${String(card.sequence || 0).padStart(4, '0')}`;
}

function cardStatusLabel(status: string) {
  if (status === 'SETTLED' || status === 'COMPLETED') return 'مصفاة';
  if (status === 'CANCELLED') return 'متوقفة';
  if (status === 'IN_SETTLEMENT' || status === 'PARTIAL') return 'قيد السحب';
  return 'نشطة';
}

async function getGiftAggregates(period: DashboardAccountingPeriod) {
  return db.$queryRaw<GiftAggregateRow[]>(Prisma.sql`
    WITH gift_rows AS (
      SELECT
        CASE
          WHEN o."categoryCode" IN ('100', '300', '500') THEN o."categoryCode"
          WHEN ROUND(o."categoryFaceValue") = 100 THEN '100'
          WHEN ROUND(o."categoryFaceValue") = 300 THEN '300'
          WHEN ROUND(o."categoryFaceValue") = 500 THEN '500'
          ELSE NULL
        END AS "categoryCode",
        o."quantity",
        COALESCE(settlement_currency."id", batch_currency."id") AS "currencyId",
        COALESCE(settlement_currency."code", batch_currency."code", 'USD') AS "currencyCode",
        COALESCE(settlement_currency."name", batch_currency."name", 'USD') AS "currencyName",
        COALESCE(settlement_currency."symbol", batch_currency."symbol", '$') AS "currencySymbol"
      FROM "ReceivedCardOperation" o
      JOIN "ReceivedCustomerCard" card_row ON card_row."id" = o."cardId"
      JOIN "ReceivedCardBatch" batch ON batch."id" = card_row."batchId"
      LEFT JOIN "Currency" batch_currency ON batch_currency."id" = batch."currencyId"
      LEFT JOIN "Currency" settlement_currency ON settlement_currency."id" = card_row."settlementCurrencyId"
      WHERE o."deletedAt" IS NULL
        AND card_row."deletedAt" IS NULL
        AND o."operationType" = 'GIFT_CARD'
        ${operationPeriodSql(period)}
    )
    SELECT
      "categoryCode",
      SUM("quantity") AS "quantity",
      "currencyId",
      "currencyCode",
      "currencyName",
      "currencySymbol"
    FROM gift_rows
    WHERE "categoryCode" IS NOT NULL
    GROUP BY "categoryCode", "currencyId", "currencyCode", "currencyName", "currencySymbol"
    ORDER BY "categoryCode" ASC
  `);
}

async function getInvoiceAggregates(period: DashboardAccountingPeriod) {
  return db.$queryRaw<InvoiceAggregateRow[]>(Prisma.sql`
    SELECT
      COUNT(*) AS "count",
      COALESCE(SUM(o."amount"), 0) AS "amount",
      COALESCE(settlement_currency."id", batch_currency."id") AS "currencyId",
      COALESCE(settlement_currency."code", batch_currency."code", 'USD') AS "currencyCode",
      COALESCE(settlement_currency."name", batch_currency."name", 'USD') AS "currencyName",
      COALESCE(settlement_currency."symbol", batch_currency."symbol", '$') AS "currencySymbol"
    FROM "ReceivedCardOperation" o
    JOIN "ReceivedCustomerCard" card_row ON card_row."id" = o."cardId"
    JOIN "ReceivedCardBatch" batch ON batch."id" = card_row."batchId"
    LEFT JOIN "Currency" batch_currency ON batch_currency."id" = batch."currencyId"
    LEFT JOIN "Currency" settlement_currency ON settlement_currency."id" = card_row."settlementCurrencyId"
    WHERE o."deletedAt" IS NULL
      AND card_row."deletedAt" IS NULL
      AND o."operationType" = 'INVOICE'
      ${operationPeriodSql(period)}
    GROUP BY
      COALESCE(settlement_currency."id", batch_currency."id"),
      COALESCE(settlement_currency."code", batch_currency."code", 'USD'),
      COALESCE(settlement_currency."name", batch_currency."name", 'USD'),
      COALESCE(settlement_currency."symbol", batch_currency."symbol", '$')
    ORDER BY "currencyCode" ASC
  `);
}

async function getCardStatusAggregates(period: DashboardAccountingPeriod) {
  const rows = await db.$queryRaw<CardAggregateRow[]>(Prisma.sql`
    SELECT
      COUNT(*) AS "total",
      COUNT(*) FILTER (
        WHERE card_row."status" IN ('RECEIVED', 'IN_SETTLEMENT', 'PARTIAL')
          AND card_row."currentStage" < 5
      ) AS "active",
      COUNT(*) FILTER (
        WHERE card_row."status" IN ('SETTLED', 'COMPLETED')
          OR card_row."currentStage" >= 5
      ) AS "settled",
      COUNT(*) FILTER (
        WHERE card_row."status" <> 'CANCELLED'
          AND card_row."status" NOT IN ('SETTLED', 'COMPLETED')
          AND card_row."currentStage" < 5
      ) AS "unsettled",
      COUNT(*) FILTER (WHERE card_row."status" = 'CANCELLED') AS "stopped",
      COUNT(*) FILTER (
        WHERE card_row."status" = 'CANCELLED'
          AND card_row."rejectReason" IS NOT NULL
      ) AS "rejected"
    FROM "ReceivedCustomerCard" card_row
    WHERE card_row."deletedAt" IS NULL
      ${cardPeriodSql(period)}
  `);

  const row = rows[0] || { total: 0, active: 0, settled: 0, unsettled: 0, stopped: 0, rejected: 0 };
  return {
    total: numberValue(row.total),
    active: numberValue(row.active),
    settled: numberValue(row.settled),
    unsettled: numberValue(row.unsettled),
    stopped: numberValue(row.stopped),
    rejected: numberValue(row.rejected),
  };
}

export async function getDashboardAccountingSummary(period: DashboardAccountingPeriod): Promise<DashboardAccountingSummary> {
  const [giftRows, invoiceRows, cards] = await Promise.all([
    getGiftAggregates(period),
    getInvoiceAggregates(period),
    getCardStatusAggregates(period),
  ]);

  const giftTotals = new Map<string, DashboardCurrencyAmount>();
  const gifts = giftDrawRules.map((rule) => {
    const rows = giftRows.filter((row) => row.categoryCode === rule.code);
    const totals = new Map<string, DashboardCurrencyAmount>();
    let count = 0;

    for (const row of rows) {
      const quantity = numberValue(row.quantity);
      count += quantity;
      const currency = currencyFromRaw(row);
      const amount = quantity * rule.drawValue;
      addCurrencyAmount(totals, currency, amount);
      addCurrencyAmount(giftTotals, currency, amount);
    }

    return {
      kind: `gift-${rule.code}` as const,
      categoryCode: rule.code,
      label: rule.label,
      drawValue: rule.drawValue,
      count,
      totals: Array.from(totals.values()),
    };
  });

  const invoiceTotals = new Map<string, DashboardCurrencyAmount>();
  let invoiceCount = 0;
  for (const row of invoiceRows) {
    invoiceCount += numberValue(row.count);
    addCurrencyAmount(invoiceTotals, currencyFromRaw(row), numberValue(row.amount));
  }

  return {
    period,
    gifts,
    invoices: {
      kind: 'invoices',
      count: invoiceCount,
      totals: Array.from(invoiceTotals.values()),
    },
    cards,
    totals: {
      giftDrawCount: gifts.reduce((total, item) => total + item.count, 0),
      giftDrawTotals: Array.from(giftTotals.values()),
      invoiceCount,
      invoiceTotals: Array.from(invoiceTotals.values()),
    },
  };
}

function giftRuleForKind(kind: DashboardAccountingDetailKind): GiftRule | null {
  if (!kind.startsWith('gift-')) return null;
  return giftDrawRules.find((rule) => kind === `gift-${rule.code}`) || null;
}

function cardWhereForKind(kind: DashboardAccountingDetailKind): Prisma.ReceivedCustomerCardWhereInput {
  if (kind === 'cards-active') {
    return {
      status: { in: [ReceivedCardStatus.RECEIVED, ReceivedCardStatus.IN_SETTLEMENT, ReceivedCardStatus.PARTIAL] },
      currentStage: { lt: 5 },
    };
  }
  if (kind === 'cards-settled') {
    return {
      OR: [{ status: { in: [ReceivedCardStatus.SETTLED, ReceivedCardStatus.COMPLETED] } }, { currentStage: { gte: 5 } }],
    };
  }
  if (kind === 'cards-unsettled') {
    return {
      status: { not: ReceivedCardStatus.CANCELLED },
      currentStage: { lt: 5 },
      NOT: { status: { in: [ReceivedCardStatus.SETTLED, ReceivedCardStatus.COMPLETED] } },
    };
  }
  if (kind === 'cards-stopped') return { status: ReceivedCardStatus.CANCELLED };
  if (kind === 'cards-rejected') return { status: ReceivedCardStatus.CANCELLED, rejectReason: { not: null } };
  return {};
}

function detailTitle(kind: DashboardAccountingDetailKind) {
  const giftRule = giftRuleForKind(kind);
  if (giftRule) return `${giftRule.label} - العمليات المحتسبة`;
  if (kind === 'invoices') return 'فواتير الزبائن - العمليات المحتسبة';
  if (kind === 'cards-active') return 'البطاقات النشطة';
  if (kind === 'cards-settled') return 'البطاقات المصفاة';
  if (kind === 'cards-unsettled') return 'البطاقات غير المصفاة';
  if (kind === 'cards-stopped') return 'البطاقات المتوقفة';
  if (kind === 'cards-rejected') return 'البطاقات المرفوضة';
  return 'إجمالي البطاقات';
}

export async function getDashboardAccountingDetails(
  period: DashboardAccountingPeriod,
  kind: DashboardAccountingDetailKind,
): Promise<DashboardAccountingDetails> {
  const giftRule = giftRuleForKind(kind);
  if (giftRule) {
    const where = {
      deletedAt: null,
      operationType: 'GIFT_CARD' as const,
      ...(operationDateWhere(period) ? { occurredAt: operationDateWhere(period) } : {}),
      OR: [{ categoryCode: giftRule.code }, { categoryFaceValue: giftRule.faceValue }],
      card: { deletedAt: null },
    };
    const [total, operations] = await Promise.all([
      db.receivedCardOperation.aggregate({ where, _sum: { quantity: true } }),
      db.receivedCardOperation.findMany({
        where,
        include: {
          card: {
            include: {
              settlementCurrency: true,
              batch: { include: { person: true, currency: true } },
            },
          },
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: detailLimit,
      }),
    ]);

    const rows = operations.map((operation) => {
      const currency = currencyForCard(operation.card as any);
      const quantity = numberValue(operation.quantity || 1);
      return {
        id: operation.id,
        type: 'operation' as const,
        customerName: operation.card.batch.person.fullName,
        customerNo: operation.card.batch.person.customerNo,
        cardCode: publicCardCode(operation.card),
        cardLast4: operation.card.cardLast4,
        cardLabel: operation.card.bankName || publicCardCode(operation.card),
        quantity,
        amount: giftRule.drawValue,
        totalAmount: quantity * giftRule.drawValue,
        currency,
        date: operation.occurredAt.toISOString(),
        status: cardStatusLabel(operation.card.status),
        note: operation.note || operation.reason,
      };
    });

    const count = numberValue(total._sum.quantity);
    return { title: detailTitle(kind), period, kind, count, rows, limited: operations.length >= detailLimit };
  }

  if (kind === 'invoices') {
    const where = {
      deletedAt: null,
      operationType: 'INVOICE' as const,
      ...(operationDateWhere(period) ? { occurredAt: operationDateWhere(period) } : {}),
      card: { deletedAt: null },
    };
    const [count, operations] = await Promise.all([
      db.receivedCardOperation.count({ where }),
      db.receivedCardOperation.findMany({
        where,
        include: {
          card: {
            include: {
              settlementCurrency: true,
              batch: { include: { person: true, currency: true } },
            },
          },
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: detailLimit,
      }),
    ]);

    const rows = operations.map((operation) => {
      const currency = currencyForCard(operation.card as any);
      const amount = numberValue(operation.amount);
      return {
        id: operation.id,
        type: 'operation' as const,
        customerName: operation.card.batch.person.fullName,
        customerNo: operation.card.batch.person.customerNo,
        cardCode: publicCardCode(operation.card),
        cardLast4: operation.card.cardLast4,
        cardLabel: operation.card.bankName || publicCardCode(operation.card),
        quantity: 1,
        amount,
        totalAmount: amount,
        currency,
        date: operation.occurredAt.toISOString(),
        status: cardStatusLabel(operation.card.status),
        note: operation.note || operation.reason,
      };
    });

    return { title: detailTitle(kind), period, kind, count, rows, limited: operations.length >= detailLimit };
  }

  const where: Prisma.ReceivedCustomerCardWhereInput = {
    deletedAt: null,
    ...(cardDateWhere(period) ? { updatedAt: cardDateWhere(period) } : {}),
    ...cardWhereForKind(kind),
  };
  const [count, cards] = await Promise.all([
    db.receivedCustomerCard.count({ where }),
    db.receivedCustomerCard.findMany({
      where,
      include: {
        settlementCurrency: true,
        batch: { include: { person: true, currency: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: detailLimit,
    }),
  ]);

  const rows = cards.map((card) => {
    const rowCard = card as any;
    const currency = currencyForCard(rowCard);
    const amount = numberValue(rowCard.valueUsd);
    return {
      id: rowCard.id,
      type: 'card' as const,
      customerName: rowCard.batch.person.fullName,
      customerNo: rowCard.batch.person.customerNo,
      cardCode: publicCardCode(rowCard),
      cardLast4: rowCard.cardLast4,
      cardLabel: rowCard.bankName || publicCardCode(rowCard),
      quantity: 1,
      amount,
      totalAmount: amount,
      currency,
      date: rowCard.updatedAt.toISOString(),
      status: cardStatusLabel(rowCard.status),
      note: rowCard.rejectReason || rowCard.notes,
    };
  });

  return { title: detailTitle(kind), period, kind, count, rows, limited: cards.length >= detailLimit };
}
