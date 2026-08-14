import { Prisma, PrismaClient } from '@prisma/client';
import { D } from '../lib/money';
import { buildWalletSnapshot } from '../lib/customer-wallet';
import { recalculateReceivedCard } from '../lib/customer-card-recalculation';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

const wrongStandardValues = ['1770', '1780', '1790', '1800', '1815'];
const standardCardValue = D(2000);
const abdulRazakName = 'عبد الرزاق';

type MutableClient = PrismaClient | Prisma.TransactionClient;

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function money(value: unknown) {
  return D(value || 0);
}

function nearlyZero(value: number) {
  return Math.abs(value) < 0.000001;
}

function personLabel(person: { customerNo?: string | null; fullName?: string | null; id: string }) {
  return `${person.customerNo || 'no-code'} ${person.fullName || 'no-name'} ${person.id}`;
}

function isSpecialConfirmedCard(card: {
  cardLast4?: string | null;
  valueUsd: unknown;
  batch: { person: { customerNo?: string | null; fullName?: string | null } };
}) {
  const code = card.batch.person.customerNo || '';
  const last4 = card.cardLast4 || '';
  const value = money(card.valueUsd);

  if (code === '#A006' && value.equals(440)) return true;
  if (code === '#A006' && last4 === '1920' && value.equals(1000)) return true;
  if (code === '#A007' && last4 === '0123' && value.equals(1350)) return true;
  if (code === '#A009' && last4 === '6910' && value.equals(1350)) return true;
  if (code === '#A009' && last4 === '3578' && value.equals(1345)) return true;
  if (code === '#A012' && last4 === '9023' && value.equals(1850)) return true;
  if (last4 === '3558' && value.equals(2000)) return true;

  return false;
}

async function relationCounts(client: MutableClient, personIds: string[]) {
  const wherePerson = { personId: { in: personIds } };
  const [
    financialTransactions,
    sheinCards,
    sheinCardSales,
    receivedCardBatches,
    customerCardEntryTransactions,
    customerCardDeliveries,
    customerAccountRepayments,
    cashboxMovements,
    customerWalletSettlements,
    transactionExecutionItems,
  ] = await Promise.all([
    client.financialTransaction.count({ where: wherePerson }),
    client.sheinCard.count({ where: { buyerPersonId: { in: personIds } } }),
    client.sheinCardSale.count({ where: wherePerson }),
    client.receivedCardBatch.count({ where: wherePerson }),
    client.customerCardEntryTransaction.count({ where: wherePerson }),
    client.customerCardDelivery.count({ where: wherePerson }),
    client.customerAccountRepayment.count({ where: wherePerson }),
    client.cashboxMovement.count({ where: wherePerson }),
    client.customerWalletSettlement.count({ where: wherePerson }),
    client.transactionExecutionItem.count({ where: { customerId: { in: personIds } } }),
  ]);

  return {
    financialTransactions,
    sheinCards,
    sheinCardSales,
    receivedCardBatches,
    customerCardEntryTransactions,
    customerCardDeliveries,
    customerAccountRepayments,
    cashboxMovements,
    customerWalletSettlements,
    transactionExecutionItems,
  };
}

async function walletNetByCurrency(personIds: string[], primaryId?: string) {
  const currencies = await prisma.currency.findMany({ where: { isActive: true } });
  const [transactions, settlements] = await Promise.all([
    prisma.financialTransaction.findMany({
      where: { deletedAt: null, personId: { in: personIds } },
      include: { currency: true },
    }),
    prisma.customerWalletSettlement.findMany({
      where: { deletedAt: null, personId: { in: personIds } },
      include: { currency: true },
    }),
  ]);

  const snapshot = buildWalletSnapshot(
    primaryId ? transactions.map((transaction) => ({ ...transaction, personId: primaryId })) : transactions,
    primaryId ? settlements.map((settlement) => ({ ...settlement, personId: primaryId })) : settlements,
    currencies,
  );
  const net: Record<string, number> = {};

  for (const row of snapshot.rows) {
    const code = row.currency.code || row.currency.name || row.currency.id;
    net[code] = (net[code] || 0) + row.debt - row.credit;
  }

  return net;
}

