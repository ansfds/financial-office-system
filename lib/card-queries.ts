import { Prisma, ReceivedCardStatus } from '@prisma/client';
import { db } from './db';
import { CardState, cardStateDefinitions, summarizeCardStates } from './card-states';
export const activeCardWhere: Prisma.ReceivedCustomerCardWhereInput = {
  deletedAt: null,
  batch: { person: { deletedAt: null, status: 'ACTIVE' } },
};
export function stateWhere(state?: CardState): Prisma.ReceivedCustomerCardWhereInput {
  const definition = cardStateDefinitions.find((s) => s.key === state);
  return definition ? { status: { in: [...definition.statuses] as ReceivedCardStatus[] } } : {};
}
export async function getCardCounts(personId?: string) {
  const rows = await db.receivedCustomerCard.groupBy({
    by: ['status'],
    where: {
      ...activeCardWhere,
      ...(personId ? { batch: { personId, person: { deletedAt: null, status: 'ACTIVE' } } } : {}),
    },
    _count: true,
  });
  return summarizeCardStates(rows);
}
export async function findCardOwners({
  q = '',
  state,
  page = 1,
}: { q?: string; state?: CardState; page?: number } = {}) {
  const cardFilter: Prisma.ReceivedCustomerCardWhereInput = { deletedAt: null, ...stateWhere(state) };
  const where: Prisma.PersonWhereInput = {
    deletedAt: null,
    status: 'ACTIVE',
    cardBatches: { some: { cards: { some: cardFilter } } },
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { phoneSecondary: { contains: q } },
            { cardBatches: { some: { cards: { some: { ...cardFilter, cardLast4: { contains: q } } } } } },
          ],
        }
      : {}),
  };
  const [people, total] = await Promise.all([
    db.person.findMany({
      where,
      select: { id: true, fullName: true, phone: true, phoneSecondary: true, customerNo: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 50,
      take: 50,
    }),
    db.person.count({ where }),
  ]);
  const cards = people.length
    ? await db.receivedCustomerCard.findMany({
        where: { deletedAt: null, batch: { personId: { in: people.map((p) => p.id) } } },
        select: { status: true, batch: { select: { personId: true } } },
      })
    : [];
  return {
    people: people.map((person) => ({
      ...person,
      counts: summarizeCardStates(cards.filter((c) => c.batch.personId === person.id)),
    })),
    total,
    page,
  };
}
