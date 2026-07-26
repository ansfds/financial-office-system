import { numberValue } from './format';
import {
  AnyPaymentMethod,
  lydBreakdownMethods,
  normalizeDetailedPaymentMethod,
  paymentMethodForCurrency,
  usdBreakdownMethods,
} from './payment-methods';

type MovementLike = {
  direction?: string | null;
  amount?: unknown;
  paymentMethod?: string | null;
  reason?: string | null;
  currency?: { code?: string | null; symbol?: string | null; name?: string | null } | null;
  transaction?: {
    operationKind?: string | null;
    operationDetails?: any;
    sheinPaymentMethod?: string | null;
  } | null;
};

export type CashboxMethodSummary = Record<string, number>;

export function inferMovementPaymentMethod(movement: MovementLike): AnyPaymentMethod | null {
  const direct = normalizeDetailedPaymentMethod(movement.paymentMethod);
  if (direct) return direct;

  const currencyCode = movement.currency?.code || null;
  const details = movement.transaction?.operationDetails || {};
  const transactionMethod = normalizeDetailedPaymentMethod(movement.transaction?.sheinPaymentMethod);
  if (transactionMethod) return transactionMethod;

  const detailed = normalizeDetailedPaymentMethod(details.paymentMethod || details.settlementPaymentMethod);
  if (detailed) return detailed;

  const fromSimple = paymentMethodForCurrency(currencyCode, details.movementMethod || details.paymentMethod || 'CASH');
  if (fromSimple) return fromSimple;

  const reason = movement.reason || '';
  if (currencyCode === 'LYD') {
    if (reason.includes('حوالة مكتب')) return 'LYD_OFFICE_TRANSFER';
    if (reason.includes('حوالة')) return 'LYD_TRANSFER';
    if (reason.includes('بطاقة')) return 'LYD_CARD';
    return 'LYD_CASH';
  }
  if (currencyCode === 'USD') {
    if (reason.includes('بطاقة')) return 'USD_CARD';
    if (reason.includes('حوالة')) return 'USD_TRANSFER';
    return 'USD_CASH';
  }
  if (currencyCode === 'USDT') return 'USDT';

  return null;
}

export function summarizeCashboxByMethod(movements: MovementLike[]) {
  const summary: CashboxMethodSummary = {};

  for (const movement of movements) {
    const method = inferMovementPaymentMethod(movement);
    if (!method) continue;

    const signedAmount =
      movement.direction === 'OUT' ? -numberValue(movement.amount) : movement.direction === 'IN' ? numberValue(movement.amount) : 0;
    summary[method] = (summary[method] || 0) + signedAmount;
  }

  return summary;
}

export function sumMethods(summary: CashboxMethodSummary, methods: readonly string[]) {
  return methods.reduce((sum, method) => sum + (summary[method] || 0), 0);
}

export function lydBreakdown(summary: CashboxMethodSummary) {
  return lydBreakdownMethods.map((method) => ({ method, amount: summary[method] || 0 }));
}

export function usdBreakdown(summary: CashboxMethodSummary) {
  return usdBreakdownMethods.map((method) => ({ method, amount: summary[method] || 0 }));
}
