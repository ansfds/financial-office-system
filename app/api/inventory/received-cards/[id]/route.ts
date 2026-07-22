import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { balanceWarning, createCashboxMovement } from '@/lib/cashbox';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const settlementMethods = ['USD_CASH', 'USD_TRANSFER', 'LYD_CASH', 'LYD_TRANSFER'] as const;
const settlementStatuses = new Set(['PARTIAL', 'SETTLED', 'COMPLETED']);

const methodLabels: Record<(typeof settlementMethods)[number], string> = {
  USD_CASH: 'دولار كاش',
  USD_TRANSFER: 'دولار حوالة',
  LYD_CASH: 'دينار كاش',
  LYD_TRANSFER: 'دينار حوالة',
};

const methodCurrencyCode: Record<(typeof settlementMethods)[number], 'USD' | 'LYD'> = {
  USD_CASH: 'USD',
  USD_TRANSFER: 'USD',
  LYD_CASH: 'LYD',
  LYD_TRANSFER: 'LYD',
};

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
  status: z.enum(['RECEIVED', 'IN_SETTLEMENT', 'SETTLED', 'PARTIAL', 'COMPLETED', 'CANCELLED']).optional(),
});

function cardBaseAmount(valueUsd: any, agreedAmount: any) {
  const value = D(valueUsd || 0);
  return value.gt(0) ? value : D(agreedAmount || 0);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();

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
        include: { batch: { include: { person: true, currency: true } }, settlementCurrency: true },
      });
      if (!oldValue) throw new Error('CARD_NOT_FOUND');
      oldSnapshot = oldValue;

      const valueUsd = input.valueUsd === undefined ? oldValue.valueUsd : D(input.valueUsd);
      const agreedAmount = input.agreedAmount === undefined ? oldValue.agreedAmount : D(input.agreedAmount);
      const receivedAmount = input.receivedAmount === undefined ? oldValue.receivedAmount : D(input.receivedAmount);
      const status = input.status || oldValue.status;
      const shouldSettle = settlementStatuses.has(status);
      const note = input.notes === undefined ? oldValue.notes : input.notes;
      const personId = oldValue.batch.personId;
      const personName = oldValue.batch.person?.fullName || '';

      let settlementAmount =
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
          where: { code: methodCurrencyCode[settlementPaymentMethod as (typeof settlementMethods)[number]], isActive: true },
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
          reason: `تصفية بطاقة ${personName} #${oldValue.sequence} (${methodLabels[settlementPaymentMethod as (typeof settlementMethods)[number]]})`.trim(),
          personId,
          sourceType: 'ReceivedCustomerCard',
          sourceId: id,
          note,
        });
        negativeBalanceWarning ||= balanceWarning(movement.balanceAfter);
        settlementCashboxMovementId = movement.id;
        settlementMovementCreated = true;
      }

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
          status: status as any,
          receivedCashboxMovementId,
          settlementCashboxMovementId,
          verificationReceived:
            input.verificationReceived === undefined ? oldValue.verificationReceived : input.verificationReceived,
          secureInternalNote:
            input.secureInternalNote === undefined ? oldValue.secureInternalNote : input.secureInternalNote,
          notes: input.notes === undefined ? oldValue.notes : input.notes,
        },
        include: {
          settlementCurrency: true,
          batch: { include: { person: true, currency: true } },
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

    revalidateFinancePaths(updated.batch?.personId ? [`/people/${updated.batch.personId}`] : []);

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
      return fail('طريقة الدفع يجب أن تكون دولار كاش أو دولار حوالة أو دينار كاش أو دينار حوالة');
    }
    if ((error as Error).message === 'SETTLEMENT_REQUIRES_AMOUNT_METHOD_AND_CURRENCY') {
      return fail('تصفية البطاقة تتطلب مبلغ التصفية وطريقة الدفع');
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
