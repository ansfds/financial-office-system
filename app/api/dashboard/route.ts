import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { apiError, ok } from '@/lib/http';

export async function GET() {
  try {
    await requireSession();

    const [people, transactions, recent, currencies, latestBalances, sheinAvailable, sheinPending, receivedCards] =
      await Promise.all([
        db.person.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
        db.financialTransaction.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: true,
        }),
        db.financialTransaction.findMany({
          where: { deletedAt: null },
          include: { person: true, currency: true, type: true },
          orderBy: { transactionAt: 'desc' },
          take: 8,
        }),
        db.currency.findMany({ where: { isActive: true } }),
        db.$queryRaw<Array<{ currencyId: string; balanceAfter: any }>>`
          SELECT DISTINCT ON ("currencyId") "currencyId", "balanceAfter"
          FROM "CashboxMovement"
          ORDER BY "currencyId", "occurredAt" DESC, "createdAt" DESC
        `,
        db.sheinCard.count({ where: { status: 'AVAILABLE' } }),
        db.transactionExecutionItem.count({
          where: {
            status: { not: 'COMPLETED' },
            transaction: { operationKind: 'SHEIN_CARD_SALE', deletedAt: null, executionStatus: 'PENDING' },
          },
        }),
        db.receivedCustomerCard.count({ where: { status: { not: 'CANCELLED' } } }),
      ]);

    const balances = currencies.map((currency) => ({
      currency,
      balance: latestBalances.find((movement) => movement.currencyId === currency.id)?.balanceAfter || 0,
    }));

    return ok({
      people,
      transactions,
      recent,
      balances,
      inventory: {
        sheinAvailable,
        sheinPending,
        sheinDifference: sheinAvailable - sheinPending,
        receivedCards,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
