import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { D, statusOf } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const updateTransactionSchema = z.object({
  receivedAmount: z.coerce.number().min(0).optional(),
  paidAmount: z.coerce.number().min(0).optional(),
  bankName: z.string().trim().optional().nullable(),
  executionType: z.string().trim().optional().nullable(),
  verificationReceived: z.coerce.boolean().optional(),
  secureInternalNote: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

function absDecimal(value: Prisma.Decimal) {
  return value.lt(0) ? value.mul(-1) : value;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();

    const { id } = await params;
    const parsed = updateTransactionSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات تعديل الدفعة');

    const payload = parsed.data;

    const result = await db.$transaction(async (tx) => {
      const oldValue = await tx.financialTransaction.findUniqueOrThrow({ where: { id } });
      const receivedAmount =
        payload.receivedAmount === undefined ? oldValue.receivedAmount : D(payload.receivedAmount);
      const paidAmount = payload.paidAmount === undefined ? oldValue.paidAmount : D(payload.paidAmount);

      const deltaReceived = receivedAmount.sub(oldValue.receivedAmount);
      const deltaPaid = paidAmount.sub(oldValue.paidAmount);

      const adjustmentMovements = [
        {
          delta: deltaReceived,
          direction: deltaReceived.gte(0) ? ('IN' as const) : ('OUT' as const),
          reason: 'تعديل المبلغ المستلم',
        },
        {
          delta: deltaPaid,
          direction: deltaPaid.gte(0) ? ('OUT' as const) : ('IN' as const),
          reason: 'تعديل المبلغ المدفوع',
        },
      ];

      for (const movement of adjustmentMovements) {
        if (movement.delta.eq(0)) continue;

        const amount = absDecimal(movement.delta);
        const last = await tx.cashboxMovement.findFirst({
          where: { currencyId: oldValue.currencyId },
          orderBy: { occurredAt: 'desc' },
        });
        const balanceBefore = last?.balanceAfter || D(0);
        const balanceAfter =
          movement.direction === 'IN' ? balanceBefore.add(amount) : balanceBefore.sub(amount);

        await tx.transactionMovement.create({
          data: {
            transactionId: id,
            type: movement.direction === 'IN' ? 'CASH_IN' : 'CASH_OUT',
            direction: movement.direction,
            amount,
            currencyId: oldValue.currencyId,
            notes: movement.reason,
            balanceBefore,
            balanceAfter,
          },
        });

        await tx.cashboxMovement.create({
          data: {
            currencyId: oldValue.currencyId,
            transactionId: id,
            direction: movement.direction,
            amount,
            reason: movement.reason,
            balanceBefore,
            balanceAfter,
          },
        });
      }

      const updated = await tx.financialTransaction.update({
        where: { id },
        data: {
          receivedAmount,
          paidAmount,
          bankName: payload.bankName === undefined ? oldValue.bankName : payload.bankName,
          executionType: payload.executionType === undefined ? oldValue.executionType : payload.executionType,
          verificationReceived:
            payload.verificationReceived === undefined
              ? oldValue.verificationReceived
              : payload.verificationReceived,
          secureInternalNote:
            payload.secureInternalNote === undefined
              ? oldValue.secureInternalNote
              : payload.secureInternalNote,
          notes: payload.notes === undefined ? oldValue.notes : payload.notes,
          status: statusOf(
            oldValue.agreedAmount,
            receivedAmount,
            paidAmount,
            oldValue.receivableAmount,
            oldValue.payableAmount,
            oldValue.dueAt,
          ) as any,
        },
        include: { person: true, currency: true, type: true },
      });

      return { oldValue, updated };
    });

    await audit('TRANSACTION_UPDATE', {
      entityType: 'FinancialTransaction',
      entityId: id,
      oldValue: result.oldValue as any,
      newValue: result.updated as any,
      description: 'تعديل دفعة معاملة',
    });
    revalidateFinancePaths(result.updated.personId ? [`/people/${result.updated.personId}`] : []);

    return ok(result.updated);
  } catch (error) {
    return apiError(error);
  }
}
