import { Prisma } from '@prisma/client';
import {
  cardBaseAmount,
  cardProgressPercent,
  cardRemainingAmount,
  cardStatusForBalance,
  isCardDeductionOperation,
} from './customer-cards';
import { D } from './money';

type OperationRow = {
  id: string;
  operationType: string;
  amount: unknown;
  balanceBefore: unknown;
  note?: string | null;
  reason?: string | null;
  occurredAt: Date;
  createdAt: Date;
  deletedAt?: Date | null;
};

export const receivedCardDetailsInclude = {
  settlementCurrency: true,
  operations: {
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: 30,
  },
  batch: { include: { person: true, currency: true } },
  stageLogs: { orderBy: { createdAt: 'desc' }, take: 8 },
} satisfies Prisma.ReceivedCustomerCardInclude;

function compareOperations(left: OperationRow, right: OperationRow) {
  const occurred = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
  if (occurred !== 0) return occurred;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function decimalEqual(left: unknown, right: unknown) {
  return D(left || 0).equals(D(right || 0));
}

export async function recalculateReceivedCard(tx: Prisma.TransactionClient, cardId: string) {
  const card = await tx.receivedCustomerCard.findUnique({
    where: { id: cardId },
    include: {
      operations: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] },
    },
  });

  if (!card || card.deletedAt) throw new Error('CARD_NOT_FOUND');

  const baseAmount = cardBaseAmount(card.valueUsd, card.agreedAmount);
  const operations = [...card.operations].sort(compareOperations);
  const firstOperation = operations[0];
  let remaining = firstOperation
    ? D(firstOperation.balanceBefore)
    : cardRemainingAmount(card.valueUsd, card.agreedAmount, card.receivedAmount);

  if (remaining.gt(baseAmount)) remaining = baseAmount;
  if (remaining.lt(0)) remaining = D(0);

  let rejectedAt: Date | null = card.rejectedAt || null;
  let rejectReason: string | null = card.rejectReason || null;

  for (const operation of operations) {
    if (operation.deletedAt) continue;

    const balanceBefore = remaining;
    const progressBefore = cardProgressPercent(baseAmount, baseAmount.sub(balanceBefore));
    const amount = isCardDeductionOperation(operation.operationType) ? D(operation.amount || 0) : D(0);

    if (isCardDeductionOperation(operation.operationType)) {
      if (amount.lte(0)) throw new Error('INVALID_OPERATION_AMOUNT');
      remaining = remaining.sub(amount);
      if (remaining.lt(0)) throw new Error('CARD_OPERATION_OVER_REMAINING');
    }

    if (operation.operationType === 'REJECT') {
      rejectedAt = operation.occurredAt || operation.createdAt;
      rejectReason = operation.reason || operation.note || 'رفض البطاقة';
    }

    if (operation.operationType === 'REACTIVATE') {
      rejectedAt = null;
      rejectReason = null;
    }

    const progressAfter = cardProgressPercent(baseAmount, baseAmount.sub(remaining));
    if (
      !decimalEqual(operation.balanceBefore, balanceBefore) ||
      !decimalEqual(operation.balanceAfter, remaining) ||
      !decimalEqual(operation.progressBefore, progressBefore) ||
      !decimalEqual(operation.progressAfter, progressAfter)
    ) {
      await tx.receivedCardOperation.update({
        where: { id: operation.id },
        data: {
          balanceBefore,
          balanceAfter: remaining,
          progressBefore,
          progressAfter,
        },
      });
    }
  }

  const totalDeducted = baseAmount.sub(remaining);
  const progressPercent = cardProgressPercent(baseAmount, totalDeducted);
  const status = rejectedAt ? 'CANCELLED' : cardStatusForBalance(baseAmount, totalDeducted, null);
  const currentStage = status === 'SETTLED' && (card.currentStage || 0) < 5 ? 5 : card.currentStage;

  await tx.receivedCustomerCard.update({
    where: { id: cardId },
    data: {
      receivedAmount: totalDeducted,
      totalDeducted,
      remainingAmount: remaining,
      progressPercent,
      status: status as any,
      currentStage,
      rejectedAt,
      rejectReason,
      archivedAt: status === 'SETTLED' ? card.archivedAt || new Date() : null,
    },
  });

  return tx.receivedCustomerCard.findUniqueOrThrow({
    where: { id: cardId },
    include: receivedCardDetailsInclude,
  });
}
