import { afterEach, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import { cardMoneyGroups, cardStatusLabels } from '@/lib/card-display';
import { normalizePhone } from '@/lib/person-input';
import {
  canReset,
  sameOrigin,
  resetPasswordMatches,
  createResetChallenge,
  readResetChallenge,
} from '@/lib/reset-security';
import { dailyNoteSchema, dailyNoteUpdateSchema } from '@/lib/daily-notes';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe('customer financial presentation', () => {
  it('keeps payment currencies separate and omits cancelled obligations', () => {
    const rows = cardMoneyGroups([
      { agreedAmount: 1800, settlementCurrency: { code: 'USD' } },
      { agreedAmount: 7200, settlementCurrency: { code: 'LYD' } },
      { agreedAmount: 200, settlementCurrency: { code: 'USD' } },
      { agreedAmount: 1000, status: 'CANCELLED', settlementCurrency: { code: 'LYD' } },
    ]);
    expect(rows.find((r) => r.code === 'USD')?.agreed).toBe(2000);
    expect(rows.find((r) => r.code === 'LYD')?.agreed).toBe(7200);
    expect(cardStatusLabels.SETTLED).toBe('مصفاة');
    expect(cardStatusLabels.PAYMENT_FAILED).toBe('فشل الدفع');
  });
  it('recognizes formatted and Arabic phone digits', () => {
    expect(normalizePhone('٠٩١ ١٢٣-٤٥٦٧')).toBe('0911234567');
    expect(normalizePhone('00218 91-123')).toBe('21891123');
  });
});
describe('reset authorization and signed confirmation', () => {
  it('fails closed without a configured administrator', () => {
    vi.stubEnv('RESET_ADMIN_USERNAMES', '');
    expect(canReset('ANS')).toBe(false);
    vi.stubEnv('RESET_ADMIN_USERNAMES', ' ANS, Mohammed ');
    expect(canReset('ANS')).toBe(true);
    expect(canReset('Hossam')).toBe(false);
  });
  it('accepts only the actual same-origin request', () => {
    expect(
      sameOrigin(
        new Request('http://localhost:3000/api/admin/reset-system', {
          headers: { Origin: 'http://localhost:3000' },
        }),
      ),
    ).toBe(true);
    expect(
      sameOrigin(
        new Request('http://localhost:3000/api/admin/reset-system', {
          headers: { Origin: 'https://attacker.invalid' },
        }),
      ),
    ).toBe(false);
    expect(sameOrigin(new Request('http://localhost:3000/api/admin/reset-system'))).toBe(false);
  });
  it('binds final confirmation to its session, signature and five-minute expiry', () => {
    vi.stubEnv('SESSION_SECRET', 'test-session-signing-secret');
    vi.useFakeTimers();
    const token = createResetChallenge('session-a');
    expect(readResetChallenge(token, 'session-a')).toBeTruthy();
    expect(readResetChallenge(token, 'session-b')).toBeNull();
    expect(readResetChallenge(token + 'tampered', 'session-a')).toBeNull();
    vi.advanceTimersByTime(300001);
    expect(readResetChallenge(token, 'session-a')).toBeNull();
  });
  it('prefers Argon2 over a legacy plaintext environment secret', async () => {
    vi.stubEnv('RESET_PASSWORD_HASH', await argon2.hash('test-only-password'));
    vi.stubEnv('RESET_SYSTEM_PASSWORD', 'legacy-test');
    expect(await resetPasswordMatches('test-only-password')).toBe(true);
    expect(await resetPasswordMatches('legacy-test')).toBe(false);
    expect(await resetPasswordMatches('wrong')).toBe(false);
  });
});
describe('daily notes validation', () => {
  it('requires a title and a version for updates', () => {
    expect(dailyNoteSchema.safeParse({ title: ' ', content: 'text' }).success).toBe(false);
    expect(dailyNoteSchema.safeParse({ title: 'متابعة', content: 'محتوى' }).success).toBe(true);
    expect(dailyNoteUpdateSchema.safeParse({ title: 'متابعة', content: 'محتوى' }).success).toBe(false);
  });
});
