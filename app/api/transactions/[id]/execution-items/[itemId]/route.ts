import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const updateItemSchema = z.object({
  sheinCardId: z.string().optional().nullable(),
  status: z.enum(['PENDING', 'COMPLETED', 'NOT_EXECUTED']).optional(),
  note: z.string().trim().optional().nullable(),
});

const itemInclude = {
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

async function releaseLinkedCard(tx: any, cardId: string, username: string, note?: string | null) {
  await tx.sheinCardSaleItem.deleteMany({ where: { cardId } });
  await tx.sheinCard.update({
    where: { id: cardId },
    data: {
      status: 'AVAILABLE',
      buyerPersonId: null,
      linkedTransactionId: null,
      linkedExecutionItemId: null,
      usedAt: null,
      usedByUserId: null,
      soldAt: null,
      saleCashboxMovementId: null,
      logs: {
        create: {
          type: 'RELEASE',
          note: note || 'إلغاء ربط كرت من عنصر تنفيذ',
          createdBy: username,
        },
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const session = await requireSession();
    const username = session.username || 'system';
    const userId = session.userId || undefined;
    const { id, itemId } = await params;
    const parsed = updateItemSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات عنصر التنفيذ');

    const input = parsed.data;

    const result = await db.$transaction(async (tx) => {
      const item = await tx.transactionExecutionItem.findUnique({
        where: { id: itemId },
        include: {
          sheinCard: true,
          transaction: {
            include: {
              person: true,
              currency: true,
              type: true,
              sheinCardSale: true,
            },
          },
        },
      });
      if (!item || item.transactionId !== id) throw new Error('EXECUTION_ITEM_NOT_FOUND');
      if (item.transaction.operationKind !== 'SHEIN_CARD_SALE') throw new Error('NOT_SHEIN_TRANSACTION');

      const transaction = item.transaction;
      const details = transactionDetails(transaction);
      const denomination = D(details.denomination || 0);
      const pricePerCard = D(details.pricePerCard || transaction.sheinCardSale?.pricePerCard || 0);
      const nextStatus = input.status || item.status;
      let nextCardId = input.sheinCardId === undefined ? item.sheinCardId : input.sheinCardId || null;
      const note = input.note === undefined ? item.note : input.note;
      const date = new Date();

      if (input.sheinCardId !== undefined && item.sheinCardId && item.sheinCardId !== input.sheinCardId) {
        await releaseLinkedCard(tx, item.sheinCardId, username, note);
      }

      if (input.sheinCardId) {
        const card = await tx.sheinCard.findUnique({ where: { id: input.sheinCardId } });
        if (!card) throw new Error('SHEIN_CARD_NOT_FOUND');
        if (card.id !== item.sheinCardId && card.status !== 'AVAILABLE') throw new Error('SHEIN_CARD_NOT_AVAILABLE');
        if (!D(card.denomination).equals(denomination)) throw new Error('SHEIN_CARD_DENOMINATION_MISMATCH');

        await tx.sheinCard.update({
          where: { id: card.id },
          data: {
            status: 'USED',
            salePrice: pricePerCard.gt(0) ? pricePerCard : undefined,
            saleCurrencyId: transaction.currencyId,
            salePaymentMethod: transaction.sheinPaymentMethod,
            buyerPersonId: transaction.personId,
            linkedTransactionId: transaction.id,
            linkedExecutionItemId: item.id,
            usedAt: nextStatus === 'COMPLETED' ? date : null,
            usedByUserId: nextStatus === 'COMPLETED' ? userId : null,
            soldAt: nextStatus === 'COMPLETED' ? date : null,
            logs: {
              create: {
                type: nextStatus === 'COMPLETED' ? 'SALE' : 'RESERVE',
                amount: pricePerCard.gt(0) ? pricePerCard : null,
                note: note || `ربط ${card.code} مع ${item.itemNumber} في الطلب ${transaction.number}`,
                createdBy: username,
              },
            },
          },
        });

        await ensureSaleItem(tx, transaction.sheinCardSale?.id, card.id);
        nextCardId = card.id;
      }

      if (nextStatus === 'COMPLETED' && !nextCardId) throw new Error('EXECUTION_ITEM_CARD_REQUIRED');

      if (nextStatus === 'NOT_EXECUTED' && nextCardId) {
        await releaseLinkedCard(tx, nextCardId!, username, note);
        nextCardId = null;
      }

      const updatedItem = await tx.transactionExecutionItem.update({
        where: { id: item.id },
        data: {
          sheinCardId: nextCardId,
          status: nextStatus,
          executedAt: nextStatus === 'COMPLETED' ? item.executedAt || date : null,
          executedByUserId: nextStatus === 'COMPLETED' ? item.executedByUserId || userId : null,
          note,
        },
        include: itemInclude,
      });

      const allItems = await tx.transactionExecutionItem.findMany({
        where: { transactionId: transaction.id },
        select: { status: true },
      });
      const executedCards = allItems.filter((row: any) => row.status === 'COMPLETED').length;
      details.executedCards = executedCards;
      details.pendingCards = Math.max(allItems.length - executedCards, 0);
      if (executedCards === allItems.length && allItems.length > 0) {
        details.executionCompletedAt = date.toISOString();
      }

      const updatedTransaction = await tx.financialTransaction.update({
        where: { id: transaction.id },
        data: {
          executionStatus: executedCards === allItems.length && allItems.length > 0 ? 'COMPLETED' : 'PENDING',
          operationDetails: details,
        },
        include: {
          person: true,
          currency: true,
          type: true,
          executionItems: {
            include: itemInclude,
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return { before: item, updatedItem, updatedTransaction };
    });

    await audit('TRANSACTION_EXECUTION_ITEM_UPDATE', {
      entityType: 'TransactionExecutionItem',
      entityId: itemId,
      oldValue: result.before as any,
      newValue: result.updatedItem as any,
      description: 'تعديل عنصر تنفيذ كرت شي إن',
    });
    revalidateFinancePaths(result.updatedTransaction.personId ? [`/people/${result.updatedTransaction.personId}`] : []);

    return ok(result.updatedTransaction);
  } catch (error) {
    if ((error as Error).message === 'EXECUTION_ITEM_NOT_FOUND') return fail('عنصر التنفيذ غير موجود', 404);
    if ((error as Error).message === 'NOT_SHEIN_TRANSACTION') return fail('هذا الإجراء متاح لمعاملات كروت شي إن فقط');
    if ((error as Error).message === 'SHEIN_CARD_NOT_FOUND') return fail('الكرت غير موجود', 404);
    if ((error as Error).message === 'SHEIN_CARD_NOT_AVAILABLE') return fail('هذا الكرت غير متوفر أو مستخدم بالفعل');
    if ((error as Error).message === 'SHEIN_CARD_DENOMINATION_MISMATCH') return fail('فئة الكرت لا تطابق فئة الطلب');
    if ((error as Error).message === 'EXECUTION_ITEM_CARD_REQUIRED') return fail('لا يمكن تنفيذ الكرت قبل ربطه بكرت متوفر من المخزون');
    return apiError(error);
  }
}
