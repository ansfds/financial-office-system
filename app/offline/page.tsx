export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f8fb] px-5 text-slate-900 dark:bg-[#071426] dark:text-slate-100">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 text-center shadow-card dark:border-blue-900/60 dark:bg-[#0d1d33]">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg bg-red-50 text-2xl font-black text-red-600 dark:bg-red-950 dark:text-red-200">
          !
        </div>
        <h1 className="text-xl font-black">لا يوجد اتصال بالإنترنت</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-slate-300">
          آخر بيانات زبون أو بطاقة فتحتها ستظهر من الكاش المحلي داخل صفحة الزبائن عند توفرها.
        </p>
      </section>
    </main>
  );
}
