'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { invalidateFinanceClient } from '@/lib/client-cache';
export default function FinanceSyncObserver() {
  const router = useRouter();
  useEffect(() => {
    const original = window.fetch;
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 100);
    }
    window.fetch = async (...args) => {
      const response = await original(...args);
      const [input, options] = args;
      const method = options?.method || (input instanceof Request ? input.method : 'GET');
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      if (
        response.ok &&
        url.origin === location.origin &&
        url.pathname.startsWith('/api/') &&
        !url.pathname.startsWith('/api/auth/') &&
        !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
      ) {
        await invalidateFinanceClient();
      }
      return response;
    };
    window.addEventListener('financial-office-changed', refresh);
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('financial-office-changes') : null;
    if (channel)
      channel.onmessage = () => {
        void invalidateFinanceClient(false);
      };
    function visible() {
      if (document.visibilityState === 'visible') refresh();
    }
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.fetch = original;
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener('financial-office-changed', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [router]);
  return null;
}
