import { audit, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import {
  cardOperationAmount,
  defaultCardDiscountCategories,
  isCardDeductionOperation,
} from '@/lib/customer-cards';
import { recalculateReceivedCard } from '@/lib/customer-card-recalculation';
import { revalidatePaths } from '@/lib/revalidate';
import { z } from 'zod';

const operationTypes = ['GIFT_CARD', 'INVOICE', 'FINAL_SETTLEMENT', 'REJECT', 'REACTIVATE', 'ADJUSTMENT'] as const;

const operationSchema = z.object({
  operationType: z.enum(operationTypes),
  categoryCode: z.string().trim().optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
  amount: z.coerce.number().min(0).optional().nullable(),
  note: z.string().trim().optional().nullable(),
  reason: z.string().trim().optional().nullable(),
  occurredAt: z.string().optional().nullable(),
});

function fallbackCategory(code: string) {
  return defaultCardDiscountCategories.find((category) => category.code === code) || null;
}

function responseForCardError(error: Error) {
  if (error.message === 'CARD_NOT_FOUND') return fail('البطاقة غير موجودة', 404);
  if (error.message === 'CARD_REJECTED') return fail('البطاقة مرفوضة ولا تقبل عمليات جديدة قبل إعادة التنشيط');
  if (error.message === 'CARD_CATEGORY_NOT_FOUND') return fail('اختر فئة كرت صحيحة');
  if (error.message === 'INVALID_OPERATION_AMOUNT') return fail('أدخل مبلغ عملية صحيح');
  if (error.message === 'CARD_OPERATION_OVER_REMAINING') return fail('لا يمكن تنفيذ عملية أكبر من المتبقي في البطاقة');
  if (error.message === 'REJECT_REASON_REQUIRED') return fail('اكتب سبب رفض البطاقة');
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const parsed = operationSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات عملية البطاقة');

    const input = parsed.data;
    let oldSnapshot: any = null;
    let createdOperation: any = null;

    const updated = await db.$transaction(async (tx) => {
      const card = await tx.receivedCustomerCard.findFirst({
        where: { id, deletedAt: null },
        include: { batch: { include: { person: true, currency: true } }, operations: true },
      });
      if (!card) throw new Error('CARD_NOT_FOUND');
      if (card.status === 'CANCELLED' && input.operationType !== 'REACTIVATE') throw new Error('CARD_REJECTED');
      if (input.operationType === 'REJECT' && !(input.reason || input.note)) throw new Error('REJECT_REASON_REQUIRED');
      oldSnapshot = card;

      const currentRemaining = D(card.remainingAmount || 0);
      const categoryCode = input.categoryCode || defaultCardDiscountCategories[0].code;
      const dbCategory =
        input.operationType === 'GIFT_CARD'
          ? await tx.cardDiscountCategory.findFirst({ where: { code: categoryCode, isActive: true } })
          : null;
      const category = dbCategory || (input.operationType === 'GIFT_CARD' ? fallbackCategory(categoryCode) : null);
      const amount = cardOperationAmount({
        operationType: input.operationType,
        amount: input.amount,
        quantity: input.quantity,
        category,
        currentRemaining,
      });

      if (isCardDeductionOperation(input.operationType) && amount.lte(0)) throw new Error('INVALID_OPERATION_AMOUNT');
      if (isCardDeductionOperation(input.operationType) && amount.gt(currentRemaining)) {
        throw new Error('CARD_OPERATION_OVER_REMAINING');
      }

      const balanceAfter = isCardDeductionOperation(input.operationType) ? currentRemaining.sub(amount) : currentRemaining;
      createdOperation = await tx.receivedCardOperation.create({
        data: {
          cardId: id,
          operationType: input.operationType as any,
          categoryCode: input.operationType === 'GIFT_CARD' ? categoryCode : null,
          categoryFaceValue: category ? D(category.faceValue) : null,
          quantity: input.operationType === 'GIFT_CARD' ? input.quantity : 1,
          amount,
          balanceBefore: currentRemaining,
          balanceAfter,
          note: input.note || null,
          reason: input.reason || null,
          userId: session.userId,
          username: session.username,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        },
      });

      await tx.receivedCardStageLog.create({
        data: {
          cardId: id,
          stage: card.currentStage || 0,
          direction: input.operationType,
          amount,
          note: input.note || input.reason || null,
          userId: session.userId,
          username: session.username,
        },
      });

      return recalculateReceivedCard(tx, id);
    });

    await audit('RECEIVED_CARD_OPERATION_CREATE', {
      entityType: 'ReceivedCardOperation',
      entityId: createdOperation.id,
      oldValue: oldSnapshot as any,
      newValue: { operation: createdOperation, card: updated } as any,
      description: 'إضافة عملية على بطاقة زبون وإعادة حساب الرصيد',
    });
    revalidatePaths(updated.batch?.personId ? ['/people', `/people/${updated.batch.personId}`, '/inventory/received-cards'] : ['/people']);

    return ok(updated, 201);
  } catch (error) {
    const handled = responseForCardError(error as Error);
    if (handled) return handled;
    return apiError(error);
  }
}
