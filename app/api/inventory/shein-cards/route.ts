import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { encryptField } from '@/lib/secure-fields';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const createSheinCardSchema = z.object({
  denomination: z.coerce.number().positive(),
  cardCode: z.string().trim().min(1),
  pin: z.string().trim().min(1),
  purchasePrice: z.coerce.number().min(0).optional().nullable(),
  salePrice: z.coerce.number().min(0).optional().nullable(),
  saleCurrencyId: z.string().optional().nullable(),
  supplier: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const publicSheinCardSelect = {
  id: true,
  code: true,
  denomination: true,
  status: true,
  purchasePrice: true,
  salePrice: true,
  saleCurrencyId: true,
  saleCashboxMovementId: true,
  linkedTransactionId: true,
  linkedExecutionItemId: true,
  usedAt: true,
  usedByUserId: true,
  saleCurrency: true,
  supplier: true,
  buyerPersonId: true,
  buyer: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  soldAt: true,
  logs: { orderBy: { createdAt: 'desc' as const } },
};

function denominationCode(value: number) {
  return String(Math.trunc(value));
}

async function nextCardStart(tx: Prisma.TransactionClient, denomination: number) {
  const prefix = `#${denominationCode(denomination)}-`;

  for (let next = (await tx.sheinCard.count({ where: { code: { startsWith: prefix } } })) + 1; next < 100000; next += 1) {
    const code = `${prefix}${String(next).padStart(4, '0')}`;
    const exists = await tx.sheinCard.findUnique({ where: { code } });
    if (!exists) return code;
  }

  throw new Error('تعذر توليد هاشتاق كرت شي إن');
}

export async function GET() {
  try {
    await requireSession();

    const cards = await db.sheinCard.findMany({
      select: publicSheinCardSelect,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    return ok(cards);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();

    const parsed = createSheinCardSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات كرت شي إن');

    const input = parsed.data;
    const created = await db.$transaction(async (tx) => {
      if (input.saleCurrencyId) {
        const saleCurrency = await tx.currency.findFirst({
          where: { id: input.saleCurrencyId, code: { in: ['LYD', 'USD'] }, isActive: true },
        });
        if (!saleCurrency) throw new Error('INVALID_SALE_CURRENCY');
      }

      const hashtag = await nextCardStart(tx, input.denomination);
      return tx.sheinCard.create({
        data: {
          code: hashtag,
          cardCodeEncrypted: encryptField(input.cardCode),
          pinEncrypted: encryptField(input.pin),
          denomination: D(input.denomination),
          purchasePrice: input.purchasePrice == null ? null : D(input.purchasePrice),
          salePrice: input.salePrice == null ? null : D(input.salePrice),
          saleCurrencyId: input.saleCurrencyId || null,
          supplier: input.supplier,
          notes: input.notes,
          logs: {
            create: {
              type: 'PURCHASE',
              amount: input.purchasePrice == null ? null : D(input.purchasePrice),
              note: input.notes || 'إضافة كرت للمخزن',
            },
          },
        },
        select: publicSheinCardSelect,
      });
    });

    await audit('SHEIN_CARD_CREATE', {
      entityType: 'SheinCard',
      entityId: created.id,
      newValue: created as any,
      description: 'إضافة كرت شي إن للمخزن',
    });
    revalidateFinancePaths();

    return ok(created, 201);
  } catch (error) {
    if ((error as Error).message === 'INVALID_SALE_CURRENCY') {
      return fail('عملة الدفع يجب أن تكون دينار أو دولار');
    }
    return apiError(error);
  }
}
