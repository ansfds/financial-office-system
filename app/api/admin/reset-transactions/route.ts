import { createHash, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { audit, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const RESET_CONFIRMATION_TEXT = 'RESET SYSTEM DATA';

const resetSchema = z.object({
  resetPassword: z.string().min(1),
  confirmationText: z.literal(RESET_CONFIRMATION_TEXT),
  includeSheinCards: z.coerce.boolean().default(false),
  includeReceivedCards: z.coerce.boolean().default(false),
});

export const runtime = 'nodejs';

function resetPasswordSecret() {
  return process.env.RESET_SYSTEM_PASSWORD?.trim() || '';
}

function safeSecretMatch(input: string, secret: string) {
  if (!secret) return false;

  const inputHash = createHash('sha256').update(input).digest();
  const secretHash = createHash('sha256').update(secret).digest();
  return inputHash.length === secretHash.length && timingSafeEqual(inputHash, secretHash);
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST(request: Request) {
  try {
    await requireSession();

    const secret = resetPasswordSecret();
    if (!secret) return fail('تم تعطيل التصفير مؤقتًا حتى يتم ضبط RESET_SYSTEM_PASSWORD', 503);

    const parsed = resetSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail(`أدخل كلمة مرور التصفير واكتب عبارة التأكيد ${RESET_CONFIRMATION_TEXT}`);
    }

    const input = parsed.data;
    if (!safeSecretMatch(input.resetPassword, secret)) return fail('كلمة مرور التصفير غير صحيحة', 403);

    const archivedAt = new Date();
    const stamp = archivedAt.toISOString().replace(/[:.]/g, '-');
    const result = await db.$transaction(async (tx) => {
      const transactions = await tx.financialTransaction.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      const transactionIds = transactions.map((transaction) => transaction.id);
      const transactionNumbers = transactions.map((transaction) => transaction.number);

      const [transactionMovements, cashboxMovements, sheinCardsBefore, receivedCardsBefore] =
        await Promise.all([
          transactionIds.length
            ? tx.transactionMovement.findMany({ where: { transactionId: { in: transactionIds } } })
            : Promise.resolve([]),
          transactionIds.length
            ? tx.cashboxMovement.findMany({ where: { transactionId: { in: transactionIds } } })
            : Promise.resolve([]),
          input.includeSheinCards
            ? tx.sheinCard.findMany({ where: { status: { not: 'CANCELLED' } } })
            : Promise.resolve([]),
          input.includeReceivedCards
            ? tx.receivedCustomerCard.findMany({ where: { status: { not: 'CANCELLED' } } })
            : Promise.resolve([]),
        ]);

      const backupRecord = await tx.backupRecord.create({
        data: {
          type: 'pre-reset-transactions-snapshot',
          filename: `database-snapshot-pre-reset-${stamp}`,
          status: 'completed',
        },
      });

      const deletedItem = await tx.deletedItem.create({
        data: {
          entityType: 'FinancialTransactionBatch',
          entityId: `reset-${archivedAt.toISOString()}`,
          snapshot: toJson({
            backupRecordId: backupRecord.id,
            archivedAt: archivedAt.toISOString(),
            createdBeforeReset: true,
            transactionCount: transactions.length,
            movementCount: transactionMovements.length,
            cashboxMovementCount: cashboxMovements.length,
            transactionNumbers,
            includeSheinCards: input.includeSheinCards,
            includeReceivedCards: input.includeReceivedCards,
            sheinCardsCount: sheinCardsBefore.length,
            receivedCardsCount: receivedCardsBefore.length,
            transactions,
            transactionMovements,
            cashboxMovements,
            sheinCardsBefore,
            receivedCardsBefore,
          }),
        },
      });

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

      return {
        archivedAt,
        archivedTransactions: archivedTransactions.count,
        archivedMovements: archivedMovements.count,
        sheinCards: sheinCards.count,
        receivedCards: receivedCards.count,
        backupRecordId: backupRecord.id,
        deletedItemId: deletedItem.id,
      };
    });

    await audit('TRANSACTIONS_RESET', {
      entityType: 'FinancialTransactionBatch',
      entityId: result.deletedItemId,
      oldValue: {
        backupRecordId: result.backupRecordId,
        deletedItemId: result.deletedItemId,
        archivedAt: result.archivedAt,
        archivedTransactions: result.archivedTransactions,
        archivedMovements: result.archivedMovements,
        includeSheinCards: input.includeSheinCards,
        includeReceivedCards: input.includeReceivedCards,
      },
      newValue: result as any,
      description: 'أرشفة جميع المعاملات القديمة بعد إنشاء نسخة احتياطية تلقائية',
    });
    revalidateFinancePaths();

    return ok(result);
  } catch (error) {
    return apiError(error);
  }
}
