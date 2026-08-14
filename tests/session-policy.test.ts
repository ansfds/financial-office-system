import { describe, expect, it } from 'vitest';
import {
  SESSION_INACTIVITY_MINUTES,
  isSessionInactive,
  nextSessionExpiry,
  sessionInactivityMs,
  shouldTouchSession,
  shouldWarnForInactiveSession,
} from '@/lib/session-policy';

describe('session inactivity policy', () => {
  const start = new Date('2026-08-14T10:00:00.000Z');

  it('keeps an active session alive before 30 minutes of inactivity', () => {
    const now = new Date(start.getTime() + 29 * 60_000);
    expect(SESSION_INACTIVITY_MINUTES).toBe(30);
    expect(isSessionInactive(start, now)).toBe(false);
  });

  it('expires exactly at 30 minutes of inactivity', () => {
    const now = new Date(start.getTime() + sessionInactivityMs());
    expect(isSessionInactive(start, now)).toBe(true);
  });

  it('warns after 25 minutes and before expiry', () => {
    expect(shouldWarnForInactiveSession(start, new Date(start.getTime() + 24 * 60_000))).toBe(false);
    expect(shouldWarnForInactiveSession(start, new Date(start.getTime() + 25 * 60_000))).toBe(true);
    expect(shouldWarnForInactiveSession(start, new Date(start.getTime() + 30 * 60_000))).toBe(false);
  });

  it('extends expiry from the latest real activity', () => {
    const activityAt = new Date(start.getTime() + 10 * 60_000);
    expect(nextSessionExpiry(activityAt).getTime()).toBe(activityAt.getTime() + sessionInactivityMs());
  });

  it('throttles routine touches while allowing forced important activity', () => {
    expect(shouldTouchSession(start, new Date(start.getTime() + 60_000))).toBe(false);
    expect(shouldTouchSession(start, new Date(start.getTime() + 4 * 60_000))).toBe(true);
    expect(shouldTouchSession(start, new Date(start.getTime() + 60_000), true)).toBe(true);
  });
});
