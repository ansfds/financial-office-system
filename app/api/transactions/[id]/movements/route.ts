import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { createCashboxMovement } from '@/lib/cashbox';
import { apiError, fail, ok } from '@/lib/http';
import { D, statusOf } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const movementSchema = z.object({
  type: z.enum([
    'CASH_IN',
    'CASH_OUT',
    'RECEIVABLE',
    'PAYABLE',
    'SETTLE_RECEIVABLE',
    'SETTLE_PAYABLE',
    'NO_CASH_EFFECT',
    'REVERSAL',
    'CANCELLATION',
  ]),
  amount: z.coerce.number().positive(),
  currencyId: z.string(),
  occurredAt: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();

    const { id } = await params;
    const parsed = movementSchema.safeParse(await request.json());
    if (!parsed.success) return fail('بيانات الحركة غير صحيحة');

    const input = parsed.data;
    const amount = D(input.amount);
    const result = await db.$transaction(async (tx) => {
      const transaction = await tx.financialTransaction.findUniqueOrThrow({ where: { id } });
      let receivedAmount = transaction.receivedAmount;
      let paidAmount = transaction.paidAmount;
      let receivableAmount = transaction.receivableAmount;
      let payableAmount = transaction.payableAmount;
      let direction: 'IN' | 'OUT' | 'NONE' = 'NONE';

      if (input.type === 'CASH_IN') {
        receivedAmount = receivedAmount.add(amount);
        direction = 'IN';
      }
      if (input.type === 'CASH_OUT') {
        paidAmount = paidAmount.add(amount);
        direction = 'OUT';
      }
      if (input.type === 'RECEIVABLE') receivableAmount = receivableAmount.add(amount);
      if (input.type === 'PAYABLE') payableAmount = payableAmount.add(amount);
      if (input.type === 'SETTLE_RECEIVABLE') {
        receivableAmount = Prisma.Decimal.max(D(0), receivableAmount.sub(amount));
        receivedAmount = receivedAmount.add(amount);
        direction = 'IN';
      }
      if (input.type === 'SETTLE_PAYABLE') {
        payableAmount = Prisma.Decimal.max(D(0), payableAmount.sub(amount));
        paidAmount = paidAmount.add(amount);
        direction = 'OUT';
      }

      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      const last = await tx.cashboxMovement.findFirst({
        where: { currencyId: input.currencyId },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      });
      const balanceBefore = last?.balanceAfter || D(0);
      const balanceAfter = direction === 'IN' ? balanceBefore.add(amount) : direction === 'OUT' ? balanceBefore.sub(amount) : balanceBefore;

      const movement = await tx.transactionMovement.create({
        data: {
          transactionId: id,
          type: input.type,
          direction,
          amount,
          currencyId: input.currencyId,
          occurredAt,
          notes: input.notes,
          balanceBefore,
          balanceAfter,
        },
      });

      if (direction !== 'NONE') {
        await createCashboxMovement(tx, {
          currencyId: input.currencyId,
          transactionId: id,
          personId: transaction.personId,
          direction,
          amount,
          reason: input.notes || input.type,
          sourceType: 'TransactionMovement',
          sourceId: movement.id,
          occurredAt,
        });
      }

      await tx.financialTransaction.update({
        where: { id },
        data: {
          receivedAmount,
          paidAmount,
          receivableAmount,
          payableAmount,
          status: statusOf(transaction.agreedAmount, receivedAmount, paidAmount, receivableAmount, payableAmount, transaction.dueAt) as any,
        },
      });

      return { movement, personId: transaction.personId };
    });

    await audit('MOVEMENT_CREATE', {
      entityType: 'TransactionMovement',
      entityId: result.movement.id,
      description: 'إضافة حركة مالية',
    });
    revalidateFinancePaths(result.personId ? [`/people/${result.personId}`] : []);

    return ok(result.movement, 201);
  } catch (error) {
    return apiError(error);
  }
}
