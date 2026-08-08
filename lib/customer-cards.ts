import { D } from './money';

export const CUSTOMER_CARD_MAX_STAGE = 6;

export const defaultCardDiscountCategories = [
  { code: '100', name: 'كرت 100', faceValue: 100, deductionAmount: 101 },
  { code: '300', name: 'كرت 300', faceValue: 300, deductionAmount: 292 },
  { code: '500', name: 'كرت 500', faceValue: 500, deductionAmount: 476 },
] as const;

export const cardOperationTypeLabels = {
  GIFT_CARD: 'كروت',
  INVOICE: 'فاتورة',
  FINAL_SETTLEMENT: 'تصفية',
  REJECT: 'رفض',
  REACTIVATE: 'إعادة تنشيط',
  ADJUSTMENT: 'تعديل يدوي',
} as const;

export function clampCardStage(stage: unknown) {
  const parsed = Number(stage);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(Math.trunc(parsed), CUSTOMER_CARD_MAX_STAGE));
}

export function nextCardStage(currentStage: unknown, action?: 'NEXT' | 'PREVIOUS') {
  const current = clampCardStage(currentStage);
  if (action === 'NEXT') return clampCardStage(current + 1);
  if (action === 'PREVIOUS') return clampCardStage(current - 1);
  return current;
}

export function cardStatusForStage(stage: unknown, fallback = 'RECEIVED') {
  if (fallback === 'CANCELLED') return fallback;

  const current = clampCardStage(stage);
  if (current >= 6) return 'COMPLETED';
  if (current >= 5) return 'SETTLED';
  if (current >= 1) return 'IN_SETTLEMENT';
  return 'RECEIVED';
}

export function cardBaseAmount(valueUsd: unknown, agreedAmount: unknown) {
  const value = D(valueUsd || 0);
  return value.gt(0) ? value : D(agreedAmount || 0);
}

export function cardRemainingAmount(valueUsd: unknown, agreedAmount: unknown, receivedAmount: unknown) {
  const remaining = cardBaseAmount(valueUsd, agreedAmount).sub(D(receivedAmount || 0));
  return remaining.gt(0) ? remaining : D(0);
}

function decimalMinZero(value: ReturnType<typeof D>) {
  return value.gt(0) ? value : D(0);
}

export function cardProgressPercent(baseAmount: unknown, deductedAmount: unknown) {
  const base = D(baseAmount || 0);
  if (base.lte(0)) return D(0);

  const percent = D(deductedAmount || 0).div(base).mul(100);
  if (percent.lt(0)) return D(0);
  if (percent.gt(100)) return D(100);
  return percent;
}

export function cardStatusForBalance(
  baseAmount: unknown,
  deductedAmount: unknown,
  fallback: string | null | undefined = 'RECEIVED',
) {
  if (fallback === 'CANCELLED') return 'CANCELLED';

  const base = D(baseAmount || 0);
  const deducted = D(deductedAmount || 0);
  const remaining = decimalMinZero(base.sub(deducted));

  if (base.gt(0) && remaining.lte(0)) return 'SETTLED';
  if (deducted.gt(0)) return 'IN_SETTLEMENT';
  return 'RECEIVED';
}

export function cardOperationAmount(input: {
  operationType: string;
  amount?: unknown;
  quantity?: unknown;
  category?: { deductionAmount: unknown } | null;
  currentRemaining?: unknown;
}) {
  if (input.operationType === 'GIFT_CARD') {
    const quantity = Math.max(1, Math.trunc(Number(input.quantity || 1)));
    if (!input.category) throw new Error('CARD_CATEGORY_NOT_FOUND');
    return D(input.category.deductionAmount).mul(quantity);
  }

  if (input.operationType === 'FINAL_SETTLEMENT') {
    const requested = input.amount === undefined || input.amount === null || input.amount === '' ? null : D(input.amount);
    return requested && requested.gt(0) ? requested : D(input.currentRemaining || 0);
  }

  if (input.operationType === 'INVOICE' || input.operationType === 'ADJUSTMENT') {
    return D(input.amount || 0);
  }

  return D(0);
}

export function isCardDeductionOperation(operationType: string) {
  return ['GIFT_CARD', 'INVOICE', 'FINAL_SETTLEMENT', 'ADJUSTMENT'].includes(operationType);
}
