import { db } from '@/lib/db';
import { requireSession, audit } from '@/lib/auth';
import { ok, apiError, fail } from '@/lib/http';
import { createCashboxMovement } from '@/lib/cashbox';
import { z } from 'zod';

const manualMovementSchema = z.object({
  currencyId: z.string().min(1),
  direction: z.enum(['IN', 'OUT']),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(3),
  personId: z.string().optional().nullable(),
  note: z.string().trim().optional().nullable(),
  createdBy: z.string().trim().optional().nullable(),
});

export async function GET(request: Request) {
  try {
    await requireSession();

    const url = new URL(request.url);
    const currencyId = url.searchParams.get('currencyId') || undefined;

    const movements = await db.cashboxMovement.findMany({
      where: { currencyId },
      include: { currency: true, transaction: true, person: true },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    return ok(movements);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();

    const parsed = manualMovementSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات حركة الصندوق');

    const input = parsed.data;
    const movement = await db.$transaction((tx) =>
      createCashboxMovement(tx, {
        currencyId: input.currencyId,
        direction: input.direction,
        amount: input.amount,
        reason: input.reason,
        personId: input.personId || null,
        note: input.note || null,
        createdBy: input.createdBy || 'system',
        sourceType: 'ManualCashboxMovement',
      }),
    );

    await audit('CASHBOX_MANUAL', {
      entityType: 'CashboxMovement',
      entityId: movement.id,
      newValue: movement as any,
      description: input.reason,
    });

    return ok(movement, 201);
  } catch (error) {
    return apiError(error);
  }
}
