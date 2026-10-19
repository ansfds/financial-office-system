import Page from '@/components/Page';
import CardsClient from '@/components/CardsClient';
import { requireSession } from '@/lib/auth';
import { findCardOwners } from '@/lib/card-queries';
import { parseCardState } from '@/lib/card-states';
import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';
export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireSession();
  const query = await searchParams;
  const state = parseCardState(query.status),
    q = (query.q || '').trim().slice(0, 200);
  const [initial, currencies] = await Promise.all([
    findCardOwners({ q, state }),
    db.currency.findMany({
      where: { isActive: true, code: { in: ['USD', 'LYD'] } },
      orderBy: { code: 'asc' },
    }),
  ]);
  return (
    <Page title="البطاقات">
      <CardsClient
        initial={JSON.parse(JSON.stringify(initial))}
        initialQuery={q}
        initialState={state || ''}
        currencies={JSON.parse(JSON.stringify(currencies))}
      />
    </Page>
  );
}
