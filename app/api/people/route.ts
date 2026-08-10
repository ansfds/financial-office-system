import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { sortByCustomerCode } from '@/lib/customer-code-sort';
import { apiError, fail, ok } from '@/lib/http';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const personSchema = z.object({
  fullName: z.string().trim().min(2, 'الاسم مطلوب'),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  externalId: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  category: z.enum(['VIP', 'REGULAR']).default('REGULAR'),
});

async function nextCustomerNo(tx: Prisma.TransactionClient) {
  const total = await tx.person.count();

  for (let index = total + 1; index < total + 10000; index += 1) {
    const customerNo = `#${String(index).padStart(4, '0')}`;
    const exists = await tx.person.findFirst({ where: { customerNo } });
    if (!exists) return customerNo;
  }

  throw new Error('تعذر توليد رقم العميل');
}

export async function GET(request: Request) {
  try {
    await requireSession();

    const q = new URL(request.url).searchParams.get('q')?.trim() || '';
    const page = Math.max(Number(new URL(request.url).searchParams.get('page') || 1), 1);
    const pageSize = Math.min(Math.max(Number(new URL(request.url).searchParams.get('pageSize') || 100), 20), 200);

    const people = await db.person.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        OR: q
          ? [
              { fullName: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { customerNo: { contains: q, mode: 'insensitive' } },
              { externalId: { contains: q, mode: 'insensitive' } },
              { notes: { contains: q, mode: 'insensitive' } },
              { cardBatches: { some: { cards: { some: { cardLast4: { contains: q } } } } } },
            ]
          : undefined,
      },
      include: {
        cardBatches: {
          include: {
            currency: true,
            cards: {
              where: { deletedAt: null },
              include: {
                settlementCurrency: true,
                operations: { where: { deletedAt: null }, orderBy: { occurredAt: 'desc' }, take: 20 },
                stageLogs: { orderBy: { createdAt: 'desc' }, take: 8 },
              },
              orderBy: { sequence: 'asc' },
            },
          },
          orderBy: { receivedAt: 'desc' },
        },
        cardDeliveries: {
          where: { deletedAt: null },
          include: { currency: true },
          orderBy: { occurredAt: 'desc' },
        },
      },
      orderBy: [{ customerNo: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return ok(sortByCustomerCode(people));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();

    const parsed = personSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات الزبون المدخلة');

    const person = await db.$transaction(async (tx) => {
      const customerNo = await nextCustomerNo(tx);
      return tx.person.create({ data: { ...parsed.data, customerNo } });
    });

    await audit('PERSON_CREATE', {
      entityType: 'Person',
      entityId: person.id,
      newValue: person as any,
      description: 'إضافة زبون',
    });
    revalidateFinancePaths(['/people']);

    return ok(person, 201);
  } catch (error) {
    return apiError(error);
  }
}