async function inspectAbdulRazak() {
  const people = await prisma.person.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      OR: [{ customerNo: '#M0001' }, { fullName: { contains: abdulRazakName } }],
    },
    orderBy: [{ customerNo: 'asc' }, { createdAt: 'asc' }],
  });

  const primaryCandidates = people.filter((person) => person.customerNo === '#M0001');
  const primary = primaryCandidates.length === 1 ? primaryCandidates[0] : null;
  const duplicates = primary
    ? people.filter((person) => person.id !== primary.id && person.fullName.includes(abdulRazakName))
    : [];
  const duplicateIds = duplicates.map((person) => person.id);
  const allIds = primary ? [primary.id, ...duplicateIds] : duplicateIds;
  const counts = allIds.length ? await relationCounts(prisma, allIds) : null;
  const projectedNet = primary && allIds.length ? await walletNetByCurrency(allIds, primary.id) : {};
  const duplicateRelationCounts = duplicateIds.length ? await relationCounts(prisma, duplicateIds) : null;

  const ambiguousReasons: string[] = [];
  if (!primary) ambiguousReasons.push(`Expected one active ${abdulRazakName} primary with code #M0001.`);
  if (primaryCandidates.length > 1) ambiguousReasons.push('More than one active #M0001 record exists.');
  if (primary && (!nearlyZero(projectedNet.USD || 0) || !nearlyZero(projectedNet.LYD || 0))) {
    ambiguousReasons.push(`Projected #M0001 balance is not zero: USD=${projectedNet.USD || 0}, LYD=${projectedNet.LYD || 0}.`);
  }

  return {
    people: people.map(personLabel),
    primary,
    duplicates,
    counts,
    duplicateRelationCounts,
    projectedNet,
    ambiguousReasons,
  };
}

async function inspectCards() {
  const candidates = await prisma.receivedCustomerCard.findMany({
    where: {
      deletedAt: null,
      valueUsd: { in: wrongStandardValues.map((value) => new Prisma.Decimal(value)) },
    },
    include: {
      operations: { where: { deletedAt: null }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] },
      batch: { include: { person: true, currency: true } },
      settlementCurrency: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const correctable = candidates.filter((card) => !isSpecialConfirmedCard(card));
  return {
    candidates,
    correctable,
    skippedSpecial: candidates.filter((card) => isSpecialConfirmedCard(card)),
  };
}

async function updateBatchTotals(tx: Prisma.TransactionClient, batchIds: string[]) {
  const uniqueBatchIds = Array.from(new Set(batchIds));

  for (const batchId of uniqueBatchIds) {
    const batch = await tx.receivedCardBatch.findUnique({
      where: { id: batchId },
      include: { cards: { where: { deletedAt: null } } },
    });
    if (!batch) continue;

    const totalOriginalAmount = batch.cards.reduce((sum, card) => sum.add(money(card.valueUsd)), D(0));
    const totalAgreedAmount = batch.cards.reduce((sum, card) => sum.add(money(card.agreedAmount)), D(0));

    await tx.receivedCardBatch.update({
      where: { id: batch.id },
      data: { totalOriginalAmount, totalAgreedAmount },
    });

    if (batch.entryTransactionId) {
      await tx.customerCardEntryTransaction.update({
        where: { id: batch.entryTransactionId },
        data: { totalOriginalAmount, totalAgreedAmount },
      });
    }
  }
}

async function applyCardCorrections(cards: Awaited<ReturnType<typeof inspectCards>>['correctable']) {
  if (!cards.length) return { corrected: 0, batchIds: [] as string[] };

  const batchIds: string[] = [];

  await prisma.$transaction(
    async (tx) => {
      for (const card of cards) {
        const oldSnapshot = jsonValue(card);
        await tx.receivedCustomerCard.update({
          where: { id: card.id },
          data: { valueUsd: standardCardValue },
        });
        const recalculated = await recalculateReceivedCard(tx, card.id);
        batchIds.push(card.batchId);

        await tx.auditLog.create({
          data: {
            action: 'RECEIVED_CARD_ORIGINAL_VALUE_CORRECTION',
            entityType: 'ReceivedCustomerCard',
            entityId: card.id,
            oldValue: oldSnapshot,
            newValue: jsonValue(recalculated),
            description: 'Corrected standard card original value to 2000 without changing agreed amount or operations.',
          },
        });
      }

      await updateBatchTotals(tx, batchIds);
    },
    { maxWait: 20_000, timeout: 120_000 },
  );

  return { corrected: cards.length, batchIds: Array.from(new Set(batchIds)) };
}

async function applyAbdulRazakMerge(inspect: Awaited<ReturnType<typeof inspectAbdulRazak>>) {
  if (!inspect.primary || !inspect.duplicates.length) return { mergedDuplicates: 0, moved: {} };
  if (inspect.ambiguousReasons.length) throw new Error(`ABDUL_RAZAK_AMBIGUOUS: ${inspect.ambiguousReasons.join(' ')}`);

  const primaryId = inspect.primary.id;
  const duplicateIds = inspect.duplicates.map((person) => person.id);
  const moved: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      const before = jsonValue({ primary: inspect.primary, duplicates: inspect.duplicates });
      moved.financialTransactions = (await tx.financialTransaction.updateMany({ where: { personId: { in: duplicateIds } }, data: { personId: primaryId } })).count;
      moved.sheinCards = (await tx.sheinCard.updateMany({ where: { buyerPersonId: { in: duplicateIds } }, data: { buyerPersonId: primaryId } })).count;
      moved.sheinCardSales = (await tx.sheinCardSale.updateMany({ where: { personId: { in: duplicateIds } }, data: { personId: primaryId } })).count;
      moved.receivedCardBatches = (await tx.receivedCardBatch.updateMany({ where: { personId: { in: duplicateIds } }, data: { personId: primaryId } })).count;
      moved.customerCardEntryTransactions = (await tx.customerCardEntryTransaction.updateMany({ where: { personId: { in: duplicateIds } }, data: { personId: primaryId } })).count;
      moved.customerCardDeliveries = (await tx.customerCardDelivery.updateMany({ where: { personId: { in: duplicateIds } }, data: { personId: primaryId } })).count;
      moved.customerAccountRepayments = (await tx.customerAccountRepayment.updateMany({ where: { personId: { in: duplicateIds } }, data: { personId: primaryId } })).count;
      moved.cashboxMovements = (await tx.cashboxMovement.updateMany({ where: { personId: { in: duplicateIds } }, data: { personId: primaryId } })).count;
      moved.customerWalletSettlements = (await tx.customerWalletSettlement.updateMany({ where: { personId: { in: duplicateIds } }, data: { personId: primaryId } })).count;
      moved.transactionExecutionItems = (await tx.transactionExecutionItem.updateMany({ where: { customerId: { in: duplicateIds } }, data: { customerId: primaryId } })).count;

      await tx.person.updateMany({
        where: { id: { in: duplicateIds } },
        data: {
          status: 'ARCHIVED',
          deletedAt: new Date(),
          notes: 'Archived after safe merge into #M0001 عبد الرزاق.',
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'PERSON_DUPLICATE_MERGE',
          entityType: 'Person',
          entityId: primaryId,
          oldValue: before,
          newValue: jsonValue({ primaryId, archivedDuplicateIds: duplicateIds, moved }),
          description: 'Merged duplicate عبد الرزاق records into #M0001 without changing users, settings, or secrets.',
        },
      });
    },
    { maxWait: 20_000, timeout: 120_000 },
  );

  return { mergedDuplicates: duplicateIds.length, moved };
}

