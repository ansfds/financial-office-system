import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { receivedCardResponseSelect } from '@/lib/received-card-selects';
import { hasWithdrawalBoxes, withdrawalSlots, withdrawalBoxStatus } from '@/lib/card-withdrawals';
import { z } from 'zod';
const schema = z.object({
  slot: z.number().int().min(1).max(5),
  checked: z.boolean(),
  updatedAt: z.string().datetime(),
});
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من رقم السحبة');
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "ReceivedCustomerCard" WHERE id = ${id} FOR UPDATE`;
      const card = await tx.receivedCustomerCard.findFirst({
        where: { id, deletedAt: null, batch: { person: { deletedAt: null, status: 'ACTIVE' } } },
        include: { stageLogs: true },
      });
      if (!card) throw new Error('CARD_NOT_FOUND');
      if (card.updatedAt.getTime() !== new Date(parsed.data.updatedAt).getTime())
        throw new Error('CARD_CHANGED');
      const slots = withdrawalSlots(card);
      slots[parsed.data.slot - 1] = parsed.data.checked;
      const stamp = new Date(
        Math.max(Date.now(), ...card.stageLogs.map((log) => log.createdAt.getTime() + 1)),
      );
      const initial = !hasWithdrawalBoxes(card);
      for (let index = 0; index < 5; index++) {
        if (!initial && index !== parsed.data.slot - 1) continue;
        await tx.receivedCardStageLog.create({
          data: {
            cardId: id,
            stage: index + 1,
            direction: slots[index] ? 'WITHDRAWAL_ON' : 'WITHDRAWAL_OFF',
            amount: 0,
            userId: session.userId,
            username: session.username,
            createdAt: stamp,
          },
        });
      }
      const status = withdrawalBoxStatus(slots, card.status);
      const updated = await tx.receivedCustomerCard.update({
        where: { id },
        data: {
          currentStage: slots.filter(Boolean).length,
          status: status as any,
          archivedAt: status === 'SETTLED' ? card.archivedAt || stamp : null,
        },
        select: receivedCardResponseSelect,
      });
      await tx.auditLog.create({
        data: {
          action: 'CARD_WITHDRAWAL_SET',
          entityType: 'ReceivedCustomerCard',
          entityId: id,
          userId: session.userId,
          username: session.username,
          oldValue: { slots: withdrawalSlots(card), status: card.status },
          newValue: { slots, status },
          description: 'تحديث مربع سحبة دون تعديل المبالغ المالية',
        },
      });
      return updated;
    });
    revalidateFinancePaths([`/cards/${result.batch.personId}`]);
    return ok(result);
  } catch (e) {
    if ((e as Error).message === 'CARD_NOT_FOUND') return fail('البطاقة غير موجودة', 404);
    if ((e as Error).message === 'CARD_CHANGED')
      return fail('تغيرت البطاقة في نافذة أخرى. تم طلب تحديثها؛ حاول مجددًا', 409);
    return apiError(e);
  }
}
