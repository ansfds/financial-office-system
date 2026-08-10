'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import {
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import ThemeSwitcher from './ThemeSwitcher';

const logoUrl = 'https://i.postimg.cc/k4nQr4gx/680242520-122094061526346951-872670812110961262-n.jpg';

const items = [
  ['/dashboard', 'الصفحة الرئيسية', LayoutDashboard],
  ['/people', 'الزبائن والبطاقات', Users],
  ['/accounts', 'لنا وعلينا', Wallet],
  ['/audit', 'سجل العمليات', ShieldCheck],
  ['/settings', 'الإعدادات', Settings],
] as const;

const primaryItems = items.slice(0, 3);

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => null);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      {open ? (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          className="sheet-backdrop fixed inset-0 z-30 bg-slate-950/45 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 right-0 z-40 flex w-[min(20rem,calc(100vw-1rem))] flex-col border-l border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 ${
          open ? 'translate-x-0' : 'translate-x-full'
        } drawer-panel transition-transform lg:w-72 lg:translate-x-0`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mb-3 inline-flex w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-200 lg:hidden"
          aria-label="إغلاق القائمة"
        >
          <X size={20} />
        </button>
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="شعار شركة الوسيط العالمي" className="h-12 w-12 rounded-lg object-cover" />
            <div>
              <div className="text-sm font-black leading-6">منظومة الوسيط</div>
              <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                إدارة الزبائن والبطاقات والحسابات
              </div>
            </div>
          </div>
        </div>

        <ThemeSwitcher />

        <nav className="stagger-list mt-5 flex-1 space-y-1 overflow-y-auto pb-4">
          {items.map(([href, label, Icon]) => {
            const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                style={{ '--stagger': items.findIndex((item) => item[0] === href) } as CSSProperties}
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

      <nav className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-2 pt-2 shadow-[0_-12px_34px_rgba(15,23,42,0.12)] backdrop-blur dark:border-blue-900/60 dark:bg-[#08172a]/95 lg:hidden">
        <div className="grid grid-cols-4 gap-1">
          {primaryItems.map(([href, label, Icon]) => {
            const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-black ${
                  active
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-blue-950 dark:text-blue-200'
                    : 'text-slate-500 dark:text-slate-300'
                }`}
              >
                <Icon size={18} />
                <span className="max-w-full truncate">{label.replace('الصفحة ', '')}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-black ${
              ['/audit', '/settings'].some((href) => pathname.startsWith(href))
                ? 'bg-indigo-50 text-indigo-700 dark:bg-blue-950 dark:text-blue-200'
                : 'text-slate-500 dark:text-slate-300'
            }`}
          >
            <MoreHorizontal size={18} />
            <span>المزيد</span>
          </button>
        </div>
      </nav>

      <main className="page-enter min-h-screen px-3 pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-4 sm:px-4 lg:mr-72 lg:p-8">
        {children}
      </main>
    </div>
  );
}
