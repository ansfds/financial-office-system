import { Prisma } from '@prisma/client';
import { sortByCustomerCode } from './customer-code-sort';
import { db } from './db';
import { currencySelect } from './received-card-selects';

type FindPeopleOptions = {
  q?: string;
  page?: number;
  pageSize?: number;
};

function amount(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function basePersonSelect() {
  return {
    id: true,
    customerNo: true,
    fullName: true,
    phone: true,
    address: true,
    externalId: true,
    notes: true,
    category: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  } satisfies Prisma.PersonSelect;
}

function searchWhere(q: string): Prisma.PersonWhereInput {
  return {
    deletedAt: null,
    status: 'ACTIVE',
    OR: q
      ? [
          { fullName: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { customerNo: { contains: q, mode: 'insensitive' } },
          { externalId: { contains: q, mode: 'insensitive' } },
          { notes: { contains: q, mode: 'insensitive' } },
          { cardBatches: { some: { cards: { some: { deletedAt: null, cardLast4: { contains: q } } } } } },
        ]
      : undefined,
  };
}

export async function findPeopleWithCardSummaries(options: FindPeopleOptions = {}) {
  const q = options.q?.trim() || '';
  const page = Math.max(Number(options.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(options.pageSize || 100), 20), 200);

  const people = await db.person.findMany({
    where: searchWhere(q),
    select: basePersonSelect(),
    orderBy: [{ customerNo: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const personIds = people.map((person) => person.id);
  if (!personIds.length) return [];

  const [cards, deliveries] = await Promise.all([
    db.receivedCustomerCard.findMany({
      where: { deletedAt: null, batch: { personId: { in: personIds } } },
      select: {
        id: true,
        status: true,
        valueUsd: true,
        agreedAmount: true,
        totalDeducted: true,
        receivedAmount: true,
        remainingAmount: true,
        updatedAt: true,
        batch: { select: { personId: true, currency: { select: currencySelect } } },
        settlementCurrency: { select: currencySelect },
      },
    }),
    db.customerCardDelivery.findMany({
      where: { deletedAt: null, personId: { in: personIds } },
      select: {
        personId: true,
        currencyId: true,
        amount: true,
        currency: { select: currencySelect },
      },
      orderBy: { occurredAt: 'desc' },
    }),
  ]);

  const summaries = new Map<
    string,
    {
      totalCards: number;
      originalTotal: number;
      agreedTotal: number;
      active: number;
      completed: number;
      rejected: number;
      lastUpdate: Date | null;
    }
  >();
  const deliveryRows = new Map<string, Map<string, { currency: any; agreed: number; delivered: number; remaining: number }>>();

  for (const person of people) {
    summaries.set(person.id, {
      totalCards: 0,
      originalTotal: 0,
      agreedTotal: 0,
      active: 0,
      completed: 0,
      rejected: 0,
      lastUpdate: person.updatedAt || person.createdAt,
    });
    deliveryRows.set(person.id, new Map());
  }

  for (const card of cards) {
    const personId = card.batch.personId;
    const summary = summaries.get(personId);
    if (!summary) continue;

    const original = amount(card.valueUsd) > 0 ? amount(card.valueUsd) : 0;
    summary.totalCards += 1;
    summary.originalTotal += original;
    summary.agreedTotal += amount(card.agreedAmount);
    if (['RECEIVED', 'IN_SETTLEMENT', 'PARTIAL'].includes(card.status)) summary.active += 1;
    if (['SETTLED', 'COMPLETED'].includes(card.status)) summary.completed += 1;
    if (card.status === 'CANCELLED') summary.rejected += 1;
    if (!summary.lastUpdate || card.updatedAt > summary.lastUpdate) summary.lastUpdate = card.updatedAt;

    if (card.status !== 'CANCELLED') {
      const currency = card.settlementCurrency || card.batch.currency;
      if (currency?.id) {
        const rows = deliveryRows.get(personId);
        const current =
          rows?.get(currency.id) || { currency, agreed: 0, delivered: 0, remaining: 0 };
        current.agreed += amount(card.agreedAmount);
        rows?.set(currency.id, current);
      }
    }
  }

  for (const delivery of deliveries) {
    const rows = deliveryRows.get(delivery.personId);
    if (!rows || !delivery.currency?.id) continue;
    const current =
      rows.get(delivery.currency.id) || { currency: delivery.currency, agreed: 0, delivered: 0, remaining: 0 };
    current.delivered += amount(delivery.amount);
    rows.set(delivery.currency.id, current);
  }

  return sortByCustomerCode(
    people.map((person) => {
      const rows = Array.from((deliveryRows.get(person.id) || new Map()).values()).map((row) => ({
        ...row,
        remaining: Math.max(row.agreed - row.delivered, 0),
      }));

      return {
        ...person,
        cardSummary: summaries.get(person.id),
        deliverySummary: rows,
        cardBatches: [],
        cardDeliveries: [],
      };
    }),
  );
}
