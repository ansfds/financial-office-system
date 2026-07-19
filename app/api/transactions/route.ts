import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { D, statusOf } from '@/lib/money';
import { createCashboxMovement } from '@/lib/cashbox';
import { z } from 'zod';

const transactionSchema = z.object({
  personId: z.string().optional().nullable(),
  typeId: z.string().optional().nullable(),
  customType: z.string().trim().optional(),
  description: z.string().trim().optional(),
  currencyId: z.string().min(1),
  agreedAmount: z.coerce.number().positive(),
  receivedAmount: z.coerce.number().min(0).default(0),
  paidAmount: z.coerce.number().min(0).default(0),
  exchangeRate: z.coerce.number().positive().optional().nullable(),
  transactionAt: z.string().optional(),
  dueAt: z.string().optional().nullable(),
  txId: z.string().trim().optional(),
  cardNumber: z.string().trim().optional(),
  bankName: z.string().trim().optional(),
  verificationReceived: z.coerce.boolean().default(false),
  secureInternalNote: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export async function GET(request: Request) {
  try {
    await requireSession();

    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() || '';
    const status = url.searchParams.get('status') || undefined;

    const transactions = await db.financialTransaction.findMany({
      where: {
        deletedAt: null,
        status: status as any,
        OR: q
          ? [
              { number: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { txId: { contains: q, mode: 'insensitive' } },
              { cardNumber: { contains: q, mode: 'insensitive' } },
              { bankName: { contains: q, mode: 'insensitive' } },
              { person: { fullName: { contains: q, mode: 'insensitive' } } },
              { person: { customerNo: { contains: q, mode: 'insensitive' } } },
            ]
          : undefined,
      },
      include: { person: true, currency: true, type: true },
      orderBy: { transactionAt: 'desc' },
      take: 300,
    });

    return ok(transactions);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();

    const parsed = transactionSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات المعاملة');

    const data = parsed.data;
    const agreedAmount = D(data.agreedAmount);
    const receivedAmount = D(data.receivedAmount);
    const paidAmount = D(data.paidAmount);
    const number = `TX-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase()}`;

    const transaction = await db.$transaction(async (tx) => {
      const created = await tx.financialTransaction.create({
        data: {
          ...data,
          personId: data.personId || null,
          typeId: data.typeId || null,
          number,
          agreedAmount,
          receivedAmount,
          paidAmount,
          receivableAmount: D(0),
          payableAmount: D(0),
          transactionAt: data.transactionAt ? new Date(data.transactionAt) : new Date(),
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          status: statusOf(agreedAmount, receivedAmount, paidAmount, D(0), D(0)) as any,
        },
      });

      const movements = [
        { direction: 'IN' as const, amount: receivedAmount, reason: 'المبلغ المستلم عند إنشاء المعاملة' },
        { direction: 'OUT' as const, amount: paidAmount, reason: 'المبلغ المدفوع عند إنشاء المعاملة' },
      ];

      for (const movement of movements) {
        if (movement.amount.lte(0)) continue;

        await createCashboxMovement(tx, {
          currencyId: data.currencyId,
          transactionId: created.id,
          personId: data.personId || null,
          direction: movement.direction,
          amount: movement.amount,
          reason: movement.reason,
          sourceType: 'FinancialTransaction',
          sourceId: created.id,
        });
      }

      return created;
    });

    await audit('TRANSACTION_CREATE', {
      entityType: 'FinancialTransaction',
      entityId: transaction.id,
      newValue: { number, ...data },
      description: 'إضافة معاملة',
    });

    return ok(transaction, 201);
  } catch (error) {
    return apiError(error);
  }
}
