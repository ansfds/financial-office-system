import Shell from './Shell';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function Page({ title, children }: { title: string; children: React.ReactNode }) {
  if (!(await getSession())) redirect('/login');

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-950 dark:text-white">{title}</h1>
      </div>
      {children}
    </Shell>
  );
}
