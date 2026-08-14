'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SESSION_INACTIVITY_MINUTES,
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_WARNING_AT_MINUTES,
  SESSION_WARNING_MINUTES,
  sessionInactivityMs,
  sessionWarningAtMs,
} from '@/lib/session-policy';

type SessionPayload = {
  authenticated?: boolean;
  expiresAt?: string | Date;
  lastActivityAt?: string | Date;
  serverNow?: string | Date;
  touchIntervalMs?: number;
};

function parseTime(value: unknown) {
  if (!value) return 0;
  const time = new Date(value as string | Date).getTime();
  return Number.isFinite(time) ? time : 0;
}

function localTimeFromServer(value: unknown, serverNow: unknown) {
  const serverValue = parseTime(value);
  const serverTime = parseTime(serverNow);
  if (!serverValue || !serverTime) return Date.now();
  return Date.now() - (serverTime - serverValue);
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function sameOriginApi(input: RequestInfo | URL) {
  try {
    const url = new URL(requestUrl(input), window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function sessionEndpoint(input: RequestInfo | URL) {
  try {
    const url = new URL(requestUrl(input), window.location.href);
    return url.origin === window.location.origin && url.pathname === '/api/auth/session';
  } catch {
    return false;
  }
}

function authEndpoint(input: RequestInfo | URL) {
  try {
    const url = new URL(requestUrl(input), window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/auth/');
  } catch {
    return false;
  }
}

export default function SessionActivity() {
  const pathname = usePathname();
  const router = useRouter();
  const [warningOpen, setWarningOpen] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(SESSION_WARNING_MINUTES * 60);
  const lastActivityRef = useRef(Date.now());
  const lastMouseMoveRef = useRef(0);
  const lastServerTouchRef = useRef(0);
  const touchInFlightRef = useRef(false);
  const expiredRef = useRef(false);
  const fetchRef = useRef<typeof window.fetch | null>(null);

  const syncFromSession = useCallback((payload: SessionPayload) => {
    if (!payload?.authenticated) return;
    lastActivityRef.current = localTimeFromServer(payload.lastActivityAt, payload.serverNow);
    lastServerTouchRef.current = Date.now();
    setWarningOpen(false);
  }, []);

  const expireSession = useCallback(() => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    setWarningOpen(false);

    const run = async () => {
      const fetcher = fetchRef.current || window.fetch.bind(window);
      await fetcher('/api/auth/logout?reason=inactive', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'inactive' }),
      }).catch(() => null);
      router.replace('/login?reason=inactive');
      router.refresh();
    };

    void run();
  }, [router]);

  const touchServer = useCallback(
    async (force = false) => {
      if (expiredRef.current || touchInFlightRef.current) return;
      const now = Date.now();
      if (!force && now - lastServerTouchRef.current < SESSION_TOUCH_INTERVAL_MS) return;

      touchInFlightRef.current = true;
      try {
        const fetcher = fetchRef.current || window.fetch.bind(window);
        const response = await fetcher(force ? '/api/auth/session?touch=1' : '/api/auth/session', {
          method: force ? 'POST' : 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
        });

        if (response.status === 401) {
          expireSession();
          return;
        }

        if (response.ok) {
          const payload = (await response.json().catch(() => null)) as SessionPayload | null;
          if (payload) syncFromSession(payload);
        }
      } finally {
        touchInFlightRef.current = false;
      }
    },
    [expireSession, syncFromSession],
  );

  const recordActivity = useCallback(
    (forceTouch = false) => {
      if (expiredRef.current) return;
      lastActivityRef.current = Date.now();
      setWarningOpen(false);
      void touchServer(forceTouch);
    },
    [touchServer],
  );

  useEffect(() => {
    recordActivity(true);
  }, [pathname, recordActivity]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch.bind(window);
    fetchRef.current = originalFetch;

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      if (sameOriginApi(input) && !sessionEndpoint(input)) {
        if (response.status === 401 && !authEndpoint(input)) expireSession();
        if (response.ok && !authEndpoint(input)) recordActivity(false);
      }
      return response;
    }) as typeof window.fetch;

    return () => {
      window.fetch = originalFetch;
      fetchRef.current = null;
    };
  }, [expireSession, recordActivity]);

  useEffect(() => {
    function handleActivity() {
      recordActivity(false);
    }

    function handleMouseMove() {
      const now = Date.now();
      if (now - lastMouseMoveRef.current < SESSION_TOUCH_INTERVAL_MS) return;
      lastMouseMoveRef.current = now;
      recordActivity(false);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') recordActivity(false);
    }

    window.addEventListener('pointerdown', handleActivity, { passive: true });
    window.addEventListener('touchstart', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('input', handleActivity);
    window.addEventListener('click', handleActivity, { passive: true });
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('input', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [recordActivity]);

  useEffect(() => {
    void touchServer(false);

    const handle = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      const remainingMs = Math.max(sessionInactivityMs() - idleMs, 0);
      setRemainingSeconds(Math.ceil(remainingMs / 1000));

      if (idleMs >= sessionInactivityMs()) {
        expireSession();
        return;
      }

      setWarningOpen(idleMs >= sessionWarningAtMs());
    }, 1000);

    return () => window.clearInterval(handle);
  }, [expireSession, touchServer]);

  if (!warningOpen || expiredRef.current) return null;

  const minutes = Math.max(1, Math.ceil(remainingSeconds / 60));

  return (
    <div className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[85] mx-auto max-w-md rounded-lg border border-amber-200 bg-amber-50 p-3 text-right text-amber-950 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50 sm:bottom-5">
      <div className="text-sm font-black">ستنتهي الجلسة بعد 5 دقائق بسبب عدم النشاط</div>
      <div className="mt-1 text-xs font-bold opacity-80">
        المتبقي تقريبًا {minutes} دقيقة. مدة الخمول المعتمدة {SESSION_INACTIVITY_MINUTES} دقيقة، ويظهر التحذير بعد {SESSION_WARNING_AT_MINUTES} دقيقة.
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          lastActivityRef.current = Date.now();
          setWarningOpen(false);
          void touchServer(true);
        }}
        className="mt-3 min-h-11 w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-black text-white hover:bg-amber-500"
      >
        استمرار الجلسة
      </button>
    </div>
  );
}
