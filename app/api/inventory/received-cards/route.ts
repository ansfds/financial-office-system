import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { receivedCardBatchResponseSelect } from '@/lib/received-card-selects';
import { STANDARD_CUSTOMER_CARD_VALUE_USD, cardBaseAmount, cardProgressPercent } from '@/lib/customer-cards';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { personSchema, nextCustomerNo, similarPerson } from '@/lib/person-input';

const cardInputSchema = z.object({
  status: z
    .enum(['RECEIVED', 'SETTLED', 'PAYMENT_FAILED', 'INSUFFICIENT_BALANCE', 'CANCELLED'])
    .default('RECEIVED'),
  bankName: z.string().trim().optional(),
  cardLast4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'آخر 4 أرقام فقط'),
  valueUsd: z.coerce.number().min(0).optional(),
  agreedAmount: z.coerce.number().positive().optional(),
  currencyId: z.string().optional().nullable(),
  verificationReceived: z.coerce.boolean().default(false),
  secureInternalNote: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

type CardInput = z.infer<typeof cardInputSchema>;

const createBatchSchema = z.object({
  personId: z.string().min(1).optional().nullable(),
  newPerson: personSchema.optional().nullable(),
  currencyId: z.string().optional().nullable(),
  receivedAt: z.string().optional(),
  cardCount: z.coerce.number().int().min(1).max(200),
  valueUsdPerCard: z.coerce.number().min(0).default(STANDARD_CUSTOMER_CARD_VALUE_USD),
  agreedAmountPerCard: z.coerce.number().positive(),
  commonBankName: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  cards: z.array(cardInputSchema).min(1).max(200),
});

async function nextCardCodes(tx: Prisma.TransactionClient, count: number) {
  const total = await tx.receivedCustomerCard.count();
  const codes: string[] = [];
  let cursor = total + 1;

  while (codes.length < count) {
    const candidateCount = Math.max((count - codes.length) * 2, 100);
    const candidates = Array.from(
      { length: candidateCount },
      (_, offset) => `#C${String(cursor + offset).padStart(4, '0')}`,
    );
    const existing = new Set(
      (
        await tx.receivedCustomerCard.findMany({
          where: { publicCode: { in: candidates } },
          select: { publicCode: true },
        })
      )
        .map((item) => item.publicCode)
        .filter(Boolean),
    );

    for (const candidate of candidates) {
      if (!existing.has(candidate)) codes.push(candidate);
      if (codes.length === count) break;
    }
    cursor += candidateCount;
    if (cursor > total + 100000) throw new Error('CARD_CODE_FAILED');
  }

  return codes;
}

export async function GET() {
  try {
    await requireSession();

    const batches = await db.receivedCardBatch.findMany({
      where: { person: { deletedAt: null, status: 'ACTIVE' }, cards: { some: { deletedAt: null } } },
      select: receivedCardBatchResponseSelect,
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
    const session = await requireSession();

    const parsed = createBatchSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات البطاقات المستلمة');

    const input = parsed.data;
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    if (!Number.isFinite(receivedAt.getTime())) return fail('تاريخ غير صحيح');
    if (input.cards && input.cards.length !== input.cardCount) return fail('عدد البطاقات لا يطابق الصفوف');

    const batch = await db.$transaction(
      async (tx) => {
        if (!input.personId && !input.newPerson) throw new Error('PERSON_REQUIRED');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(782341)`;
        if (!input.personId && input.newPerson) {
          const duplicate = await similarPerson(tx, input.newPerson);
          if (duplicate) throw Object.assign(new Error('DUPLICATE_PERSON'), { duplicate });
        }

        const cardCurrencyIds = Array.from(
          new Set((input.cards || []).map((card) => card.currencyId).filter(Boolean)),
        ) as string[];
        const [settlementCurrency, existingPerson, cardCurrencies] = await Promise.all([
          input.currencyId
            ? tx.currency.findFirst({
                where: { id: input.currencyId, code: { in: ['USD', 'LYD'] }, isActive: true },
              })
            : Promise.resolve(null),
          input.personId
            ? tx.person.findFirst({ where: { id: input.personId, deletedAt: null, status: 'ACTIVE' } })
            : Promise.resolve(null),
          cardCurrencyIds.length
            ? tx.currency.findMany({
                where: { id: { in: cardCurrencyIds }, code: { in: ['USD', 'LYD'] }, isActive: true },
              })
            : Promise.resolve([]),
        ]);

        if (input.currencyId && !settlementCurrency) throw new Error('INVALID_SETTLEMENT_CURRENCY');
        if (cardCurrencyIds.length !== cardCurrencies.length) throw new Error('INVALID_SETTLEMENT_CURRENCY');
        if (input.personId && !existingPerson) throw new Error('PERSON_NOT_FOUND');

        const person =
          existingPerson ||
          (await tx.person.create({
            data: {
              customerNo: await nextCustomerNo(tx),
              fullName: input.newPerson?.fullName || '',
              phone: input.newPerson?.phone || null,
              phoneSecondary: input.newPerson?.phoneSecondary || null,
              address: input.newPerson?.address || null,
              notes: input.newPerson?.notes || null,
              externalId: input.newPerson?.externalId || null,
              category: input.newPerson?.category || 'REGULAR',
            },
          }));

        const cards: CardInput[] = input.cards;
        const normalizedLast4 = cards
          .map((card) => card.cardLast4?.trim())
          .filter((value): value is string => Boolean(value));
        const duplicateInside = normalizedLast4.find(
          (value, index) => normalizedLast4.indexOf(value) !== index,
        );
        if (duplicateInside) throw new Error('DUPLICATE_LAST4_IN_BATCH');

        if (input.cards?.length) {
          const incomplete = cards.some((card) => !card.cardLast4 || card.cardLast4.length !== 4);
          if (incomplete) throw new Error('FAST_ENTRY_REQUIRES_LAST4');
        }

        const duplicateWarnings = normalizedLast4.length
          ? await tx.receivedCustomerCard.findMany({
              where: { deletedAt: null, cardLast4: { in: normalizedLast4 } },
              select: {
                cardLast4: true,
                publicCode: true,
                batch: { select: { person: { select: { customerNo: true, fullName: true } } } },
              },
              take: 30,
            })
          : [];

        const preparedCards = cards.map((source, index) => {
          const agreedAmount = D(source.agreedAmount || input.agreedAmountPerCard);
          const valueUsd = D(source.valueUsd ?? input.valueUsdPerCard);
          const baseAmount = cardBaseAmount(valueUsd, agreedAmount);
          return {
            sequence: index + 1,
            source,
            agreedAmount,
            valueUsd,
            baseAmount,
          };
        });

        const totalOriginalAmount = preparedCards.reduce((sum, card) => sum.add(card.baseAmount), D(0));
        const totalAgreedAmount = preparedCards.reduce((sum, card) => sum.add(card.agreedAmount), D(0));

        const entryTransaction = await tx.customerCardEntryTransaction.create({
          data: {
            personId: person.id,
            currencyId: input.currencyId || null,
            cardCount: input.cardCount,
            totalOriginalAmount,
            totalAgreedAmount,
            duplicateWarnings: duplicateWarnings as any,
            notes: input.notes,
            userId: session.userId,
            username: session.username,
            occurredAt: receivedAt,
          },
        });

        const created = await tx.receivedCardBatch.create({
          data: {
            personId: person.id,
            currencyId: input.currencyId || null,
            entryTransactionId: entryTransaction.id,
            receivedAt,
            cardCount: input.cardCount,
            agreedAmountPerCard: D(input.agreedAmountPerCard),
            totalOriginalAmount,
            totalAgreedAmount,
            notes: input.notes,
            createdByUserId: session.userId,
            createdByUsername: session.username,
          },
        });

        const publicCodes = await nextCardCodes(tx, preparedCards.length);

        await tx.receivedCustomerCard.createMany({
          data: preparedCards.map((prepared) => {
            const source = prepared.source;
            const publicCode = publicCodes[prepared.sequence - 1];
            return {
              batchId: created.id,
              sequence: prepared.sequence,
              publicCode,
              bankName: source?.bankName || input.commonBankName,
              cardLast4: source?.cardLast4,
              valueUsd: prepared.valueUsd,
              agreedAmount: prepared.agreedAmount,
              settlementAmount: null,
              settlementCurrencyId: source?.currencyId || input.currencyId || null,
              settlementPaymentMethod: null,
              receivedAmount: source.status === 'SETTLED' ? prepared.baseAmount : D(0),
              totalDeducted: source.status === 'SETTLED' ? prepared.baseAmount : D(0),
              remainingAmount: source.status === 'SETTLED' ? D(0) : prepared.baseAmount,
              progressPercent: cardProgressPercent(
                prepared.baseAmount,
                source.status === 'SETTLED' ? prepared.baseAmount : 0,
              ),
              status: source.status || 'RECEIVED',
              currentStage: source.status === 'SETTLED' ? 5 : 0,
              rejectedAt: source.status === 'CANCELLED' ? receivedAt : null,
              rejectReason: source.status === 'CANCELLED' ? 'ملغية عند الإدخال' : null,
              verificationReceived: source?.verificationReceived || false,
              secureInternalNote: source?.secureInternalNote,
              notes: source?.notes,
            };
          }),
        });

        const cleared = await tx.receivedCustomerCard.findMany({
          where: { batchId: created.id, status: 'SETTLED' },
        });
        for (const card of cleared)
          await tx.receivedCardOperation.create({
            data: {
              cardId: card.id,
              operationType: 'FINAL_SETTLEMENT',
              amount: card.valueUsd,
              balanceBefore: card.valueUsd,
              balanceAfter: D(0),
              progressAfter: D(100),
              userId: session.userId,
              username: session.username,
              note: 'صافية عند الإدخال',
              occurredAt: receivedAt,
            },
          });
        return tx.receivedCardBatch.findUniqueOrThrow({
          where: { id: created.id },
          select: receivedCardBatchResponseSelect,
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );

    await audit('RECEIVED_CARD_BATCH_CREATE', {
      entityType: 'ReceivedCardBatch',
      entityId: batch.id,
      newValue: batch as any,
      description: 'إضافة دفعة بطاقات مستلمة بدون أثر على الصندوق',
    });
    revalidateFinancePaths([`/customers/${batch.personId}`]);

    return ok(batch, 201);
  } catch (error) {
    if ((error as Error).message === 'PERSON_REQUIRED')
      return fail('اختر زبونًا موجودًا أو أدخل زبونًا جديدًا');
    if ((error as Error).message === 'PERSON_NOT_FOUND') return fail('الزبون غير موجود', 404);
    if ((error as Error).message === 'DUPLICATE_LAST4_IN_BATCH') {
      return fail('يوجد تكرار في آخر 4 أرقام داخل نفس معاملة البطاقات');
    }
    if ((error as Error).message === 'FAST_ENTRY_REQUIRES_LAST4') {
      return fail('الإدخال السريع يتطلب آخر 4 أرقام لكل بطاقة');
    }
    if ((error as Error).message === 'INVALID_SETTLEMENT_CURRENCY') {
      return fail('عملة التصفية يجب أن تكون دينار أو دولار');
    }
    if ((error as Error).message === 'DUPLICATE_PERSON')
      return ok({ error: 'يوجد زبون مشابه، هل تريد استخدامه؟', duplicate: (error as any).duplicate }, 409);
    return apiError(error);
  }
}
