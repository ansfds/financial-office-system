import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { balanceWarning, createCashboxMovement } from '@/lib/cashbox';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { z } from 'zod';

const updateReceivedCardSchema = z.object({
  bankName: z.string().trim().optional().nullable(),
  cardLast4: z
    .string()
    .trim()
    .regex(/^\d{0,4}$/, 'آخر 4 أرقام فقط')
    .optional()
    .nullable(),
  valueUsd: z.coerce.number().min(0).optional(),
  settlementAmount: z.coerce.number().positive().optional(),
  settlementCurrencyId: z.string().optional().nullable(),
  agreedAmount: z.coerce.number().positive().optional(),
  receivedAmount: z.coerce.number().min(0).optional(),
  verificationReceived: z.coerce.boolean().optional(),
  secureInternalNote: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  status: z.enum(['RECEIVED', 'IN_SETTLEMENT', 'SETTLED', 'PARTIAL', 'COMPLETED', 'CANCELLED']).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();

    const { id } = await params;
    const parsed = updateReceivedCardSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات البطاقة المستلمة');

    const input = parsed.data;
    let negativeBalanceWarning = false;
    let oldSnapshot: any = null;

    const updated = await db.$transaction(async (tx) => {
      const oldValue = await tx.receivedCustomerCard.findUnique({
        where: { id },
        include: { batch: { include: { person: true, currency: true } }, settlementCurrency: true },
      });
      if (!oldValue) throw new Error('CARD_NOT_FOUND');
      oldSnapshot = oldValue;

      const usd = await tx.currency.findUnique({ where: { code: 'USD' } });
      if (!usd) throw new Error('USD_CURRENCY_REQUIRED');

      const valueUsd = input.valueUsd === undefined ? oldValue.valueUsd : D(input.valueUsd);
      const settlementAmount = input.settlementAmount === undefined
        ? oldValue.settlementAmount || oldValue.agreedAmount
        : D(input.settlementAmount);
      const agreedAmount = input.agreedAmount === undefined ? settlementAmount : D(input.agreedAmount);
      const settlementCurrencyId =
        input.settlementCurrencyId === undefined ? oldValue.settlementCurrencyId : input.settlementCurrencyId || null;
      const status = input.status || oldValue.status;
      const receivedAmount =
        input.receivedAmount === undefined ? oldValue.receivedAmount : D(input.receivedAmount);

      if (settlementCurrencyId) {
        const settlementCurrency = await tx.currency.findFirst({
          where: { id: settlementCurrencyId, code: { in: ['USD', 'LYD'] }, isActive: true },
        });
        if (!settlementCurrency) throw new Error('INVALID_SETTLEMENT_CURRENCY');
      }

      if (status === 'SETTLED' && (!settlementCurrencyId || !settlementAmount || D(settlementAmount).lte(0))) {
        throw new Error('SETTLEMENT_REQUIRES_AMOUNT_AND_CURRENCY');
      }

      let receivedCashboxMovementId = oldValue.receivedCashboxMovementId;
      let settlementCashboxMovementId = oldValue.settlementCashboxMovementId;
      const personId = oldValue.batch.personId;
      const personName = oldValue.batch.person?.fullName || '';
      const note = input.notes === undefined ? oldValue.notes : input.notes;

      const receivedValueChanged =
        oldValue.status !== 'CANCELLED' &&
        status !== 'CANCELLED' &&
        (!oldValue.receivedCashboxMovementId || !D(oldValue.valueUsd || 0).equals(valueUsd));

      if (
        oldValue.receivedCashboxMovementId &&
        oldValue.valueUsd.gt(0) &&
        (status === 'CANCELLED' || receivedValueChanged)
      ) {
        const movement = await createCashboxMovement(tx, {
          currencyId: usd.id,
          direction: 'OUT',
          amount: oldValue.valueUsd,
          reason: `عكس استلام بطاقة ${personName} #${oldValue.sequence}`.trim(),
          personId,
          sourceType: 'ReceivedCustomerCard',
          sourceId: id,
          note,
          reversedMovementId: oldValue.receivedCashboxMovementId,
        });
        negativeBalanceWarning ||= balanceWarning(movement.balanceAfter);
        receivedCashboxMovementId = null;
      }

      if (status !== 'CANCELLED' && valueUsd.gt(0) && receivedValueChanged) {
        const movement = await createCashboxMovement(tx, {
          currencyId: usd.id,
          direction: 'IN',
          amount: valueUsd,
          reason: `استلام بطاقة ${personName} #${oldValue.sequence}`.trim(),
          personId,
          sourceType: 'ReceivedCustomerCard',
          sourceId: id,
          note,
        });
        receivedCashboxMovementId = movement.id;
      }

      const settlementChanged =
        status === 'SETTLED' &&
        (oldValue.status !== 'SETTLED' ||
          oldValue.settlementCurrencyId !== settlementCurrencyId ||
          !D(oldValue.settlementAmount || 0).equals(D(settlementAmount || 0)));

      if (
        oldValue.status === 'SETTLED' &&
        oldValue.settlementCashboxMovementId &&
        oldValue.settlementAmount &&
        oldValue.settlementCurrencyId &&
        (status !== 'SETTLED' || settlementChanged)
      ) {
        const movement = await createCashboxMovement(tx, {
          currencyId: oldValue.settlementCurrencyId,
          direction: 'IN',
          amount: oldValue.settlementAmount,
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

      if (status === 'SETTLED' && settlementChanged && settlementCurrencyId && settlementAmount) {
        const movement = await createCashboxMovement(tx, {
          currencyId: settlementCurrencyId,
          direction: 'OUT',
          amount: settlementAmount,
          reason: `تصفية بطاقة ${personName} #${oldValue.sequence}`.trim(),
          personId,
          sourceType: 'ReceivedCustomerCard',
          sourceId: id,
          note,
        });
        negativeBalanceWarning ||= balanceWarning(movement.balanceAfter);
        settlementCashboxMovementId = movement.id;
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
          receivedAmount,
          status: status as any,
          receivedCashboxMovementId,
          settlementCashboxMovementId,
          verificationReceived:
            input.verificationReceived === undefined
              ? oldValue.verificationReceived
              : input.verificationReceived,
          secureInternalNote:
            input.secureInternalNote === undefined
              ? oldValue.secureInternalNote
              : input.secureInternalNote,
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

    return ok({ ...updated, cashboxWarning: negativeBalanceWarning ? 'الرصيد أصبح بالسالب بعد هذه العملية' : null });
  } catch (error) {
    if ((error as Error).message === 'CARD_NOT_FOUND') return fail('البطاقة غير موجودة', 404);
    if ((error as Error).message === 'USD_CURRENCY_REQUIRED') return fail('عملة الدولار غير مضافة في الإعدادات');
    if ((error as Error).message === 'INVALID_SETTLEMENT_CURRENCY') {
      return fail('عملة التصفية يجب أن تكون دينار أو دولار');
    }
    if ((error as Error).message === 'SETTLEMENT_REQUIRES_AMOUNT_AND_CURRENCY') {
      return fail('تصفية البطاقة تتطلب مبلغ التصفية وعملة التصفية');
    }
    return apiError(error);
  }
}
