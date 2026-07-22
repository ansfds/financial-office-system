'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Archive,
  BarChart3,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  Receipt,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import ThemeSwitcher from './ThemeSwitcher';

const logoUrl = 'https://i.postimg.cc/k4nQr4gx/680242520-122094061526346951-872670812110961262-n.jpg';

const items = [
  ['/dashboard', 'لوحة التحكم', LayoutDashboard],
  ['/people', 'الزبائن', Users],
  ['/new-transaction', 'إضافة معاملة', PlusCircle],
  ['/transactions', 'المعاملات', Receipt],
  ['/inventory', 'المخزن', Archive],
  ['/cashbox', 'الصندوق', Wallet],
  ['/reports', 'التقارير', BarChart3],
  ['/audit', 'سجل التعديلات', ShieldCheck],
  ['/trash', 'المحذوفات', Trash2],
  ['/settings', 'الإعدادات', Settings],
] as const;

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => null);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed right-4 top-4 z-50 rounded-lg bg-indigo-600 p-2 text-white shadow-lg lg:hidden"
        aria-label="فتح القائمة"
      >
        {open ? <X /> : <Menu />}
      </button>

      <aside
        className={`fixed inset-y-0 right-0 z-40 flex w-72 flex-col border-l border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 ${
          open ? 'translate-x-0' : 'translate-x-full'
        } transition-transform lg:translate-x-0`}
      >
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="شعار شركة الوسيط العالمي" className="h-12 w-12 rounded-lg object-cover" />
            <div>
              <div className="text-sm font-black leading-6">منظومة محاسبة</div>
              <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                شركة الوسيط العالمي للحوالات المالية
              </div>
            </div>
          </div>
        </div>

        <ThemeSwitcher />

        <nav className="mt-5 flex-1 space-y-1 overflow-y-auto pb-4">
          {items.map(([href, label, Icon]) => {
            const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold ${
                  active
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
                }`}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={logout}
          className="flex items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-200"
        >
          <LogOut size={18} />
          تسجيل الخروج
        </button>
      </aside>

      {open ? (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <main className="page-enter min-h-screen p-4 pt-16 lg:mr-72 lg:p-8">{children}</main>
    </div>
  );
}
