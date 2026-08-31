import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { revalidatePaths } from '@/lib/revalidate';
import { personDetailSelect } from '@/lib/received-card-selects';
import { z } from 'zod';

const updatePersonSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  phone: z.string().trim().optional().nullable(),
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
    revalidatePaths(['/people', `/people/${id}`]);

    return ok(person);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();

    const { id } = await params;
    const oldValue = await db.person.findUnique({ where: { id } });

    await db.$transaction([
      db.person.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } }),
      db.deletedItem.create({
        data: { entityType: 'Person', entityId: id, snapshot: oldValue as any },
      }),
    ]);

    await audit('PERSON_ARCHIVE', {
      entityType: 'Person',
      entityId: id,
      oldValue: oldValue as any,
      description: 'أرشفة زبون',
    });
    revalidatePaths(['/people', `/people/${id}`]);

    return ok({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
