import Link from 'next/link';
import { cardStateDefinitions, CardCounts } from '@/lib/card-states';
import { formatNumber } from '@/lib/format';
export default function CardStatistics({
  counts,
  href = '/cards',
  title = 'البطاقات',
}: {
  counts: CardCounts;
  href?: string;
  title?: string;
}) {
  return (
    <section className="card p-4" data-card-statistics>
      <h2 className="mb-3 font-black">{title}</h2>
      <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {cardStateDefinitions.map((state) => (
          <div
            key={state.key}
            data-card-state={state.key}
            className="flex items-center justify-between gap-4 py-2"
          >
            <dt className={state.color}>
              <Link href={`${href}?status=${state.key}`}>{state.label}</Link>
            </dt>
            <dd className="font-bold tabular-nums" data-count={counts[state.key]}>
              {formatNumber(counts[state.key])}
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 py-3 font-black" data-card-state="total">
          <dt>
            <Link href={href}>إجمالي البطاقات</Link>
          </dt>
          <dd data-count={counts.total}>{formatNumber(counts.total)}</dd>
        </div>
      </dl>
    </section>
  );
}
