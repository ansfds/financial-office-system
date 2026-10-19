'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV === 'development') {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
      if ('caches' in window)
        void caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys.filter((key) => key.startsWith('financial-office-')).map((key) => caches.delete(key)),
            ),
          );
      return;
    }

    function register() {
      navigator.serviceWorker.register('/sw.js').catch(() => null);
    }

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }

    return () => {
      window.removeEventListener('load', register);
    };
  }, []);

  return null;
}
