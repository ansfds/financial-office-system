'use client';

import { useEffect, useState } from 'react';

type SyncEvent = CustomEvent<{ syncing?: boolean }>;

export default function NetworkStatusIndicator() {
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showOnlinePulse, setShowOnlinePulse] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);

    function handleOnline() {
      setOnline(true);
      setShowOnlinePulse(true);
      window.setTimeout(() => setShowOnlinePulse(false), 2600);
    }

    function handleOffline() {
      setOnline(false);
      setShowOnlinePulse(false);
    }

    function handleSync(event: Event) {
      setSyncing(Boolean((event as SyncEvent).detail?.syncing));
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('financial-office-sync', handleSync);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('financial-office-sync', handleSync);
    };
  }, []);

  if (online && !syncing && !showOnlinePulse) return null;

  const state = !online ? 'offline' : syncing ? 'syncing' : 'online';
  const label = !online ? 'بدون إنترنت' : syncing ? 'جاري المزامنة' : 'متصل';

  return (
    <div className={`network-status network-status--${state}`} role="status" aria-live="polite">
      <span aria-hidden="true" />
      {label}
    </div>
  );
}
