import { Prisma } from '@prisma/client';
import { numberValue } from './format';
import { D } from './money';
import { normalizeDetailedPaymentMethod, paymentMethodForCurrency } from './payment-methods';

export const walletBuckets = [
  { paymentMethod: 'USD_CASH', currencyCode: 'USD', label: 'دولار كاش' },
  { paymentMethod: 'USD_TRANSFER', currencyCode: 'USD', label: 'دولار حوالة' },
  { paymentMethod: 'LYD_CASH', currencyCode: 'LYD', label: 'دينار كاش' },
  { paymentMethod: 'LYD_TRANSFER', currencyCode: 'LYD', label: 'دينار حوالة' },
  { paymentMethod: 'LYD_OFFICE_TRANSFER', currencyCode: 'LYD', label: 'دينار حوالة مكتب' },
  { paymentMethod: 'LYD_CARD', currencyCode: 'LYD', label: 'دينار بطاقة' },
  { paymentMethod: 'USDT', currencyCode: 'USDT', label: 'USDT' },
  { paymentMethod: 'CNY', currencyCode: 'CNY', label: 'يوان' },
] as const;

export const walletAccountLabels = {
  CREDIT: 'علينا',
  DEBT: 'لنا',
} as const;

export const walletSettlementDirectionLabels = {
  ADD: 'إضافة',
  SUBTRACT: 'خصم',
} as const;

type CurrencyLike = {
  id: string;
  code?: string | null;
  name?: string | null;
  symbol?: string | null;
};

type TransactionLike = {
  id: string;
  number?: string | null;
  personId?: string | null;
  currencyId: string;
  currency?: CurrencyLike | null;
  operationKind?: string | null;
  operationDetails?: any;
  sheinPaymentMethod?: string | null;
  agreedAmount: unknown;
  receivedAmount: unknown;
  paidAmount: unknown;
  status?: string | null;
  deletedAt?: Date | string | null;
};

type SettlementLike = {
  personId: string;
  currencyId: string;
  currency?: CurrencyLike | null;
  paymentMethod: string;
  accountType: 'CREDIT' | 'DEBT';
  direction: 'ADD' | 'SUBTRACT';
  amount: unknown;
  deletedAt?: Date | string | null;
};

export type WalletEffect = {
  personId: string;
  currencyId: string;
  currency?: CurrencyLike | null;
  paymentMethod: string;
  accountType: 'CREDIT' | 'DEBT';
  amount: Prisma.Decimal;
  transactionId: string;
  transactionNumber?: string | null;
};

export type WalletEffectMode = 'NORMAL' | 'OFFSET';
export type WalletAccountType = 'CREDIT' | 'DEBT';
export type WalletSettlementDirection = 'ADD' | 'SUBTRACT';

export type WalletSnapshotRow = {
  paymentMethod: string;
  label: string;
  currency: CurrencyLike;
  credit: number;
  debt: number;
};

export type WalletSnapshot = {
  rows: WalletSnapshotRow[];
  totals: {
    credit: Array<{ currency: CurrencyLike; amount: number }>;
    debt: Array<{ currency: CurrencyLike; amount: number }>;
  };
};

type RecalculationSettlement = {
  id: string;
  direction: 'ADD' | 'SUBTRACT';
  amount: unknown;
};

export function recalculateSettlementBalances(
  startingBalance: unknown,
  settlements: RecalculationSettlement[],
) {
  let balance = D(startingBalance || 0);

  return settlements.map((settlement) => {
    const balanceBefore = balance;
    balance = settlement.direction === 'ADD' ? balance.add(D(settlement.amount)) : balance.sub(D(settlement.amount));

    if (balance.lt(0)) throw new Error('NEGATIVE_WALLET_BALANCE');

    return {
      id: settlement.id,
      balanceBefore,
      balanceAfter: balance,
    };
  });
}

function bucketKey(currencyId: string, paymentMethod: string) {
  return `${currencyId}:${paymentMethod}`;
}

function decimalAbs(value: Prisma.Decimal) {
  return value.lt(0) ? value.mul(-1) : value;
}

function walletPreviewSide(
  value: Prisma.Decimal,
  direction: WalletSettlementDirection,
  amount: Prisma.Decimal,
) {
  return direction === 'ADD' ? value.add(amount) : value.sub(amount);
}

