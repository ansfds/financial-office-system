import { audit, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const deliverySchema = z.object({
  currencyId: z.string().min(1),
  paymentMethod: z.string().trim().optional().nullable(),
  amount: z.coerce.number().positive(),
  note: z.string().trim().optional().nullable(),
  occurredAt: z.string().optional().nullable(),
});

async function deliveryBalance(tx: typeof db, personId: string, currencyId: string) {
  const [cards, deliveries] = await Promise.all([
    tx.receivedCustomerCard.findMany({
      where: {
        deletedAt: null,
        status: { not: 'CANCELLED' },
        batch: { personId },
      },
      include: { batch: true },
    }),
    tx.customerCardDelivery.findMany({
      where: { personId, currencyId, deletedAt: null },
    }),
  ]);

  const totalAgreed = cards.reduce((sum, card) => {
    const cardCurrencyId = card.settlementCurrencyId || card.batch.currencyId;
    if (cardCurrencyId !== currencyId) return sum;
    return sum.add(card.agreedAmount);
  }, D(0));
  const delivered = deliveries.reduce((sum, delivery) => sum.add(delivery.amount), D(0));

  return {
    totalAgreed,
    delivered,
    remaining: totalAgreed.sub(delivered),
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const parsed = deliverySchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات تسليم المبلغ');

    const input = parsed.data;
    let created: any = null;

    await db.$transaction(async (tx) => {
      const [person, currency] = await Promise.all([
        tx.person.findFirst({ where: { id, deletedAt: null, status: 'ACTIVE' } }),
        tx.currency.findFirst({ where: { id: input.currencyId, isActive: true } }),
      ]);
      if (!person) throw new Error('PERSON_NOT_FOUND');
      if (!currency) throw new Error('INVALID_CURRENCY');

      const balance = await deliveryBalance(tx as any, id, currency.id);
      const amount = D(input.amount);
      const balanceAfter = balance.remaining.sub(amount);
      if (balanceAfter.lt(0)) throw new Error('DELIVERY_OVER_REMAINING');

      created = await tx.customerCardDelivery.create({
        data: {
          personId: id,
          currencyId: currency.id,
          paymentMethod: input.paymentMethod || null,
          amount,
          balanceBefore: balance.remaining,
          balanceAfter,
          reason: 'CUSTOMER_CARD_DELIVERY',
          note: input.note || null,
          userId: session.userId,
          username: session.username,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        },
        include: { person: true, currency: true },
      });
    });

    await audit('CUSTOMER_CARD_DELIVERY_CREATE', {
      entityType: 'CustomerCardDelivery',
      entityId: created.id,
      newValue: created as any,
      description: 'تسجيل تسليم مبلغ للزبون مستقل عن رصيد البطاقة',
    });
    revalidateFinancePaths(['/people', `/people/${id}`]);

    return ok(created, 201);
  } catch (error) {
    if ((error as Error).message === 'PERSON_NOT_FOUND') return fail('الزبون غير موجود', 404);
    if ((error as Error).message === 'INVALID_CURRENCY') return fail('اختر عملة صحيحة');
    if ((error as Error).message === 'DELIVERY_OVER_REMAINING') {
      return fail('لا يمكن تسجيل تسليم أكبر من المتبقي على الزبون');
    }
    return apiError(error);
  }
}
