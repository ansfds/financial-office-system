import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { balanceWarning, createCashboxMovement } from '@/lib/cashbox';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { detailedPaymentCurrencyCode, detailedPaymentLabels } from '@/lib/payment-methods';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { cardBaseAmount, cardProgressPercent, cardStatusForStage, nextCardStage } from '@/lib/customer-cards';
import { z } from 'zod';

const settlementMethods = ['USD_CASH', 'USD_TRANSFER', 'USD_CARD', 'LYD_CASH', 'LYD_TRANSFER', 'LYD_OFFICE_TRANSFER', 'LYD_CARD'] as const;
const settlementStatuses = new Set(['PARTIAL', 'SETTLED', 'COMPLETED']);
const cardImageDataUrlSchema = z
  .string()
  .max(2800000)
  .regex(/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/);

const updateReceivedCardSchema = z.object({
  bankName: z.string().trim().optional().nullable(),
  cardLast4: z
    .string()
    .trim()
    .regex(/^\d{0,4}$/, 'آخر 4 أرقام فقط')
    .optional()
    .nullable(),
  valueUsd: z.coerce.number().min(0).optional(),
  agreedAmount: z.coerce.number().positive().optional(),
  settlementAmount: z.coerce.number().min(0).optional().nullable(),
  settlementCurrencyId: z.string().optional().nullable(),
  settlementPaymentMethod: z.enum(settlementMethods).optional().nullable(),
  receivedAmount: z.coerce.number().min(0).optional(),
  verificationReceived: z.coerce.boolean().optional(),
  secureInternalNote: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  rejectReason: z.string().trim().optional().nullable(),
  cardImageDataUrl: cardImageDataUrlSchema.optional().nullable(),
  cardThumbnailDataUrl: cardImageDataUrlSchema.optional().nullable(),
  cardImageMimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional().nullable(),
  cardImageSize: z.coerce.number().int().min(0).max(2000000).optional().nullable(),
  status: z.enum(['RECEIVED', 'IN_SETTLEMENT', 'SETTLED', 'PARTIAL', 'COMPLETED', 'CANCELLED']).optional(),
  currentStage: z.coerce.number().int().min(0).max(5).optional(),
  stageAction: z.enum(['NEXT', 'PREVIOUS']).optional(),
  stageAmount: z.coerce.number().min(0).optional(),
  stageNote: z.string().trim().optional().nullable(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();

    const { id } = await params;
    const parsed = updateReceivedCardSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات البطاقة المستلمة');

    const input = parsed.data;
    let negativeBalanceWarning = false;
    let oldSnapshot: any = null;
    let settlementMovementCreated = false;
    let receiptMovementReversed = false;

    const updated = await db.$transaction(async (tx) => {
      const oldValue = await tx.receivedCustomerCard.findUnique({
        where: { id },
        include: {
          batch: { include: { person: true, currency: true } },
          settlementCurrency: true,
          stageLogs: { orderBy: { createdAt: 'desc' }, take: 8 },
        },
      });
      if (!oldValue) throw new Error('CARD_NOT_FOUND');
      oldSnapshot = oldValue;

      const valueUsd = input.valueUsd === undefined ? oldValue.valueUsd : D(input.valueUsd);
      const agreedAmount = input.agreedAmount === undefined ? oldValue.agreedAmount : D(input.agreedAmount);
      const oldStage = oldValue.currentStage || 0;
      const stageAmount = input.stageAmount === undefined ? null : D(input.stageAmount);
      const nextStage = input.stageAction ? nextCardStage(oldStage, input.stageAction) : nextCardStage(input.currentStage ?? oldStage);
      const receivedAmount =
        input.stageAction === 'NEXT' && stageAmount
          ? D(oldValue.receivedAmount).add(stageAmount)
          : input.receivedAmount === undefined
            ? oldValue.receivedAmount
            : D(input.receivedAmount);
      const status = input.status || cardStatusForStage(nextStage, oldValue.status);
      const shouldSettle = settlementStatuses.has(status);
      const note = input.notes === undefined ? oldValue.notes : input.notes;
      const statusChanged = status !== oldValue.status;
      const willCancel = status === 'CANCELLED';
      const rejectReason =
        input.rejectReason === undefined ? oldValue.rejectReason : input.rejectReason?.trim() || null;
      if (willCancel && !rejectReason) throw new Error('REJECT_REASON_REQUIRED');
      const personId = oldValue.batch.personId;
      const personName = oldValue.batch.person?.fullName || '';

      const settlementAmount =
        input.settlementAmount === undefined
          ? oldValue.settlementAmount
          : input.settlementAmount === null
            ? null
            : D(input.settlementAmount);
      let settlementCurrencyId =
        input.settlementCurrencyId === undefined ? oldValue.settlementCurrencyId : input.settlementCurrencyId || null;
      let settlementPaymentMethod =
        input.settlementPaymentMethod === undefined
          ? oldValue.settlementPaymentMethod
          : input.settlementPaymentMethod || null;

      if (settlementPaymentMethod && !settlementMethods.includes(settlementPaymentMethod as any)) {
        throw new Error('INVALID_SETTLEMENT_METHOD');
      }

      if (settlementPaymentMethod) {
        const settlementCurrency = await tx.currency.findFirst({
          where: { code: detailedPaymentCurrencyCode[settlementPaymentMethod as keyof typeof detailedPaymentCurrencyCode], isActive: true },
        });
        if (!settlementCurrency) throw new Error('INVALID_SETTLEMENT_CURRENCY');
        settlementCurrencyId = settlementCurrency.id;
      } else if (settlementCurrencyId) {
        const settlementCurrency = await tx.currency.findFirst({
          where: { id: settlementCurrencyId, code: { in: ['USD', 'LYD'] }, isActive: true },
        });
        if (!settlementCurrency) throw new Error('INVALID_SETTLEMENT_CURRENCY');
        settlementPaymentMethod = settlementCurrency.code === 'USD' ? 'USD_CASH' : 'LYD_CASH';
      }

      const baseAmount = cardBaseAmount(valueUsd, agreedAmount);
      if (receivedAmount.gt(baseAmount)) throw new Error('WITHDRAWN_EXCEEDS_CARD_VALUE');
      const remainingAmount = baseAmount.sub(receivedAmount).gt(0) ? baseAmount.sub(receivedAmount) : D(0);
      const progressPercent = cardProgressPercent(baseAmount, receivedAmount);

      if (shouldSettle && (!settlementAmount || D(settlementAmount).lte(0) || !settlementCurrencyId || !settlementPaymentMethod)) {
        throw new Error('SETTLEMENT_REQUIRES_AMOUNT_METHOD_AND_CURRENCY');
      }

      let receivedCashboxMovementId = oldValue.receivedCashboxMovementId;
      let settlementCashboxMovementId = oldValue.settlementCashboxMovementId;

      if (oldValue.receivedCashboxMovementId) {
        const oldReceiptMovement = await tx.cashboxMovement.findUnique({
          where: { id: oldValue.receivedCashboxMovementId },
        });
        const receiptCurrencyId =
          oldReceiptMovement?.currencyId || settlementCurrencyId || oldValue.batch.currencyId || oldValue.settlementCurrencyId;
        if (!receiptCurrencyId) throw new Error('OLD_RECEIPT_CURRENCY_NOT_FOUND');

        const movement = await createCashboxMovement(tx, {
          currencyId: receiptCurrencyId,
          transactionId: oldReceiptMovement?.transactionId || null,
          direction: 'OUT',
          amount: oldReceiptMovement?.amount || oldValue.valueUsd,
          paymentMethod: oldReceiptMovement?.paymentMethod || null,
          reason: `عكس أثر استلام بطاقة سابق ${personName} #${oldValue.sequence}`.trim(),
          personId,
          sourceType: 'ReceivedCustomerCard',
          sourceId: id,
          note,
          reversedMovementId: oldValue.receivedCashboxMovementId,
        });
        negativeBalanceWarning ||= balanceWarning(movement.balanceAfter);
        receivedCashboxMovementId = null;
        receiptMovementReversed = true;
      }

      const oldSettlementAmount = oldValue.settlementAmount ? D(oldValue.settlementAmount) : D(0);
      const newSettlementAmount = settlementAmount ? D(settlementAmount) : D(0);
      const hasOldSettlementMovement = Boolean(
        oldValue.settlementCashboxMovementId && oldValue.settlementCurrencyId && oldValue.settlementAmount,
      );
      const settlementCashChanged =
        shouldSettle &&
        (!hasOldSettlementMovement ||
          oldValue.settlementCurrencyId !== settlementCurrencyId ||
          oldValue.settlementPaymentMethod !== settlementPaymentMethod ||
          !oldSettlementAmount.equals(newSettlementAmount));

      if (hasOldSettlementMovement && (!shouldSettle || settlementCashChanged)) {
        const movement = await createCashboxMovement(tx, {
          currencyId: oldValue.settlementCurrencyId as string,
          direction: 'IN',
          amount: oldValue.settlementAmount as any,
          paymentMethod: oldValue.settlementPaymentMethod,
          reason: `عكس تصفية بطاقة ${personName} #${oldValue.sequence}`.trim(),
          personId,
          sourceType: 'ReceivedCustomerCard',
          sourceId: id,
          note,
          reversedMovementId: oldValue.settlementCashboxMovementId,
        });
        negativeBalanceWarning ||= balanceWarning(movement.balanceAfter);
        settlementCashboxMovementId = null;
      }

      if (shouldSettle && settlementCashChanged && settlementCurrencyId && settlementAmount && settlementPaymentMethod) {
        const movement = await createCashboxMovement(tx, {
          currencyId: settlementCurrencyId,
          direction: 'OUT',
          amount: settlementAmount,
          paymentMethod: settlementPaymentMethod,
          reason: `تصفية بطاقة ${personName} #${oldValue.sequence} (${detailedPaymentLabels[settlementPaymentMethod as keyof typeof detailedPaymentLabels]})`.trim(),
          personId,
          sourceType: 'ReceivedCustomerCard',
          sourceId: id,
          note,
        });
        negativeBalanceWarning ||= balanceWarning(movement.balanceAfter);
        settlementCashboxMovementId = movement.id;
        settlementMovementCreated = true;
      }

      if (input.stageAction || input.currentStage !== undefined || stageAmount) {
        await tx.receivedCardStageLog.create({
          data: {
            cardId: id,
            stage: nextStage,
            direction: input.stageAction || 'SET',
            amount: stageAmount || D(0),
            note: input.stageNote || note,
            userId: session.userId,
            username: session.username,
          },
        });
      }

      if (statusChanged && willCancel) {
        await tx.receivedCardStageLog.create({
          data: {
            cardId: id,
            stage: oldStage,
            direction: 'REJECT',
            amount: D(0),
            note: rejectReason,
            userId: session.userId,
            username: session.username,
          },
        });
      }

      if (statusChanged && oldValue.status === 'CANCELLED' && !willCancel) {
        await tx.receivedCardStageLog.create({
          data: {
            cardId: id,
            stage: nextStage,
            direction: 'REACTIVATE',
            amount: D(0),
            note: input.stageNote || note || 'إعادة تنشيط البطاقة',
            userId: session.userId,
            username: session.username,
          },
        });
      }

      const imageChanged =
        input.cardImageDataUrl !== undefined ||
        input.cardThumbnailDataUrl !== undefined ||
        input.cardImageMimeType !== undefined ||
        input.cardImageSize !== undefined;

      return tx.receivedCustomerCard.update({
        where: { id },
        data: {
          bankName: input.bankName === undefined ? oldValue.bankName : input.bankName,
          cardLast4: input.cardLast4 === undefined ? oldValue.cardLast4 : input.cardLast4,
          valueUsd,
          agreedAmount,
          settlementAmount,
          settlementCurrencyId,
          settlementPaymentMethod: settlementPaymentMethod as any,
          receivedAmount,
          totalDeducted: receivedAmount,
          remainingAmount,
          progressPercent,
          status: status as any,
          currentStage: nextStage,
          rejectedAt: willCancel ? oldValue.rejectedAt || new Date() : oldValue.status === 'CANCELLED' ? null : oldValue.rejectedAt,
          rejectReason: willCancel ? rejectReason : oldValue.status === 'CANCELLED' ? null : oldValue.rejectReason,
          archivedAt: ['SETTLED', 'COMPLETED'].includes(status) ? oldValue.archivedAt || new Date() : null,
          receivedCashboxMovementId,
          settlementCashboxMovementId,
          verificationReceived:
            input.verificationReceived === undefined ? oldValue.verificationReceived : input.verificationReceived,
          secureInternalNote:
            input.secureInternalNote === undefined ? oldValue.secureInternalNote : input.secureInternalNote,
          notes: input.notes === undefined ? oldValue.notes : input.notes,
          cardImageDataUrl: input.cardImageDataUrl === undefined ? oldValue.cardImageDataUrl : input.cardImageDataUrl,
          cardThumbnailDataUrl:
            input.cardThumbnailDataUrl === undefined ? oldValue.cardThumbnailDataUrl : input.cardThumbnailDataUrl,
          cardImageMimeType: input.cardImageMimeType === undefined ? oldValue.cardImageMimeType : input.cardImageMimeType,
          cardImageSize: input.cardImageSize === undefined ? oldValue.cardImageSize : input.cardImageSize,
          cardImageUpdatedAt: imageChanged ? new Date() : oldValue.cardImageUpdatedAt,
        },
        include: {
          settlementCurrency: true,
          batch: { include: { person: true, currency: true } },
          operations: { where: { deletedAt: null }, orderBy: { occurredAt: 'desc' }, take: 12 },
          stageLogs: { orderBy: { createdAt: 'desc' }, take: 8 },
        },
      });
    });

    await audit('RECEIVED_CARD_UPDATE', {
      entityType: 'ReceivedCustomerCard',
      entityId: id,
      oldValue: oldSnapshot as any,
      newValue: updated as any,
      description: 'تعديل بطاقة مستلمة',
    });

    if (settlementMovementCreated) {
      await audit('RECEIVED_CARD_SETTLEMENT', {
        entityType: 'ReceivedCustomerCard',
        entityId: id,
        oldValue: oldSnapshot as any,
        newValue: updated as any,
        description: 'تصفية بطاقة مستلمة وتسجيل حركة صندوق',
      });
    }

    if (receiptMovementReversed) {
      await audit('RECEIVED_CARD_RECEIPT_CASHBOX_REVERSAL', {
        entityType: 'ReceivedCustomerCard',
        entityId: id,
        oldValue: oldSnapshot as any,
        newValue: updated as any,
        description: 'عكس أثر صندوق قديم لاستلام بطاقة',
      });
    }

    revalidateFinancePaths(updated.batch?.personId ? ['/people', `/people/${updated.batch.personId}`] : ['/people']);

    return ok({
      ...updated,
      cashboxWarning: negativeBalanceWarning ? 'الرصيد أصبح بالسالب بعد هذه العملية' : null,
    });
  } catch (error) {
    if ((error as Error).message === 'CARD_NOT_FOUND') return fail('البطاقة غير موجودة', 404);
    if ((error as Error).message === 'INVALID_SETTLEMENT_CURRENCY') {
      return fail('عملة التصفية يجب أن تكون دينار أو دولار');
    }
    if ((error as Error).message === 'INVALID_SETTLEMENT_METHOD') {
      return fail('اختر طريقة دفع صحيحة للتصفية');
    }
    if ((error as Error).message === 'SETTLEMENT_REQUIRES_AMOUNT_METHOD_AND_CURRENCY') {
      return fail('تصفية البطاقة تتطلب مبلغ التصفية وطريقة الدفع');
    }
    if ((error as Error).message === 'REJECT_REASON_REQUIRED') {
      return fail('اكتب سبب إيقاف أو رفض البطاقة');
    }
    if ((error as Error).message === 'WITHDRAWN_EXCEEDS_CARD_VALUE') {
      return fail('المبلغ المسحوب لا يمكن أن يكون أكبر من قيمة البطاقة');
    }
    if ((error as Error).message === 'OLD_RECEIPT_CURRENCY_NOT_FOUND') {
      return fail('تعذر عكس حركة الاستلام القديمة لأن عملتها غير معروفة');
    }
    return apiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const oldValue = await db.receivedCustomerCard.findUnique({
      where: { id },
      include: { batch: { include: { person: true } }, settlementCurrency: true },
    });
    if (!oldValue || oldValue.deletedAt) return fail('البطاقة غير موجودة', 404);

    const updated = await db.receivedCustomerCard.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'CANCELLED',
      },
      include: { batch: { include: { person: true } }, settlementCurrency: true },
    });

    await db.receivedCardStageLog.create({
      data: {
        cardId: id,
        stage: oldValue.currentStage || 0,
        direction: 'DELETE',
        amount: D(0),
        note: 'حذف منطقي للبطاقة',
        userId: session.userId,
        username: session.username,
      },
    });

    await audit('RECEIVED_CARD_ARCHIVE', {
      entityType: 'ReceivedCustomerCard',
      entityId: id,
      oldValue: oldValue as any,
      newValue: updated as any,
      description: 'حذف منطقي لبطاقة زبون',
    });
    revalidateFinancePaths(['/people', `/people/${updated.batch.personId}`]);

    return ok({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
