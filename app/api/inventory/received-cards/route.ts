import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { createCashboxMovement } from '@/lib/cashbox';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { z } from 'zod';

const cardInputSchema = z.object({
  bankName: z.string().trim().optional(),
  cardLast4: z
    .string()
    .trim()
    .regex(/^\d{0,4}$/, 'آخر 4 أرقام فقط')
    .optional(),
  valueUsd: z.coerce.number().min(0).optional(),
  settlementAmount: z.coerce.number().positive().optional(),
  settlementCurrencyId: z.string().optional().nullable(),
  agreedAmount: z.coerce.number().positive().optional(),
  receivedAmount: z.coerce.number().min(0).default(0),
  verificationReceived: z.coerce.boolean().default(false),
  secureInternalNote: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const createBatchSchema = z.object({
  personId: z.string().min(1),
  currencyId: z.string().optional().nullable(),
  receivedAt: z.string().optional(),
  cardCount: z.coerce.number().int().min(1).max(200),
  valueUsdPerCard: z.coerce.number().min(0).default(0),
  agreedAmountPerCard: z.coerce.number().positive(),
  commonBankName: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  cards: z.array(cardInputSchema).optional(),
});

export async function GET() {
  try {
    await requireSession();

    const batches = await db.receivedCardBatch.findMany({
      include: {
        person: true,
        currency: true,
        cards: { include: { settlementCurrency: true }, orderBy: { sequence: 'asc' } },
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });

    return ok(batches);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();

    const parsed = createBatchSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات البطاقات المستلمة');

    const input = parsed.data;
    const batch = await db.$transaction(async (tx) => {
      const usd = await tx.currency.findUnique({ where: { code: 'USD' } });
      if (!usd) throw new Error('USD_CURRENCY_REQUIRED');

      if (input.currencyId) {
        const settlementCurrency = await tx.currency.findFirst({
          where: { id: input.currencyId, code: { in: ['USD', 'LYD'] }, isActive: true },
        });
        if (!settlementCurrency) throw new Error('INVALID_SETTLEMENT_CURRENCY');
      }

      const person = await tx.person.findUnique({ where: { id: input.personId } });
      const created = await tx.receivedCardBatch.create({
        data: {
          personId: input.personId,
          currencyId: input.currencyId || null,
          receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
          cardCount: input.cardCount,
          agreedAmountPerCard: D(input.agreedAmountPerCard),
          notes: input.notes,
        },
      });

      for (let index = 1; index <= input.cardCount; index += 1) {
        const source = input.cards?.[index - 1];
        const settlementAmount = D(source?.settlementAmount || source?.agreedAmount || input.agreedAmountPerCard);
        const valueUsd = D(source?.valueUsd ?? input.valueUsdPerCard);
        const settlementCurrencyId = source?.settlementCurrencyId || input.currencyId || null;

        const card = await tx.receivedCustomerCard.create({
          data: {
            batchId: created.id,
            sequence: index,
            bankName: source?.bankName || input.commonBankName,
            cardLast4: source?.cardLast4,
            valueUsd,
            agreedAmount: settlementAmount,
            settlementAmount,
            settlementCurrencyId,
            receivedAmount: D(source?.receivedAmount || 0),
            status: 'RECEIVED',
            verificationReceived: source?.verificationReceived || false,
            secureInternalNote: source?.secureInternalNote,
            notes: source?.notes,
          },
        });

        if (valueUsd.gt(0)) {
          const movement = await createCashboxMovement(tx, {
            currencyId: usd.id,
            direction: 'IN',
            amount: valueUsd,
            reason: `استلام بطاقة ${person?.fullName || ''} #${index}`.trim(),
            personId: input.personId,
            sourceType: 'ReceivedCustomerCard',
            sourceId: card.id,
            note: input.notes || null,
            occurredAt: input.receivedAt ? new Date(input.receivedAt) : undefined,
          });

          await tx.receivedCustomerCard.update({
            where: { id: card.id },
            data: { receivedCashboxMovementId: movement.id },
          });
        }
      }

      return tx.receivedCardBatch.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          person: true,
          currency: true,
          cards: { include: { settlementCurrency: true }, orderBy: { sequence: 'asc' } },
        },
      });
    });

    await audit('RECEIVED_CARD_BATCH_CREATE', {
      entityType: 'ReceivedCardBatch',
      entityId: batch.id,
      newValue: batch as any,
      description: 'إضافة دفعة بطاقات مستلمة',
    });

    return ok(batch, 201);
  } catch (error) {
    if ((error as Error).message === 'USD_CURRENCY_REQUIRED') return fail('عملة الدولار غير مضافة في الإعدادات');
    if ((error as Error).message === 'INVALID_SETTLEMENT_CURRENCY') {
      return fail('عملة التصفية يجب أن تكون دينار أو دولار');
    }
    return apiError(error);
  }
}
