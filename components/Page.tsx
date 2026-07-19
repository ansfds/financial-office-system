import Shell from './Shell';

export default function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-950 dark:text-white">{title}</h1>
      </div>
      {children}
    </Shell>
  );
}
