import { beforeEach, describe, expect, it } from 'vitest';
import { assistantIntentSchema, isAssistantWriteIntent, type AssistantPreview } from '@/lib/smart-assistant/schema';
import { createAssistantConfirmationToken, verifyAssistantConfirmationToken } from '@/lib/smart-assistant/security';
import { checkAssistantRateLimit, resetAssistantRateLimitForTests } from '@/lib/smart-assistant/rate-limit';

const intent = {
  type: 'ADD_WALLET_SETTLEMENT',
  customerCode: '#M0002',
  accountType: 'DEBT',
  direction: 'ADD',
  amount: 40,
  currencyCode: 'USD',
  paymentMethod: 'USD_CASH',
  reason: 'اختبار',
  movementKind: 'ADJUSTMENT',
  effectMode: 'NORMAL',
} as const;

const preview: AssistantPreview = {
  idempotencyKey: 'idem-test',
  action: 'ADD_WALLET_SETTLEMENT',
  actionLabel: 'إضافة حركة لنا وعلينا',
  originalCommand: 'أضف لنا 40 دولار على #M0002',
  customer: { id: 'person-1', code: '#M0002', name: 'زبون اختبار' },
  amount: { value: '40', currencyCode: 'USD', paymentMethod: 'USD_CASH' },
  balances: [{ label: 'إجمالي لنا', before: '0', after: '40', currencyCode: 'USD' }],
  lines: [{ label: 'المبلغ', value: '40 USD' }],
  warnings: [],
  missingFields: [],
  intent,
};

describe('smart assistant safety helpers', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-for-smart-assistant';
    resetAssistantRateLimitForTests();
  });

  it('accepts only bounded assistant intents and detects write intents', () => {
    const parsed = assistantIntentSchema.parse(intent);
    expect(isAssistantWriteIntent(parsed)).toBe(true);

    expect(
      assistantIntentSchema.safeParse({
        type: 'RUN_SQL',
        sql: 'delete from users',
      }).success,
    ).toBe(false);
  });

  it('signs confirmation previews and rejects tampered or expired tokens', () => {
    const token = createAssistantConfirmationToken({
      version: 1,
      idempotencyKey: preview.idempotencyKey,
      originalCommand: preview.originalCommand,
      intent,
      preview,
      sessionId: 'session-1',
      expiresAt: Date.now() + 60_000,
    });

    expect(verifyAssistantConfirmationToken(token, 'session-1').preview.action).toBe('ADD_WALLET_SETTLEMENT');
    expect(() => verifyAssistantConfirmationToken(`${token.slice(0, -3)}abc`, 'session-1')).toThrow(
      'INVALID_ASSISTANT_CONFIRMATION',
    );

    const expired = createAssistantConfirmationToken({
      version: 1,
      idempotencyKey: preview.idempotencyKey,
      originalCommand: preview.originalCommand,
      intent,
      preview,
      sessionId: 'session-1',
      expiresAt: Date.now() - 1,
    });

    expect(() => verifyAssistantConfirmationToken(expired, 'session-1')).toThrow('INVALID_ASSISTANT_CONFIRMATION');
  });

  it('limits repeated assistant requests per bucket', () => {
    expect(checkAssistantRateLimit('u1', { limit: 2, windowMs: 60_000 }).allowed).toBe(true);
    expect(checkAssistantRateLimit('u1', { limit: 2, windowMs: 60_000 }).allowed).toBe(true);
    const blocked = checkAssistantRateLimit('u1', { limit: 2, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