async function verify() {
  const [abdulActive, cards3558, wrongCardsRemaining, cardCount] = await Promise.all([
    prisma.person.findMany({
      where: { deletedAt: null, status: 'ACTIVE', OR: [{ customerNo: '#M0001' }, { fullName: { contains: abdulRazakName } }] },
      select: { id: true, customerNo: true, fullName: true },
    }),
    prisma.receivedCustomerCard.count({ where: { deletedAt: null, cardLast4: '3558' } }),
    prisma.receivedCustomerCard.count({
      where: { deletedAt: null, valueUsd: { in: wrongStandardValues.map((value) => new Prisma.Decimal(value)) } },
    }),
    prisma.receivedCustomerCard.count({ where: { deletedAt: null } }),
  ]);
  const primary = abdulActive.find((person) => person.customerNo === '#M0001');
  const net = primary ? await walletNetByCurrency([primary.id]) : {};

  return {
    abdulActive: abdulActive.map(personLabel),
    abdulRazakAppearsOnce: abdulActive.filter((person) => person.fullName.includes(abdulRazakName)).length === 1,
    abdulNet: net,
    card3558Count: cards3558,
    wrongStandardCardsRemaining: wrongCardsRemaining,
    activeCardCount: cardCount,
  };
}

async function main() {
  console.log(`Mode: ${apply ? 'APPLY' : 'INSPECT_ONLY'}`);

  const [abdul, cards] = await Promise.all([inspectAbdulRazak(), inspectCards()]);
  console.log(
    JSON.stringify(
      {
        abdulRazak: {
          people: abdul.people,
          primary: abdul.primary ? personLabel(abdul.primary) : null,
          duplicates: abdul.duplicates.map(personLabel),
          relationCounts: abdul.counts,
          duplicateRelationCounts: abdul.duplicateRelationCounts,
          projectedNet: abdul.projectedNet,
          ambiguousReasons: abdul.ambiguousReasons,
        },
        cards: {
          wrongValueCandidates: cards.candidates.length,
          correctable: cards.correctable.length,
          skippedSpecial: cards.skippedSpecial.length,
          samples: cards.correctable.slice(0, 8).map((card) => ({
            id: card.id,
            code: card.publicCode,
            last4: card.cardLast4,
            customer: personLabel(card.batch.person),
            beforeValueUsd: String(card.valueUsd),
            agreedAmount: String(card.agreedAmount),
            operations: card.operations.length,
          })),
        },
      },
      null,
      2,
    ),
  );

  if (abdul.ambiguousReasons.length) {
    console.error(`Stopped before data changes: ${abdul.ambiguousReasons.join(' ')}`);
    process.exitCode = 2;
    return;
  }

  if (!apply) return;

  const [cardResult, mergeResult] = await Promise.all([
    applyCardCorrections(cards.correctable),
    applyAbdulRazakMerge(abdul),
  ]);
  const verification = await verify();

  console.log(
    JSON.stringify(
      {
        applied: true,
        cardResult,
        mergeResult,
        verification,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
