import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { personDetailSelect } from '@/lib/received-card-selects';
import { z } from 'zod';
import { archiveCustomer } from '@/lib/customer-archive';
import { revalidateFinancePaths } from '@/lib/revalidate';

const updatePersonSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  phone: z.string().trim().optional().nullable(),
  phoneSecondary: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().optional().nullable(),
  externalId: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  category: z.enum(['VIP', 'REGULAR']).optional(),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();

    const { id } = await params;
    const person = await db.person.findUnique({
      where: { id },
      select: personDetailSelect,
    });

    if (!person || person.deletedAt || person.status !== 'ACTIVE') return fail('الزبون غير موجود', 404);
    return ok(person);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();

    const { id } = await params;
    const parsed = updatePersonSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات الزبون المدخلة');

    const oldValue = await db.person.findUnique({ where: { id } });
    if (!oldValue || oldValue.deletedAt) return fail('الزبون غير موجود', 404);
    const person = await db.person.update({
      where: { id },
      data: parsed.data,
      select: personDetailSelect,
    });

    await audit('PERSON_UPDATE', {
      entityType: 'Person',
      entityId: id,
      oldValue: oldValue as any,
      newValue: person as any,
      description: 'تعديل بيانات زبون',
    });
    revalidateFinancePaths([`/customers/${id}`]);

    return ok(person);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(782341)`;
      return archiveCustomer(tx, id, session.username || 'system');
    });
    revalidateFinancePaths(['/trash', `/customers/${id}`]);
    return ok(result);
  } catch (error) {
    if ((error as Error).message === 'PERSON_NOT_FOUND') return fail('الزبون غير موجود', 404);
    return apiError(error);
  }
}
