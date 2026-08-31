'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { CSSProperties, PointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import ThemeSwitcher from './ThemeSwitcher';
import SessionActivity from './SessionActivity';
import { reduceMobileDrawerState, shouldCloseMobileDrawerFromDrag } from '@/lib/mobile-nav-drawer';

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen((open) => reduceMobileDrawerState(open, { type: 'close' }));
  }, []);

  const openMobileMenu = useCallback(() => {
    setMobileMenuOpen((open) => reduceMobileDrawerState(open, { type: 'open' }));
  }, []);

  useEffect(() => {
    setMobileMenuOpen((open) => reduceMobileDrawerState(open, { type: 'route-change' }));
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMobileMenuOpen((open) => reduceMobileDrawerState(open, { type: 'escape' }));
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  function handleDrawerPointerDown(event: PointerEvent<HTMLElement>) {
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
  }

  function handleDrawerPointerEnd(event: PointerEvent<HTMLElement>) {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start) return;

    const deltaX = event.clientX - start.x;
    const deltaY = Math.abs(event.clientY - start.y);
    if (shouldCloseMobileDrawerFromDrag(deltaX, deltaY)) closeMobileMenu();
  }

  async function logout() {
    closeMobileMenu();
    await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => null);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <button
        type="button"
        aria-label="إغلاق القائمة"
        aria-hidden={!mobileMenuOpen}
        tabIndex={mobileMenuOpen ? 0 : -1}
        className={`fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-sm transition-opacity duration-200 ease-out lg:hidden ${
          mobileMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={(event) => {
          event.stopPropagation();
          closeMobileMenu();
        }}
      />

      <aside
        id="mobile-navigation-drawer"
        data-mobile-menu-open={mobileMenuOpen ? 'true' : 'false'}
        onPointerDown={handleDrawerPointerDown}
        onPointerUp={handleDrawerPointerEnd}
        onPointerCancel={() => {
          dragStart.current = null;
        }}
        className={`drawer-panel fixed inset-y-0 right-0 z-50 flex w-[min(20rem,calc(100vw-1rem))] touch-pan-y flex-col border-l border-slate-200 bg-white/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl backdrop-blur transition-[transform,opacity] duration-200 ease-out dark:border-slate-800 dark:bg-slate-950/95 ${
          mobileMenuOpen ? 'pointer-events-auto translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'
        } lg:pointer-events-auto lg:w-72 lg:translate-x-0 lg:opacity-100 lg:transition-none`}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            closeMobileMenu();
          }}
          className="relative z-10 mb-3 inline-flex min-h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-200 lg:hidden"
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
          {items.map(([href, label, Icon], index) => {
            const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={closeMobileMenu}
                style={{ '--stagger': index } as CSSProperties}
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
                onClick={closeMobileMenu}
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
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-drawer"
            onClick={(event) => {
              event.stopPropagation();
              openMobileMenu();
            }}
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
      <SessionActivity />
    </div>
  );
}
