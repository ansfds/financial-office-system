import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateTime } from '@/lib/format';

afterEach(() => vi.unstubAllEnvs());

describe('consistent date rendering on the server and in the browser', () => {
  it.each(['UTC', 'Africa/Tripoli', 'America/Los_Angeles', 'Asia/Tokyo'])(
    'uses the office date and time when the host runs in %s', zone => {
      vi.stubEnv('TZ', zone);
      // It is already the next day in Tripoli; UTC and the browser must render identical text.
      const timestamp = '2026-10-19T22:30:00Z';
      expect(formatDateTime(timestamp)).toBe('20/10/2026, 00:30:00');
      expect(formatDate(new Date(timestamp))).toBe('20/10/2026');
    },
  );
});
