import { db } from '@/lib/db';
import { requireSession, audit } from '@/lib/auth';
import { ok, apiError, fail } from '@/lib/http';
import { createCashboxMovement } from '@/lib/cashbox';
import { summarizeCashboxByMethod } from '@/lib/cashbox-summary';
import { paymentMethodForCurrency, simplePaymentMethods } from '@/lib/payment-methods';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const manualMovementSchema = z.object({
  currencyId: z.string().min(1),
  direction: z.enum(['IN', 'OUT']),
  amount: z.coerce.number().positive(),
  movementMethod: z.enum(simplePaymentMethods).default('CASH'),
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
      include: {
        currency: true,
        transaction: { select: { operationKind: true, operationDetails: true, sheinPaymentMethod: true } },
        person: true,
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    const summaryMovements = await db.cashboxMovement.findMany({
      where: { currencyId },
      include: {
        currency: true,
        transaction: { select: { operationKind: true, operationDetails: true, sheinPaymentMethod: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });

    return ok({
      movements,
      summaries: summarizeCashboxByMethod(summaryMovements),
    });
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
    const movement = await db.$transaction(async (tx) => {
      const currency = await tx.currency.findFirst({ where: { id: input.currencyId, isActive: true } });
      if (!currency) throw new Error('INVALID_CURRENCY');

      return createCashboxMovement(tx, {
        currencyId: input.currencyId,
        direction: input.direction,
        amount: input.amount,
        paymentMethod: paymentMethodForCurrency(currency.code, input.movementMethod),
        reason: input.reason,
        personId: input.personId || null,
        note: input.note || null,
        createdBy: input.createdBy || 'system',
        sourceType: 'ManualCashboxMovement',
      });
    });

    await audit('CASHBOX_MANUAL', {
      entityType: 'CashboxMovement',
      entityId: movement.id,
      newValue: movement as any,
      description: input.reason,
    });
    revalidateFinancePaths();

    return ok(movement, 201);
  } catch (error) {
    if ((error as Error).message === 'INVALID_CURRENCY') return fail('اختر عملة نشطة وصحيحة');
    return apiError(error);
  }
}
