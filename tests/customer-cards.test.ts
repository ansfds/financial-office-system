import { describe, expect, it } from 'vitest';
import {
  cardBaseAmount,
  cardOperationAmount,
  cardProgressPercent,
  cardRemainingAmount,
  cardStatusForBalance,
  cardStatusForStage,
  clampCardStage,
  defaultCardDiscountCategories,
  nextCardStage,
} from '@/lib/customer-cards';

describe('customer card helpers', () => {
  it('clamps card stages to the supported workflow range', () => {
    expect(clampCardStage(-4)).toBe(0);
    expect(clampCardStage(3.8)).toBe(3);
    expect(clampCardStage(99)).toBe(5);
  });

  it('moves cards forward and backward one stage at a time', () => {
    expect(nextCardStage(0, 'NEXT')).toBe(1);
    expect(nextCardStage(5, 'NEXT')).toBe(5);
    expect(nextCardStage(2, 'PREVIOUS')).toBe(1);
    expect(nextCardStage(0, 'PREVIOUS')).toBe(0);
  });

  it('maps stages to the Arabic workflow statuses without overriding cancelled cards', () => {
    expect(cardStatusForStage(0)).toBe('RECEIVED');
    expect(cardStatusForStage(2)).toBe('IN_SETTLEMENT');
    expect(cardStatusForStage(5)).toBe('SETTLED');
    expect(cardStatusForStage(5, 'CANCELLED')).toBe('CANCELLED');
  });

  it('uses only the original card value for remaining and progress math', () => {
    expect(cardBaseAmount(100, 80).toString()).toBe('100');
    expect(cardBaseAmount(0, 80).toString()).toBe('0');
    expect(cardRemainingAmount(100, 80, 35).toString()).toBe('65');
    expect(cardRemainingAmount(100, 80, 130).toString()).toBe('0');
  });

  it('keeps agreed amount separate from card draw progress', () => {
    expect(cardProgressPercent(cardBaseAmount(2000, 1800), 476).toString()).toBe('23.8');
    expect(cardProgressPercent(cardBaseAmount(2000, 1700), 476).toString()).toBe('23.8');
    expect(cardRemainingAmount(2000, 1800, 476).toString()).toBe('1524');
    expect(cardRemainingAmount(2000, 1800, 952).toString()).toBe('1048');
    expect(cardProgressPercent(2000, 952).toString()).toBe('47.6');
  });

  it('keeps special original values and non-deduction operations predictable', () => {
    expect(cardRemainingAmount(440, 440, 292).toString()).toBe('148');
    expect(cardOperationAmount({ operationType: 'REJECT', amount: 500 }).toString()).toBe('0');
    expect(cardProgressPercent(2000, 2000).toString()).toBe('100');
  });

  it('calculates gift-card deductions from the configured category and quantity', () => {
    const category = defaultCardDiscountCategories.find((item) => item.code === '100');
    expect(cardOperationAmount({ operationType: 'GIFT_CARD', quantity: 2, category }).toString()).toBe('202');
  });

  it('uses invoice amount and full remaining amount for final settlement', () => {
    expect(cardOperationAmount({ operationType: 'INVOICE', amount: 42 }).toString()).toBe('42');
    expect(cardOperationAmount({ operationType: 'FINAL_SETTLEMENT', currentRemaining: 58 }).toString()).toBe('58');
  });

  it('calculates progress and balance status from deducted amounts', () => {
    expect(cardProgressPercent(2000, 476).toString()).toBe('23.8');
    expect(cardProgressPercent(500, 250).toString()).toBe('50');
    expect(cardProgressPercent(500, 900).toString()).toBe('100');
    expect(cardStatusForBalance(500, 0)).toBe('RECEIVED');
    expect(cardStatusForBalance(500, 101)).toBe('IN_SETTLEMENT');
    expect(cardStatusForBalance(500, 500)).toBe('SETTLED');
  });

  it('requires a configured category for gift-card operations', () => {
    expect(() => cardOperationAmount({ operationType: 'GIFT_CARD', quantity: 1, category: null })).toThrow(
      'CARD_CATEGORY_NOT_FOUND',
    );
  });
});
