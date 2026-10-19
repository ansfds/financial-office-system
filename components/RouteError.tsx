'use client';

import { RefreshCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorDetails, newErrorId, safeErrorId } from '@/lib/error-info';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const details = errorDetails(error);
  const [generatedId] = useState(() => newErrorId(details));
  const errorId = safeErrorId(error) || generatedId;
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') console.error(error);
  }, [error]);
  return (
    <main className="min-h-screen p-4 pt-16 lg:mr-72 lg:p-8">
      <div className="card mx-auto max-w-2xl p-6 text-center">
        <h1 className="text-xl font-black text-slate-950 dark:text-white">تعذر تحميل الصفحة</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          {details.message}
        </p>
        <p className="mt-2 text-xs text-slate-500">خطأ رقم: <bdi dir="ltr">{errorId}</bdi></p>
        {details.kind === 'AUTH' && <a href="/login" className="mt-3 inline-block font-bold text-indigo-600">تسجيل الدخول</a>}
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 font-bold text-white hover:bg-indigo-500"
        >
          <RefreshCcw size={18} />
          إعادة المحاولة
        </button>
      </div>
    </main>
  );
}
