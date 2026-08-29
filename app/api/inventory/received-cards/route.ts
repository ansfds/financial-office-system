import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { STANDARD_CUSTOMER_CARD_VALUE_USD, cardBaseAmount, cardProgressPercent } from '@/lib/customer-cards';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const cardImageDataUrlSchema = z
  .string()
  .max(2800000)
  .regex(/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/);

const cardInputSchema = z.object({
  bankName: z.string().trim().optional(),
  cardLast4: z
    .string()
    .trim()
    .regex(/^\d{0,4}$/, 'آخر 4 أرقام فقط')
    .optional(),
  valueUsd: z.coerce.number().min(0).optional(),
  agreedAmount: z.coerce.number().positive().optional(),
  currencyId: z.string().optional().nullable(),
  verificationReceived: z.coerce.boolean().default(false),
  secureInternalNote: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  cardImageDataUrl: cardImageDataUrlSchema.optional().nullable(),
  cardThumbnailDataUrl: cardImageDataUrlSchema.optional().nullable(),
  cardImageMimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional().nullable(),
  cardImageSize: z.coerce.number().int().min(0).max(2000000).optional().nullable(),
});

type CardInput = z.infer<typeof cardInputSchema>;

const createBatchSchema = z.object({
  personId: z.string().min(1).optional().nullable(),
  newPerson: z
    .object({
      fullName: z.string().trim().min(2),
      phone: z.string().trim().optional().nullable(),
      address: z.string().trim().optional().nullable(),
      notes: z.string().trim().optional().nullable(),
      externalId: z.string().trim().optional().nullable(),
      category: z.enum(['VIP', 'REGULAR']).default('REGULAR'),
    })
    .optional()
    .nullable(),
  currencyId: z.string().optional().nullable(),
  receivedAt: z.string().optional(),
  cardCount: z.coerce.number().int().min(1).max(200),
  valueUsdPerCard: z.coerce.number().min(0).default(STANDARD_CUSTOMER_CARD_VALUE_USD),
  agreedAmountPerCard: z.coerce.number().positive(),
  commonBankName: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  cards: z.array(cardInputSchema).optional(),
});

async function nextCustomerNo(tx: Prisma.TransactionClient) {
  const total = await tx.person.count();

  for (let index = total + 1; index < total + 100000; index += 1) {
    const customerNo = `#${String(index).padStart(4, '0')}`;
    const exists = await tx.person.findFirst({ where: { customerNo } });
    if (!exists) return customerNo;
  }

  throw new Error('CUSTOMER_CODE_FAILED');
}

async function nextCardCodes(tx: Prisma.TransactionClient, count: number) {
  const total = await tx.receivedCustomerCard.count();
  const codes: string[] = [];
  let cursor = total + 1;

  while (codes.length < count) {
    const candidateCount = Math.max((count - codes.length) * 2, 100);
    const candidates = Array.from({ length: candidateCount }, (_, offset) => `#C${String(cursor + offset).padStart(4, '0')}`);
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
      include: {
        person: true,
        currency: true,
        cards: {
          where: { deletedAt: null },
          include: {
            settlementCurrency: true,
            operations: { where: { deletedAt: null }, orderBy: { occurredAt: 'desc' }, take: 12 },
            stageLogs: { orderBy: { createdAt: 'desc' }, take: 8 },
          },
          orderBy: { sequence: 'asc' },
        },
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
    const session = await requireSession();

    const parsed = createBatchSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات البطاقات المستلمة');

    const input = parsed.data;
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();

    const batch = await db.$transaction(async (tx) => {
      if (!input.personId && !input.newPerson) throw new Error('PERSON_REQUIRED');

      const cardCurrencyIds = Array.from(new Set((input.cards || []).map((card) => card.currencyId).filter(Boolean))) as string[];
      const [settlementCurrency, existingPerson, cardCurrencies] = await Promise.all([
        input.currencyId
          ? tx.currency.findFirst({
              where: { id: input.currencyId, code: { in: ['USD', 'LYD'] }, isActive: true },
            })
          : Promise.resolve(null),
        input.personId ? tx.person.findFirst({ where: { id: input.personId, deletedAt: null, status: 'ACTIVE' } }) : Promise.resolve(null),
        cardCurrencyIds.length
          ? tx.currency.findMany({ where: { id: { in: cardCurrencyIds }, code: { in: ['USD', 'LYD'] }, isActive: true } })
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
            address: input.newPerson?.address || null,
            notes: input.newPerson?.notes || null,
            externalId: input.newPerson?.externalId || null,
            category: input.newPerson?.category || 'REGULAR',
          },
        }));

      const cards: CardInput[] = Array.from(
        { length: input.cardCount },
        (_, index) => input.cards?.[index] || { verificationReceived: false },
      );
      const normalizedLast4 = cards
        .map((card) => card.cardLast4?.trim())
        .filter((value): value is string => Boolean(value));
      const duplicateInside = normalizedLast4.find((value, index) => normalizedLast4.indexOf(value) !== index);
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
            receivedAmount: D(0),
            totalDeducted: D(0),
            remainingAmount: prepared.baseAmount,
            progressPercent: cardProgressPercent(prepared.baseAmount, 0),
            status: 'RECEIVED',
            verificationReceived: source?.verificationReceived || false,
            secureInternalNote: source?.secureInternalNote,
            notes: source?.notes,
            cardImageDataUrl: source?.cardImageDataUrl || null,
            cardThumbnailDataUrl: source?.cardThumbnailDataUrl || null,
            cardImageMimeType: source?.cardImageMimeType || null,
            cardImageSize: source?.cardImageSize || null,
            cardImageUpdatedAt: source?.cardImageDataUrl ? new Date() : null,
          };
        }),
      });

      return tx.receivedCardBatch.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          person: true,
          currency: true,
          entryTransaction: true,
          cards: {
            where: { deletedAt: null },
            include: {
              settlementCurrency: true,
              operations: { where: { deletedAt: null }, orderBy: { occurredAt: 'desc' }, take: 12 },
              stageLogs: { orderBy: { createdAt: 'desc' }, take: 8 },
            },
            orderBy: { sequence: 'asc' },
          },
        },
      });
    });

    await audit('RECEIVED_CARD_BATCH_CREATE', {
      entityType: 'ReceivedCardBatch',
      entityId: batch.id,
      newValue: batch as any,
      description: 'إضافة دفعة بطاقات مستلمة بدون أثر على الصندوق',
    });
    revalidateFinancePaths([`/people/${batch.personId}`]);

    return ok(batch, 201);
  } catch (error) {
    if ((error as Error).message === 'PERSON_REQUIRED') return fail('اختر زبونًا موجودًا أو أدخل زبونًا جديدًا');
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
    return apiError(error);
  }
}
