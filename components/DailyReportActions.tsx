'use client';

import { Download, Printer } from 'lucide-react';

export default function DailyReportActions() {
  function printReport() {
    window.print();
  }

  return (
    <>
      <button
        type="button"
        onClick={printReport}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <Printer size={18} />
        طباعة
      </button>
      <button
        type="button"
        onClick={printReport}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500"
      >
        <Download size={18} />
        تحميل PDF
      </button>
    </>
  );
}
