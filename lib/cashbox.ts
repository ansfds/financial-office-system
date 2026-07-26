import { Prisma } from '@prisma/client';
import { D } from './money';

type CashboxTx = Prisma.TransactionClient;

export async function createCashboxMovement(
  tx: CashboxTx,
  input: {
    currencyId: string;
    direction: 'IN' | 'OUT';
    amount: Prisma.Decimal | number | string;
    paymentMethod?: string | null;
    reason: string;
    transactionId?: string | null;
    personId?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    note?: string | null;
    createdBy?: string | null;
    occurredAt?: Date;
    reversedMovementId?: string | null;
  },
) {
  const amount = D(input.amount);

  const last = await tx.cashboxMovement.findFirst({
    where: { currencyId: input.currencyId },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
  });
  const balanceBefore = last?.balanceAfter || D(0);
  const balanceAfter = input.direction === 'IN' ? balanceBefore.add(amount) : balanceBefore.sub(amount);

  return tx.cashboxMovement.create({
    data: {
      currencyId: input.currencyId,
      transactionId: input.transactionId || null,
      personId: input.personId || null,
      direction: input.direction,
      amount,
      paymentMethod: input.paymentMethod || null,
      reason: input.reason,
      sourceType: input.sourceType || null,
      sourceId: input.sourceId || null,
      note: input.note || null,
      occurredAt: input.occurredAt || new Date(),
      balanceBefore,
      balanceAfter,
      createdBy: input.createdBy || 'system',
      reversedMovementId: input.reversedMovementId || null,
    },
  });
}

export function balanceWarning(balanceAfter: Prisma.Decimal | number | string) {
  return D(balanceAfter).lt(0);
}
