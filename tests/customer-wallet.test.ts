import { describe, expect, it } from 'vitest';
import {
  buildWalletSnapshot,
  recalculateSettlementBalances,
  walletAccountAmount,
} from '@/lib/customer-wallet';

const usd = { id: 'usd', code: 'USD', name: 'Dollar', symbol: '$' };
const lyd = { id: 'lyd', code: 'LYD', name: 'Dinar', symbol: 'د.ل' };
const currencies = [usd, lyd];

describe('customer wallet helpers', () => {
  it('keeps currencies independent for لنا وعلينا', () => {
    const settlements = [
      {
        personId: 'person-1',
        currencyId: usd.id,
        currency: usd,
        paymentMethod: 'USD_CASH',
        accountType: 'DEBT' as const,
        direction: 'ADD' as const,
        amount: 100,
      },
      {
        personId: 'person-1',
        currencyId: lyd.id,
        currency: lyd,
        paymentMethod: 'LYD_CASH',
        accountType: 'CREDIT' as const,
        direction: 'ADD' as const,
        amount: 70,
      },
    ];

    const snapshot = buildWalletSnapshot([], settlements, currencies);
    const usdCash = snapshot.rows.find((row) => row.currency.id === usd.id && row.paymentMethod === 'USD_CASH');
    const lydCash = snapshot.rows.find((row) => row.currency.id === lyd.id && row.paymentMethod === 'LYD_CASH');

    expect(usdCash?.debt).toBe(100);
    expect(usdCash?.credit).toBe(0);
    expect(lydCash?.credit).toBe(70);
    expect(lydCash?.debt).toBe(0);
  });

  it('calculates one account bucket amount from movements and ignores soft-deleted movements', () => {
    const settlements = [
      {
        personId: 'person-1',
        currencyId: usd.id,
        paymentMethod: 'USD_CASH',
        accountType: 'DEBT' as const,
        direction: 'ADD' as const,
        amount: 100,
      },
      {
        personId: 'person-1',
        currencyId: usd.id,
        paymentMethod: 'USD_CASH',
        accountType: 'DEBT' as const,
        direction: 'SUBTRACT' as const,
        amount: 30,
      },
      {
        personId: 'person-1',
        currencyId: usd.id,
        paymentMethod: 'USD_CASH',
        accountType: 'DEBT' as const,
        direction: 'ADD' as const,
        amount: 999,
        deletedAt: new Date(),
      },
    ];

    expect(walletAccountAmount([], settlements, usd.id, 'USD_CASH', 'DEBT').toString()).toBe('70');
  });

  it('recalculates balances in chronological order and blocks negative balances', () => {
    const recalculated = recalculateSettlementBalances(20, [
      { id: 'a', direction: 'ADD', amount: 50 },
      { id: 'b', direction: 'SUBTRACT', amount: 15 },
    ]);

    expect(recalculated.map((item) => [item.id, item.balanceBefore.toString(), item.balanceAfter.toString()])).toEqual([
      ['a', '20', '70'],
      ['b', '70', '55'],
    ]);

    expect(() => recalculateSettlementBalances(10, [{ id: 'x', direction: 'SUBTRACT', amount: 11 }])).toThrow(
      'NEGATIVE_WALLET_BALANCE',
    );
  });

  it('treats repayment movements as subtraction from the current side balance', () => {
    const settlements = [
      {
        personId: 'person-1',
        currencyId: usd.id,
        paymentMethod: 'USD_CASH',
        accountType: 'DEBT' as const,
        direction: 'ADD' as const,
        amount: 200,
      },
      {
        personId: 'person-1',
        currencyId: usd.id,
        paymentMethod: 'USD_CASH',
        accountType: 'DEBT' as const,
        direction: 'SUBTRACT' as const,
        amount: 75,
      },
    ];

    expect(walletAccountAmount([], settlements, usd.id, 'USD_CASH', 'DEBT').toString()).toBe('125');
    expect(() =>
      recalculateSettlementBalances(200, [
        { id: 'repayment-1', direction: 'SUBTRACT', amount: 75 },
        { id: 'repayment-2', direction: 'SUBTRACT', amount: 130 },
      ]),
    ).toThrow('NEGATIVE_WALLET_BALANCE');
  });
});
