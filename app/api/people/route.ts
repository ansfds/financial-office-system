import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { findPeopleWithCardSummaries } from '@/lib/people-card-summary';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { personSchema, similarPerson, nextCustomerNo } from '@/lib/person-input';

export async function GET(request: Request) {
  try {
    await requireSession();

    const q = new URL(request.url).searchParams.get('q')?.trim() || '';
    const page = Math.max(Number(new URL(request.url).searchParams.get('page') || 1), 1);
    const pageSize = Math.min(Math.max(Number(new URL(request.url).searchParams.get('pageSize') || 100), 20), 200);

    return ok(await findPeopleWithCardSummaries({ q, page, pageSize }));
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
      const duplicate = await similarPerson(tx, parsed.data);
      if (duplicate) return { duplicate };
      return tx.person.create({ data: { ...parsed.data, customerNo } });
    });

    if ('duplicate' in person) return ok({ error: 'يوجد زبون مشابه، هل تريد استخدامه؟', duplicate: person.duplicate }, 409);
    await audit('PERSON_CREATE', {
      entityType: 'Person',
      entityId: person.id,
      newValue: person as any,
      description: 'إضافة زبون',
    });
    revalidateFinancePaths();

    return ok(person, 201);
  } catch (error) {
    return apiError(error);
  }
}
