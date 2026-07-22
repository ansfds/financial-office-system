'use client';

import RouteError from '@/components/RouteError';

export default function TransactionsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError reset={reset} />;
}
