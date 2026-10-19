import { Prisma } from '@prisma/client';
import {
  cardBaseAmount,
  cardProgressPercent,
  cardStatusForBalance,
  isCardDeductionOperation,
} from './customer-cards';
import { D } from './money';
import { receivedCardResponseSelect } from './received-card-selects';
import { hasWithdrawalBoxes, withdrawalSlots, withdrawalBoxStatus } from './card-withdrawals';

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
      stageLogs: true,
    },
  });

  if (!card || card.deletedAt) throw new Error('CARD_NOT_FOUND');

  const baseAmount = cardBaseAmount(card.valueUsd, card.agreedAmount);
  const operations = [...card.operations].sort(compareOperations);
  let remaining = baseAmount;

  const hasStatusHistory = operations.some((o) => ['REJECT', 'REACTIVATE'].includes(o.operationType));
  let rejectedAt: Date | null = hasStatusHistory ? null : card.rejectedAt || null;
  let rejectReason: string | null = hasStatusHistory ? null : card.rejectReason || null;

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
  const fallback = ['PAYMENT_FAILED', 'INSUFFICIENT_BALANCE'].includes(card.status) ? card.status : null;
  const managed = hasWithdrawalBoxes(card);
  const slots = withdrawalSlots(card);
  const status = rejectedAt
    ? 'CANCELLED'
    : managed
      ? withdrawalBoxStatus(slots, card.status === 'CANCELLED' ? 'RECEIVED' : card.status)
      : cardStatusForBalance(baseAmount, totalDeducted, fallback);
  const currentStage = managed
    ? slots.filter(Boolean).length
    : status === 'SETTLED'
      ? 5
      : Math.min(card.currentStage, 4);

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
    select: receivedCardResponseSelect,
  });
}
