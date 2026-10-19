import { describe, expect, it } from 'vitest';
import { cardState, summarizeCardStates, cardStateDefinitions } from '@/lib/card-states';
import { withdrawalSlots, withdrawalBoxStatus } from '@/lib/card-withdrawals';
import { customerInteractionDates } from '@/lib/customer-timeline';
describe('shared card states', () => {
  it('maps all legacy states into the same six ordered groups without losing totals', () => {
    const counts = summarizeCardStates([
      { status: 'RECEIVED', _count: 2 },
      { status: 'IN_SETTLEMENT', _count: 3 },
      { status: 'PARTIAL', _count: 1 },
      { status: 'SETTLED', _count: 7 },
      { status: 'COMPLETED', _count: 3 },
      { status: 'CANCELLED' },
      { status: 'PAYMENT_FAILED', _count: 2 },
      { status: 'INSUFFICIENT_BALANCE' },
    ]);
    expect(counts).toEqual({
      NEW: 2,
      IN_PROGRESS: 4,
      CLEARED: 10,
      CANCELLED: 1,
      PAYMENT_FAILED: 2,
      INSUFFICIENT_BALANCE: 1,
      total: 20,
    });
    expect(cardStateDefinitions.map((s) => s.key)).toEqual([
      'NEW',
      'IN_PROGRESS',
      'CLEARED',
      'CANCELLED',
      'PAYMENT_FAILED',
      'INSUFFICIENT_BALANCE',
    ]);
    expect(cardState('COMPLETED')).toBe('CLEARED');
  });
});
describe('persisted withdrawal boxes', () => {
  it('preserves existing stage progress when there are no checkbox records', () => {
    expect(withdrawalSlots({ currentStage: 3 })).toEqual([true, true, true, false, false]);
    expect(withdrawalSlots({ currentStage: 0 })).toEqual([false, false, false, false, false]);
  });
  it('replays explicit per-box records, including unchecking, independently of stored stage', () => {
    expect(
      withdrawalSlots({
        currentStage: 5,
        stageLogs: [
          { stage: 1, direction: 'WITHDRAWAL_ON', createdAt: '2026-10-19T10:00:00Z' },
          { stage: 3, direction: 'WITHDRAWAL_ON', createdAt: '2026-10-19T10:00:01Z' },
          { stage: 1, direction: 'WITHDRAWAL_OFF', createdAt: '2026-10-19T10:00:02Z' },
          { stage: 5, direction: 'NEXT', createdAt: '2026-10-19T10:00:03Z' },
        ],
      }),
    ).toEqual([false, false, true, false, false]);
  });
  it('clears on five and returns to progress when a box is unchecked', () => {
    expect(withdrawalBoxStatus([true, true, true, true, true], 'IN_SETTLEMENT')).toBe('SETTLED');
    expect(withdrawalBoxStatus([true, true, false, true, true], 'SETTLED')).toBe('IN_SETTLEMENT');
    expect(withdrawalBoxStatus([false, false, false, false, false], 'SETTLED')).toBe('RECEIVED');
  });
  it.each(['CANCELLED', 'PAYMENT_FAILED', 'INSUFFICIENT_BALANCE'])(
    'preserves the priority of %s even at five',
    (status) => {
      expect(withdrawalBoxStatus([true, true, true, true, true], status)).toBe(status);
    },
  );
});
describe('customer interaction dates', () => {
  it('uses actual events for the first interaction and card updates for the last', () => {
    const dates = customerInteractionDates({
      createdAt: '2026-10-19T10:00:00Z',
      transactions: [{ transactionAt: '2026-10-01T12:00:00Z' }],
      cardBatches: [{ receivedAt: '2026-10-02T12:00:00Z', cards: [{ updatedAt: '2026-10-18T12:00:00Z' }] }],
      walletSettlements: [{ occurredAt: '2026-10-15T12:00:00Z' }],
    });
    expect(dates.first.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(dates.last.toISOString()).toBe('2026-10-18T12:00:00.000Z');
  });
});
