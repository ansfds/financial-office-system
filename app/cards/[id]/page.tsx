import Page from '@/components/Page';
import CustomerCardsClient from '@/components/CustomerCardsClient';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { personDetailSelect } from '@/lib/received-card-selects';
import { notFound } from 'next/navigation';
import { parseCardState } from '@/lib/card-states';
export const dynamic = 'force-dynamic';
export default async function CustomerCardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const query = await searchParams;
  const [person, currencies] = await Promise.all([
    db.person.findFirst({
      where: { id, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        fullName: true,
        phone: true,
        phoneSecondary: true,
        customerNo: true,
        cardBatches: personDetailSelect.cardBatches,
      },
    }),
    db.currency.findMany({
      where: { isActive: true, code: { in: ['USD', 'LYD'] } },
      orderBy: { code: 'asc' },
    }),
  ]);
  if (!person) notFound();
  return (
    <Page title={`بطاقات ${person.fullName}`}>
      <CustomerCardsClient
        person={JSON.parse(JSON.stringify(person))}
        currencies={JSON.parse(JSON.stringify(currencies))}
        initialQuery={(query.q || '').slice(0, 200)}
        initialState={parseCardState(query.status) || ''}
      />
    </Page>
  );
}
