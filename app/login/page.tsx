'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { ALLOWED_USERNAMES, type AllowedUsername } from '@/lib/users';

const logoUrl = 'https://i.postimg.cc/k4nQr4gx/680242520-122094061526346951-872670812110961262-n.jpg';

export default function Login() {
  const router = useRouter();
  const [username, setUsername] = useState<AllowedUsername>('Mohammed');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!cancelled && response.ok) {
          router.replace('/dashboard');
          router.refresh();
          return;
        }
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    }

    checkSession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!username || !password) {
      setError('أدخل اسم المستخدم وكلمة المرور للمتابعة.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(payload.error || 'تعذر تسجيل الدخول. تحقق من اسم المستخدم وكلمة المرور.');
        return;
      }

      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم. تأكد من تشغيل المشروع ثم حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <section className="grid w-full overflow-hidden rounded-lg border border-white/10 bg-white shadow-2xl shadow-slate-950/30 md:grid-cols-[1fr_1.05fr]">
          <div className="hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-10 text-white md:flex md:flex-col md:justify-between">
            <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-4 py-2 text-sm text-white/80">
              <ShieldCheck size={18} />
              دخول آمن للنظام
            </div>

            <div className="space-y-5">
              <img src={logoUrl} alt="شعار شركة الوسيط العالمي" className="h-16 w-16 rounded-lg object-cover shadow-lg" />
              <div>
                <h1 className="text-3xl font-black leading-tight">
                  منظومة محاسبة
                  <span className="block text-xl text-indigo-200">شركة الوسيط العالمي للحوالات المالية</span>
                </h1>
                <p className="mt-3 max-w-sm text-sm leading-7 text-slate-300">
                  إدارة المعاملات، الصندوق، المخزن، الزبائن، والتقارير من لوحة واحدة واضحة.
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-400">يتم التحقق من بيانات الدخول عبر الخادم فقط ولا تحفظ كلمة المرور كنص عادي.</p>
          </div>

          <div className="bg-slate-50 px-5 py-8 text-slate-950 sm:px-8 md:px-10 md:py-12">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-8 text-center md:hidden">
                <img src={logoUrl} alt="شعار شركة الوسيط العالمي" className="mx-auto mb-4 h-14 w-14 rounded-lg object-cover" />
                <h1 className="text-2xl font-black">منظومة محاسبة</h1>
                <p className="mt-1 text-xs font-bold text-slate-500">شركة الوسيط العالمي للحوالات المالية</p>
              </div>

              <div className="mb-8">
                <p className="text-sm font-bold text-indigo-700">تسجيل الدخول</p>
                <h2 className="mt-2 text-2xl font-black tracking-normal text-slate-950">أدخل بيانات المستخدم</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {checkingSession ? 'يتم التحقق من الجلسة الحالية...' : 'استخدم اسم المستخدم وكلمة المرور للانتقال إلى لوحة التحكم.'}
                </p>
              </div>

              <form onSubmit={submit} className="space-y-5" noValidate>
                <div>
                  <label htmlFor="username" className="mb-2 block text-sm font-bold text-slate-700">
                    اسم المستخدم
                  </label>
                  <select
                    id="username"
                    dir="ltr"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value as AllowedUsername);
                      if (error) setError('');
                    }}
                    autoComplete="username"
                    disabled={loading}
                    className="h-12 rounded-lg border-slate-300 bg-white px-4 text-center text-base font-semibold text-slate-950 shadow-sm focus:border-indigo-500 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    {ALLOWED_USERNAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-bold text-slate-700">
                    كلمة المرور
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      dir="ltr"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (error) setError('');
                      }}
                      autoComplete="current-password"
                      autoFocus
                      className="h-12 rounded-lg border-slate-300 bg-white pl-12 pr-4 text-center text-lg font-semibold text-slate-950 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                      placeholder="كلمة المرور"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed"
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      disabled={loading}
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-base font-bold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-400"
                >
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      جار التحقق...
                    </>
                  ) : (
                    'دخول'
                  )}
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
