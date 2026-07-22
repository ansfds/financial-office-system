'use client';

import { RefreshCcw } from 'lucide-react';

export default function RouteError({ reset }: { reset: () => void }) {
  return (
    <main className="min-h-screen p-4 pt-16 lg:mr-72 lg:p-8">
      <div className="card mx-auto max-w-2xl p-6 text-center">
        <h1 className="text-xl font-black text-slate-950 dark:text-white">تعذر تحميل الصفحة</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          حدث خطأ أثناء قراءة البيانات. حاول تحديث الصفحة، وإن استمرت المشكلة سجل الخروج ثم ادخل من جديد.
        </p>
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
