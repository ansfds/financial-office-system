'use client';
import { apiFetch, readApiJson } from '@/lib/api-client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cardStateDefinitions } from '@/lib/card-states';
import FastCardEntryModal from './FastCardEntryModal';
export default function CardsClient({
  initial,
  initialQuery,
  initialState,
  currencies,
}: {
  initial: any;
  initialQuery: string;
  initialState: string;
  currencies: any[];
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery),
    [state, setState] = useState(initialState),
    [page, setPage] = useState(1);
  const [data, setData] = useState(initial),
    [loading, setLoading] = useState(false),
    [entry, setEntry] = useState(false);
  useEffect(() => {
    setQ(initialQuery);
    setState(initialState);
    setPage(1);
  }, [initialQuery, initialState]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await apiFetch(
          `/api/cards?${new URLSearchParams({ q, status: state, page: String(page) })}`,
          { cache: 'no-store', signal: controller.signal },
        );
        const result = await readApiJson(response);
        if (!response.ok) throw new Error(result.error || 'تعذر تحميل البطاقات');
        setData(result);
      } catch (e) {
        if (!controller.signal.aborted) toast.error((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, state, page, initial]);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          aria-label="بحث البطاقات"
          className="min-w-48 flex-1"
          placeholder="اسم الزبون أو الهاتف أو آخر 4 أرقام"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="w-auto"
          aria-label="حالة البطاقات"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
        >
          <option value="">الكل</option>
          {cardStateDefinitions.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white"
          onClick={() => setEntry(true)}
        >
          + إضافة بطاقات
        </button>
      </div>
      <div
        className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-800"
        aria-busy={loading}
      >
        <div className="hidden grid-cols-[2fr_1.2fr_repeat(3,1fr)] gap-3 bg-slate-50 p-3 text-sm font-bold dark:bg-slate-800 md:grid">
          <span>الزبون</span>
          <span>الهاتف</span>
          <span>البطاقات</span>
          <span>قيد السحب</span>
          <span>مصفاة</span>
        </div>
        {data.people.map((person: any) => (
          <Link
            key={person.id}
            href={`/cards/${person.id}?${new URLSearchParams({ q, status: state })}`}
            data-card-owner={person.id}
            className="grid gap-2 p-3 hover:bg-slate-50 dark:hover:bg-slate-800 md:grid-cols-[2fr_1.2fr_repeat(3,1fr)] md:items-center md:gap-3"
          >
            <span className="font-bold">{person.fullName}</span>
            <span className="text-sm text-slate-500">
              <bdi dir="ltr">{person.phone || '—'}</bdi>
            </span>
            <span className="text-sm">
              <span className="md:hidden">البطاقات: </span>
              {person.counts.total}
            </span>
            <span className="text-sm text-amber-700 dark:text-amber-300">
              <span className="md:hidden">قيد السحب: </span>
              {person.counts.IN_PROGRESS}
            </span>
            <span className="text-sm text-emerald-700 dark:text-emerald-300">
              <span className="md:hidden">مصفاة: </span>
              {person.counts.CLEARED}
            </span>
          </Link>
        ))}
        {!data.people.length && (
          <p className="p-5 text-sm text-slate-500">لا يوجد زبائن لديهم بطاقات مطابقة.</p>
        )}
      </div>
      <div className="mt-3 flex justify-center gap-4 text-sm">
        <button disabled={loading || page === 1} onClick={() => setPage(page - 1)}>
          السابق
        </button>
        <span>صفحة {page}</span>
        <button disabled={loading || page * 50 >= data.total} onClick={() => setPage(page + 1)}>
          التالي
        </button>
      </div>
      {entry && (
        <FastCardEntryModal
          people={data.people}
          currencies={currencies}
          onClose={() => setEntry(false)}
          onSaved={() => {
            setEntry(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
