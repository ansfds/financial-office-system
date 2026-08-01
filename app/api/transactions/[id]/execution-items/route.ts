import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const bulkSchema = z.object({
  action: z.enum(['COMPLETE_ALL']),
});

const executionItemInclude = {
  customer: { select: { id: true, fullName: true, customerNo: true } },
  sheinCard: {
    select: {
      id: true,
      code: true,
      denomination: true,
      status: true,
      linkedTransactionId: true,
      linkedExecutionItemId: true,
      usedAt: true,
    },
  },
  executedBy: { select: { id: true, username: true } },
};

function transactionDetails(transaction: any) {
  return transaction.operationDetails && typeof transaction.operationDetails === 'object'
    ? { ...(transaction.operationDetails as Record<string, any>) }
    : {};
}

async function loadTransaction(tx: any, id: string) {
  return tx.financialTransaction.findUnique({
    where: { id },
    include: {
      person: { select: { id: true, fullName: true, customerNo: true } },
      currency: true,
      sheinCardSale: true,
      executionItems: {
        include: executionItemInclude,
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

async function ensureSaleItem(tx: any, saleId: string | null | undefined, cardId: string) {
  if (!saleId) return;

  await tx.sheinCardSaleItem.upsert({
    where: { cardId },
    update: { saleId },
    create: { saleId, cardId },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();

    const { id } = await params;
    const transaction = await loadTransaction(db, id);
    if (!transaction) return fail('المعاملة غير موجودة', 404);

    const details = transactionDetails(transaction);
    const denomination = details.denomination ? D(details.denomination) : null;
    const availableCards = denomination
      ? await db.sheinCard.findMany({
          where: { denomination, status: 'AVAILABLE' },
          select: { id: true, code: true, denomination: true, status: true },
          orderBy: { createdAt: 'asc' },
          take: 200,
        })
      : [];

    return ok({
      transaction,
      items: transaction.executionItems,
      availableCards,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const username = session.username || 'system';
    const userId = session.userId || undefined;
    const { id } = await params;
    const parsed = bulkSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات تنفيذ الطلب');

    const result = await db.$transaction(async (tx) => {
      const transaction = await loadTransaction(tx, id);
      if (!transaction) throw new Error('TRANSACTION_NOT_FOUND');
      if (transaction.operationKind !== 'SHEIN_CARD_SALE') throw new Error('NOT_SHEIN_TRANSACTION');
      if (!transaction.executionItems.length) throw new Error('NO_EXECUTION_ITEMS');

      const missingCard = transaction.executionItems.find((item: any) => !item.sheinCardId);
      if (missingCard) throw new Error('EXECUTION_ITEM_CARD_REQUIRED');

      const date = new Date();
      const details = transactionDetails(transaction);
      const pricePerCard = D(details.pricePerCard || transaction.sheinCardSale?.pricePerCard || 0);
      const saleId = transaction.sheinCardSale?.id;

      for (const item of transaction.executionItems) {
        await tx.transactionExecutionItem.update({
          where: { id: item.id },
          data: {
            status: 'COMPLETED',
            executedAt: item.executedAt || date,
            executedByUserId: item.executedByUserId || userId,
          },
        });

        await tx.sheinCard.update({
          where: { id: item.sheinCardId },
          data: {
            status: 'USED',
            buyerPersonId: transaction.personId,
            salePrice: pricePerCard.gt(0) ? pricePerCard : undefined,
            saleCurrencyId: transaction.currencyId,
            salePaymentMethod: transaction.sheinPaymentMethod,
            linkedTransactionId: transaction.id,
            linkedExecutionItemId: item.id,
            usedAt: item.executedAt || date,
            usedByUserId: item.executedByUserId || userId,
            soldAt: item.sheinCard?.usedAt || date,
            logs: {
              create: {
                type: 'SALE',
                amount: pricePerCard.gt(0) ? pricePerCard : null,
                note: `تنفيذ ${item.itemNumber} من الطلب ${transaction.number}`,
                createdBy: username,
              },
            },
          },
        });

        await ensureSaleItem(tx, saleId, item.sheinCardId!);
      }

      details.executedCards = transaction.executionItems.length;
      details.executionCompletedAt = date.toISOString();

      const updated = await tx.financialTransaction.update({
        where: { id },
        data: {
          executionStatus: 'COMPLETED',
          operationDetails: details,
        },
        include: {
          person: true,
          currency: true,
          type: true,
          executionItems: {
            include: executionItemInclude,
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return { before: transaction, updated };
    });

    await audit('TRANSACTION_EXECUTION_COMPLETE_ALL', {
      entityType: 'FinancialTransaction',
      entityId: id,
      oldValue: result.before as any,
      newValue: result.updated as any,
      description: 'تنفيذ طلب كروت شي إن بالكامل',
    });
    revalidateFinancePaths(result.updated.personId ? [`/people/${result.updated.personId}`] : []);

    return ok(result.updated);
  } catch (error) {
    if ((error as Error).message === 'TRANSACTION_NOT_FOUND') return fail('المعاملة غير موجودة', 404);
    if ((error as Error).message === 'NOT_SHEIN_TRANSACTION') return fail('هذا الإجراء متاح لمعاملات كروت شي إن فقط');
    if ((error as Error).message === 'NO_EXECUTION_ITEMS') return fail('لا توجد عناصر تنفيذ لهذا الطلب');
    if ((error as Error).message === 'EXECUTION_ITEM_CARD_REQUIRED') {
      return fail('لا يمكن تنفيذ الطلب بالكامل قبل ربط كل العناصر بكروت متوفرة');
    }
    return apiError(error);
  }
}
