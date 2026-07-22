'use client';

import RouteError from '@/components/RouteError';

export default function PeopleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError reset={reset} />;
}
