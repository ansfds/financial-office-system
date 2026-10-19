import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { receivedCardResponseSelect } from '@/lib/received-card-selects';
import { cardStatusForBalance } from '@/lib/customer-cards';
import { hasWithdrawalBoxes, withdrawalSlots, withdrawalBoxStatus } from '@/lib/card-withdrawals';
import { z } from 'zod';
const schema = z.object({
  status: z.enum(['RECEIVED', 'PAYMENT_FAILED', 'INSUFFICIENT_BALANCE', 'CANCELLED']),
});
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('اختر حالة صحيحة');
    const card = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "ReceivedCustomerCard" WHERE id = ${id} FOR UPDATE`;
      const old = await tx.receivedCustomerCard.findFirst({
        where: { id, deletedAt: null, batch: { person: { deletedAt: null, status: 'ACTIVE' } } },
        include: { stageLogs: true },
      });
      if (!old) return null;
      const status =
        parsed.data.status === 'RECEIVED'
          ? hasWithdrawalBoxes(old)
            ? withdrawalBoxStatus(withdrawalSlots(old), 'RECEIVED')
            : cardStatusForBalance(old.valueUsd, old.totalDeducted)
          : parsed.data.status;
      if (old.status === 'CANCELLED' && status !== 'CANCELLED')
        await tx.receivedCardOperation.create({
          data: {
            cardId: id,
            operationType: 'REACTIVATE',
            amount: 0,
            balanceBefore: old.remainingAmount,
            balanceAfter: old.remainingAmount,
            userId: session.userId,
            username: session.username,
          },
        });
      if (status === 'CANCELLED')
        await tx.receivedCardOperation.create({
          data: {
            cardId: id,
            operationType: 'REJECT',
            amount: 0,
            balanceBefore: old.remainingAmount,
            balanceAfter: old.remainingAmount,
            reason: 'إلغاء يدوي',
            userId: session.userId,
            username: session.username,
          },
        });
      const updated = await tx.receivedCustomerCard.update({
        where: { id },
        data: {
          status: status as any,
          archivedAt: ['SETTLED', 'COMPLETED'].includes(status) ? old.archivedAt || new Date() : null,
          rejectedAt: status === 'CANCELLED' ? new Date() : null,
          rejectReason: status === 'CANCELLED' ? 'إلغاء يدوي' : null,
        },
        select: receivedCardResponseSelect,
      });
      await tx.auditLog.create({
        data: {
          action: 'CARD_STATUS_UPDATE',
          entityType: 'ReceivedCustomerCard',
          entityId: id,
          userId: session.userId,
          username: session.username,
          oldValue: { status: old.status },
          newValue: { status },
        },
      });
      return updated;
    });
    if (!card) return fail('البطاقة غير موجودة', 404);
    revalidateFinancePaths([`/people/${card.batch.personId}`]);
    return ok(card);
  } catch (e) {
    return apiError(e);
  }
}
