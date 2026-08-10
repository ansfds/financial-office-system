export default function RouteLoading() {
  return (
    <main className="min-h-screen px-3 pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-4 sm:px-4 lg:mr-72 lg:p-8">
      <div className="skeleton mb-4 h-7 w-44 md:mb-6 md:h-8 md:w-56" />
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="card p-3 md:p-5">
            <div className="skeleton h-4 w-20" />
            <div className="skeleton mt-4 h-8 w-24" />
          </div>
        ))}
      </div>
      <div className="card mt-5 p-4 md:mt-6 md:p-5">
        <div className="skeleton mb-4 h-5 w-40" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton h-14" />
          ))}
        </div>
      </div>
    </main>
  );
}
