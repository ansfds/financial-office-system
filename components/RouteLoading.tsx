export default function RouteLoading() {
  return (
    <main className="min-h-screen p-4 pt-16 lg:mr-72 lg:p-8">
      <div className="mb-6 h-8 w-56 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="card p-5">
            <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            <div className="mt-4 h-8 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        ))}
      </div>
      <div className="card mt-6 p-5">
        <div className="mb-4 h-5 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      </div>
    </main>
  );
}
