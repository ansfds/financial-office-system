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
import { z } from 'zod';

const operationTypes = ['GIFT_CARD', 'INVOICE', 'FINAL_SETTLEMENT', 'REJECT', 'REACTIVATE', 'ADJUSTMENT'] as const;

const updateOperationSchema = z.object({
  operationType: z.enum(operationTypes).optional(),
  categoryCode: z.string().trim().optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(1000).optional(),
  amount: z.coerce.number().min(0).optional().nullable(),
  note: z.string().trim().optional().nullable(),
  reason: z.string().trim().optional().nullable(),
  occurredAt: z.string().optional().nullable(),
});

const deleteOperationSchema = z.object({
  reason: z.string().trim().optional().nullable(),
});

function fallbackCategory(code: string) {
  return defaultCardDiscountCategories.find((category) => category.code === code) || null;
}

function responseForCardError(error: Error) {
  if (error.message === 'CARD_NOT_FOUND') return fail('البطاقة غير موجودة', 404);
  if (error.message === 'OPERATION_NOT_FOUND') return fail('عملية البطاقة غير موجودة', 404);
  if (error.message === 'CARD_CATEGORY_NOT_FOUND') return fail('اختر فئة كرت صحيحة');
  if (error.message === 'INVALID_OPERATION_AMOUNT') return fail('أدخل مبلغ عملية صحيح');
  if (error.message === 'CARD_OPERATION_OVER_REMAINING') return fail('لا يمكن أن تصبح البطاقة بالسالب بعد إعادة الحساب');
  if (error.message === 'REJECT_REASON_REQUIRED') return fail('اكتب سبب رفض البطاقة');
  return null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; operationId: string }> },
) {
  try {
    await requireSession();
    const { id, operationId } = await params;
    const parsed = updateOperationSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات عملية البطاقة');

    const input = parsed.data;
    let operationSnapshot: any = null;

    const updated = await db.$transaction(async (tx) => {
      const oldOperation = await tx.receivedCardOperation.findFirst({
        where: { id: operationId, cardId: id, deletedAt: null },
        include: { card: true },
      });
      if (!oldOperation || oldOperation.card.deletedAt) throw new Error('OPERATION_NOT_FOUND');
      operationSnapshot = oldOperation;

      const operationType = input.operationType || oldOperation.operationType;
      if (operationType === 'REJECT' && !(input.reason || oldOperation.reason || input.note || oldOperation.note)) {
        throw new Error('REJECT_REASON_REQUIRED');
      }

      const quantity = input.quantity || oldOperation.quantity || 1;
      const categoryCode = input.categoryCode || oldOperation.categoryCode || defaultCardDiscountCategories[0].code;
      const dbCategory =
        operationType === 'GIFT_CARD'
          ? await tx.cardDiscountCategory.findFirst({ where: { code: categoryCode, isActive: true } })
          : null;
      const category = dbCategory || (operationType === 'GIFT_CARD' ? fallbackCategory(categoryCode) : null);
      const currentAmount =
        input.amount === undefined || input.amount === null ? oldOperation.amount : D(input.amount);
      const amount =
        operationType === 'FINAL_SETTLEMENT' && input.amount === undefined
          ? D(oldOperation.amount)
          : cardOperationAmount({
              operationType,
              amount: currentAmount,
              quantity,
              category,
              currentRemaining: oldOperation.balanceBefore,
            });

      if (isCardDeductionOperation(operationType) && amount.lte(0)) throw new Error('INVALID_OPERATION_AMOUNT');

      await tx.receivedCardOperation.update({
        where: { id: operationId },
        data: {
          operationType: operationType as any,
          categoryCode: operationType === 'GIFT_CARD' ? categoryCode : null,
          categoryFaceValue: category ? D(category.faceValue) : null,
          quantity: operationType === 'GIFT_CARD' ? quantity : 1,
          amount,
          note: input.note === undefined ? oldOperation.note : input.note || null,
          reason: input.reason === undefined ? oldOperation.reason : input.reason || null,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : oldOperation.occurredAt,
        },
      });

      return recalculateReceivedCard(tx, id);
    });

    await audit('RECEIVED_CARD_OPERATION_UPDATE', {
      entityType: 'ReceivedCardOperation',
      entityId: operationId,
      oldValue: operationSnapshot as any,
      newValue: updated as any,
      description: 'تعديل عملية بطاقة وإعادة حساب الرصيد',
    });

    return ok(updated);
  } catch (error) {
    const handled = responseForCardError(error as Error);
    if (handled) return handled;
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; operationId: string }> },
) {
  try {
    const session = await requireSession();
    const { id, operationId } = await params;
    const parsed = deleteOperationSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail('تحقق من سبب حذف العملية');

    let oldSnapshot: any = null;
    let deletedSnapshot: any = null;

    const updated = await db.$transaction(async (tx) => {
      const oldOperation = await tx.receivedCardOperation.findFirst({
        where: { id: operationId, cardId: id, deletedAt: null },
        include: { card: true },
      });
      if (!oldOperation || oldOperation.card.deletedAt) throw new Error('OPERATION_NOT_FOUND');
      oldSnapshot = oldOperation.card;

      deletedSnapshot = await tx.receivedCardOperation.update({
        where: { id: operationId },
        data: {
          deletedAt: new Date(),
          deletedBy: session.username,
          deleteReason: parsed.data.reason || 'حذف منطقي لعملية بطاقة',
        },
      });

      return recalculateReceivedCard(tx, id);
    });

    await audit('RECEIVED_CARD_OPERATION_ARCHIVE', {
      entityType: 'ReceivedCardOperation',
      entityId: operationId,
      oldValue: oldSnapshot as any,
      newValue: { deletedOperation: deletedSnapshot, card: updated } as any,
      description: 'حذف منطقي لعملية بطاقة وإعادة حساب الرصيد',
    });

    return ok(updated);
  } catch (error) {
    const handled = responseForCardError(error as Error);
    if (handled) return handled;
    return apiError(error);
  }
}
