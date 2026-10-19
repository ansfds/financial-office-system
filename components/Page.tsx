import Shell from './Shell';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function Page({ title, children }: { title: string; children: React.ReactNode }) {
  if (!(await getSession())) redirect('/login');

  return (
    <Shell>
      {process.env.LOCAL_REVIEW === 'true' && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          نسخة محلية للمراجعة — بيانات تجريبية مستقلة
        </p>
      )}
      <div className="mb-4 md:mb-6">
        <h1 className="text-xl font-black text-slate-950 dark:text-white md:text-2xl">{title}</h1>
      </div>
      {children}
    </Shell>
  );
}
