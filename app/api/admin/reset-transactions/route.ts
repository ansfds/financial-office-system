import { audit, requireSession, safeCodeMatch } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const resetSchema = z.object({
  accessCode: z.string().min(1),
  backupConfirmed: z.literal(true),
  includeSheinCards: z.coerce.boolean().default(false),
  includeReceivedCards: z.coerce.boolean().default(false),
});

export async function POST(request: Request) {
  try {
    await requireSession();

    const parsed = resetSchema.safeParse(await request.json());
    if (!parsed.success) return fail('أدخل رمز الدخول وأكد أخذ نسخة احتياطية قبل التصفير');

    const input = parsed.data;
    if (!safeCodeMatch(input.accessCode)) return fail('رمز الدخول غير صحيح', 403);

    const archivedAt = new Date();
    const result = await db.$transaction(async (tx) => {
      const transactions = await tx.financialTransaction.findMany({
        where: { deletedAt: null },
        select: { id: true, number: true },
      });

      const transactionIds = transactions.map((transaction) => transaction.id);
      const archivedTransactions = transactionIds.length
        ? await tx.financialTransaction.updateMany({
            where: { id: { in: transactionIds } },
            data: { deletedAt: archivedAt, status: 'CANCELLED' },
          })
        : { count: 0 };

      const archivedMovements = transactionIds.length
        ? await tx.transactionMovement.updateMany({
            where: { transactionId: { in: transactionIds }, deletedAt: null },
            data: { deletedAt: archivedAt },
          })
        : { count: 0 };

      const sheinCards = input.includeSheinCards
        ? await tx.sheinCard.updateMany({
            where: { status: { not: 'CANCELLED' } },
            data: { status: 'CANCELLED' },
          })
        : { count: 0 };

      const receivedCards = input.includeReceivedCards
        ? await tx.receivedCustomerCard.updateMany({
            where: { status: { not: 'CANCELLED' } },
            data: { status: 'CANCELLED' },
          })
        : { count: 0 };

      const deletedItem = await tx.deletedItem.create({
        data: {
          entityType: 'FinancialTransactionBatch',
          entityId: `reset-${archivedAt.toISOString()}`,
          snapshot: {
            archivedAt: archivedAt.toISOString(),
            transactionCount: archivedTransactions.count,
            movementCount: archivedMovements.count,
            transactionNumbers: transactions.map((transaction) => transaction.number),
            includeSheinCards: input.includeSheinCards,
            includeReceivedCards: input.includeReceivedCards,
            sheinCardsCount: sheinCards.count,
            receivedCardsCount: receivedCards.count,
          },
        },
      });

      return {
        archivedAt,
        archivedTransactions: archivedTransactions.count,
        archivedMovements: archivedMovements.count,
        sheinCards: sheinCards.count,
        receivedCards: receivedCards.count,
        deletedItemId: deletedItem.id,
      };
    });

    await audit('TRANSACTIONS_RESET', {
      entityType: 'FinancialTransactionBatch',
      entityId: result.deletedItemId,
      newValue: result as any,
      description: 'حذف جميع المعاملات القديمة بنظام الأرشفة',
    });
    revalidateFinancePaths();

    return ok(result);
  } catch (error) {
    return apiError(error);
  }
}
