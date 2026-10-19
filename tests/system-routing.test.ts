import { describe, expect, it } from 'vitest';
import { canonicalAppPath } from '@/lib/app-paths';

describe('saved route compatibility after making the system the root app', () => {
  it.each([
    ['/dashboard', '/'],
    ['/dashboard?accountingPeriod=today', '/?accountingPeriod=today'],
    ['/people', '/customers'],
    ['/people/customer-id?tab=history', '/customers/customer-id?tab=history'],
    ['/accounts?currency=USD', '/finance?currency=USD'],
    ['/api/people/customer-id', '/api/people/customer-id'],
    ['/cards/customer-id', '/cards/customer-id'],
  ])('maps historical invalidation %s to %s without changing API routes', (before, after) => {
    expect(canonicalAppPath(before)).toBe(after);
  });
});
