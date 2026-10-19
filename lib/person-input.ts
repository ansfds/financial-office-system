import { z } from 'zod';
export const personSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  phoneSecondary: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(10000).optional().nullable(),
  externalId: z.string().trim().max(200).optional().nullable(),
  category: z.enum(['VIP', 'REGULAR']).default('REGULAR'),
});
export function normalizePhone(value?: string | null) {
  return (value || '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/\D/g, '')
    .replace(/^00/, '');
}
export async function similarPerson(
  tx: any,
  input: { fullName: string; phone?: string | null; phoneSecondary?: string | null },
) {
  const phones = [input.phone, input.phoneSecondary].map(normalizePhone).filter(Boolean);
  const people = await tx.person.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      OR: [
        { fullName: { equals: input.fullName, mode: 'insensitive' } },
        ...(phones.length ? [{ phone: { not: null } }, { phoneSecondary: { not: null } }] : []),
      ],
    },
    select: { id: true, fullName: true, phone: true, phoneSecondary: true, customerNo: true },
  });
  return people.find((p: any) =>
    phones.length
      ? [p.phone, p.phoneSecondary].some((v) => phones.includes(normalizePhone(v)))
      : p.fullName.trim().toLowerCase() === input.fullName.trim().toLowerCase(),
  );
}
export async function nextCustomerNo(tx: any) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(782341)`;
  const people = await tx.person.findMany({ select: { customerNo: true } });
  const highest = people.reduce(
    (n: number, p: any) => Math.max(n, Number(String(p.customerNo || '').replace(/\D/g, '')) || 0),
    0,
  );
  return `#${String(highest + 1).padStart(4, '0')}`;
}