export function settleWalletSides(debt: unknown, credit: unknown) {
  const net = D(debt || 0).sub(D(credit || 0));

  if (net.gt(0)) {
    return { debt: net, credit: D(0), status: 'DEBT' as const };
  }

  if (net.lt(0)) {
    return { debt: D(0), credit: decimalAbs(net), status: 'CREDIT' as const };
  }

  return { debt: D(0), credit: D(0), status: 'SETTLED' as const };
}

export function previewWalletOperation(input: {
  debtBefore: unknown;
  creditBefore: unknown;
  amount: unknown;
  accountType: WalletAccountType;
  direction: WalletSettlementDirection;
  effectMode?: WalletEffectMode;
}) {
  const amount = D(input.amount || 0);
  if (amount.lte(0)) throw new Error('INVALID_WALLET_AMOUNT');

  const debtBefore = D(input.debtBefore || 0);
  const creditBefore = D(input.creditBefore || 0);
  let debtAfter = debtBefore;
  let creditAfter = creditBefore;

  if (input.accountType === 'DEBT') {
    debtAfter = walletPreviewSide(debtAfter, input.direction, amount);
  } else {
    creditAfter = walletPreviewSide(creditAfter, input.direction, amount);
  }

  if (debtAfter.lt(0) || creditAfter.lt(0)) throw new Error('NEGATIVE_WALLET_BALANCE');

  if (input.effectMode === 'OFFSET') {
    const settled = settleWalletSides(debtAfter, creditAfter);
    debtAfter = settled.debt;
    creditAfter = settled.credit;
  }

  return {
    debtBefore,
    creditBefore,
    amount,
    debtAfter,
    creditAfter,
  };
}

export function normalizeWalletPaymentMethod(method: string | null | undefined, currencyCode?: string | null) {
  const raw = method || '';
  const normalized = normalizeDetailedPaymentMethod(raw);

  if (currencyCode === 'USDT' || normalized === 'USDT' || raw === 'USDT') return 'USDT';
  if (currencyCode === 'CNY' || raw === 'CNY') return 'CNY';

  if (currencyCode === 'USD') {
    if (normalized === 'USD_CASH' || raw === 'CASH') return 'USD_CASH';
    return 'USD_TRANSFER';
  }

  if (currencyCode === 'LYD') {
    if (normalized === 'LYD_TRANSFER' || raw === 'TRANSFER') return 'LYD_TRANSFER';
    if (normalized === 'LYD_OFFICE_TRANSFER' || raw === 'OFFICE_TRANSFER') return 'LYD_OFFICE_TRANSFER';
    if (normalized === 'LYD_CARD' || raw === 'CARD') return 'LYD_CARD';
    return 'LYD_CASH';
  }

  return normalized || paymentMethodForCurrency(currencyCode, raw || 'CASH') || currencyCode || 'UNKNOWN';
}

export function transactionWalletEffect(transaction: TransactionLike): WalletEffect | null {
  if (!transaction.personId || transaction.deletedAt || transaction.status === 'CANCELLED') return null;

  const details = transaction.operationDetails || {};
  if (transaction.operationKind === 'CARD_OPERATION' && details.action === 'RECEIVE_CARD') return null;

  const agreedAmount = D(transaction.agreedAmount);
  const settledAmount = D(transaction.receivedAmount).add(D(transaction.paidAmount));
  const difference = settledAmount.sub(agreedAmount);
  if (difference.eq(0)) return null;

  const currencyCode = transaction.currency?.code || details.currencyCode || details.paymentCurrencyCode || null;
  const method =
    transaction.sheinPaymentMethod ||
    details.paymentMethod ||
    details.settlementPaymentMethod ||
    details.movementMethod ||
    null;

  return {
    personId: transaction.personId,
    currencyId: transaction.currencyId,
    currency: transaction.currency,
    paymentMethod: normalizeWalletPaymentMethod(method, currencyCode),
    accountType: difference.gt(0) ? 'CREDIT' : 'DEBT',
    amount: decimalAbs(difference),
    transactionId: transaction.id,
    transactionNumber: transaction.number,
  };
}

export function walletBucketDefinitions(currencies: CurrencyLike[]) {
  const rows = walletBuckets.flatMap((bucket) => {
    const currency = currencies.find((item) => item.code === bucket.currencyCode);
    return currency ? [{ ...bucket, currency }] : [];
  });

  return rows;
}

