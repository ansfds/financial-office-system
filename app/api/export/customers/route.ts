import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { numberValue } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  await requireSession();

  const people = await db.person.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    include: {
      cardBatches: {
        include: {
          currency: true,
          cards: {
            where: { deletedAt: null },
            include: {
              settlementCurrency: true,
              operations: { where: { deletedAt: null }, orderBy: { occurredAt: 'desc' } },
            },
            orderBy: { sequence: 'asc' },
          },
        },
      },
      cardDeliveries: {
        where: { deletedAt: null },
        include: { currency: true },
        orderBy: { occurredAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rows: Array<Array<string | number>> = [
    ['رقم الزبون', 'اسم الزبون', 'الهاتف', 'رقم البطاقة', 'آخر 4 أرقام', 'القيمة الأصلية', 'السعر المتفق عليه', 'المسحوب', 'المتبقي', 'العملة', 'الحالة', 'عدد عمليات البطاقة', 'إجمالي التسليمات للزبون'],
  ];

  for (const person of people) {
    const cards = person.cardBatches.flatMap((batch) =>
      batch.cards.map((card) => ({
        card,
        currency: card.settlementCurrency || batch.currency,
      })),
    );

    if (!cards.length) {
      rows.push([person.customerNo || '', person.fullName, person.phone || '', '', '', '', '', '', '', '', '']);
      continue;
    }

    for (const { card, currency } of cards) {
      const original = numberValue(card.valueUsd) > 0 ? numberValue(card.valueUsd) : 0;
      const remaining = Math.max(original - numberValue(card.receivedAmount), 0);
      rows.push([
        person.customerNo || '',
        person.fullName,
        person.phone || '',
        card.publicCode || `#C${String(card.sequence).padStart(4, '0')}`,
        card.cardLast4 || '',
        original,
        numberValue(card.agreedAmount),
        numberValue(card.totalDeducted ?? card.receivedAmount),
        numberValue(card.remainingAmount ?? remaining),
        currency?.code || '',
        card.status,
        card.operations.length,
        person.cardDeliveries.reduce((sum, delivery) => sum + numberValue(delivery.amount), 0),
      ]);
    }
  }

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="customers-cards.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