export function buildWalletSnapshot(
  transactions: TransactionLike[],
  settlements: SettlementLike[],
  currencies: CurrencyLike[],
): WalletSnapshot {
  const bucketDefinitions = walletBucketDefinitions(currencies);
  const currencyById = new Map(currencies.map((currency) => [currency.id, currency]));
  const rowMap = new Map<string, WalletSnapshotRow>();

  for (const bucket of bucketDefinitions) {
    rowMap.set(bucketKey(bucket.currency.id, bucket.paymentMethod), {
      paymentMethod: bucket.paymentMethod,
      label: bucket.label,
      currency: bucket.currency,
      credit: 0,
      debt: 0,
    });
  }

  function ensureRow(currencyId: string, paymentMethod: string, fallbackCurrency?: CurrencyLike | null) {
    const key = bucketKey(currencyId, paymentMethod);
    const existing = rowMap.get(key);
    if (existing) return existing;

    const currency = currencyById.get(currencyId) || fallbackCurrency;
    if (!currency) return null;

    const label = walletBuckets.find((bucket) => bucket.paymentMethod === paymentMethod)?.label || paymentMethod;
    const row = {
      paymentMethod,
      label,
      currency,
      credit: 0,
      debt: 0,
    };
    rowMap.set(key, row);
    return row;
  }

  function addAmount(
    currencyId: string,
    paymentMethod: string,
    accountType: 'CREDIT' | 'DEBT',
    amount: number,
    fallbackCurrency?: CurrencyLike | null,
  ) {
    const row = ensureRow(currencyId, paymentMethod, fallbackCurrency);
    if (!row) return;

    if (accountType === 'CREDIT') row.credit += amount;
    else row.debt += amount;
  }

  for (const transaction of transactions) {
    const effect = transactionWalletEffect(transaction);
    if (!effect) continue;
    addAmount(effect.currencyId, effect.paymentMethod, effect.accountType, numberValue(effect.amount), effect.currency);
  }

  for (const settlement of settlements) {
    if (settlement.deletedAt) continue;
    const signedAmount =
      settlement.direction === 'ADD' ? numberValue(settlement.amount) : -numberValue(settlement.amount);
    addAmount(
      settlement.currencyId,
      settlement.paymentMethod,
      settlement.accountType,
      signedAmount,
      settlement.currency,
    );
  }

  const totalsByCurrency = {
    credit: new Map<string, number>(),
    debt: new Map<string, number>(),
  };

  for (const row of rowMap.values()) {
    totalsByCurrency.credit.set(row.currency.id, (totalsByCurrency.credit.get(row.currency.id) || 0) + row.credit);
    totalsByCurrency.debt.set(row.currency.id, (totalsByCurrency.debt.get(row.currency.id) || 0) + row.debt);
  }

  const rows = Array.from(rowMap.values());

  return {
    rows,
    totals: {
      credit: Array.from(totalsByCurrency.credit.entries())
        .map(([currencyId, amount]) => ({ currency: currencyById.get(currencyId), amount }))
        .filter((item): item is { currency: CurrencyLike; amount: number } => Boolean(item.currency) && item.amount !== 0),
      debt: Array.from(totalsByCurrency.debt.entries())
        .map(([currencyId, amount]) => ({ currency: currencyById.get(currencyId), amount }))
        .filter((item): item is { currency: CurrencyLike; amount: number } => Boolean(item.currency) && item.amount !== 0),
    },
  };
}

export function walletAccountAmount(
  transactions: TransactionLike[],
  settlements: SettlementLike[],
  currencyId: string,
  paymentMethod: string,
  accountType: 'CREDIT' | 'DEBT',
) {
  let amount = D(0);

  for (const transaction of transactions) {
    const effect = transactionWalletEffect(transaction);
    if (
      effect &&
      effect.currencyId === currencyId &&
      effect.paymentMethod === paymentMethod &&
      effect.accountType === accountType
    ) {
      amount = amount.add(effect.amount);
    }
  }

  for (const settlement of settlements) {
    if (settlement.deletedAt) continue;
    if (
      settlement.currencyId === currencyId &&
      settlement.paymentMethod === paymentMethod &&
      settlement.accountType === accountType
    ) {
      amount =
        settlement.direction === 'ADD'
          ? amount.add(D(settlement.amount))
          : amount.sub(D(settlement.amount));
    }
  }

  return amount;
}
