export const simplePaymentMethods = ['CASH', 'TRANSFER', 'OFFICE_TRANSFER', 'CARD'] as const;
export type SimplePaymentMethod = (typeof simplePaymentMethods)[number];

export const detailedPaymentMethods = [
  'LYD_CASH',
  'LYD_TRANSFER',
  'LYD_OFFICE_TRANSFER',
  'LYD_CARD',
  'USD_CASH',
  'USD_TRANSFER',
  'USD_CARD',
] as const;
export type DetailedPaymentMethod = (typeof detailedPaymentMethods)[number];

export const legacyDetailedPaymentMethods = ['CARD'] as const;
export type LegacyDetailedPaymentMethod = (typeof legacyDetailedPaymentMethods)[number];
export type AnyPaymentMethod = DetailedPaymentMethod | LegacyDetailedPaymentMethod | 'USDT';

export const simplePaymentLabels: Record<SimplePaymentMethod, string> = {
  CASH: 'كاش',
  TRANSFER: 'حوالة',
  OFFICE_TRANSFER: 'حوالة مكتب',
  CARD: 'بطاقة مصرفية',
};

export const detailedPaymentLabels: Record<AnyPaymentMethod, string> = {
  LYD_CASH: 'دينار كاش',
  LYD_TRANSFER: 'دينار حوالة',
  LYD_OFFICE_TRANSFER: 'دينار حوالة مكتب',
  LYD_CARD: 'دينار بطاقة',
  USD_CASH: 'دولار كاش',
  USD_TRANSFER: 'دولار حوالة',
  USD_CARD: 'دولار بطاقة',
  CARD: 'بطاقة مصرفية',
  USDT: 'USDT',
};

export const detailedPaymentCurrencyCode: Record<DetailedPaymentMethod | LegacyDetailedPaymentMethod, 'LYD' | 'USD'> = {
  LYD_CASH: 'LYD',
  LYD_TRANSFER: 'LYD',
  LYD_OFFICE_TRANSFER: 'LYD',
  LYD_CARD: 'LYD',
  USD_CASH: 'USD',
  USD_TRANSFER: 'USD',
  USD_CARD: 'USD',
  CARD: 'LYD',
};

export const lydBreakdownMethods = ['LYD_CASH', 'LYD_TRANSFER', 'LYD_OFFICE_TRANSFER', 'LYD_CARD'] as const;
export const usdBreakdownMethods = ['USD_CASH', 'USD_TRANSFER', 'USD_CARD'] as const;

export function normalizeDetailedPaymentMethod(method?: string | null): AnyPaymentMethod | null {
  if (!method) return null;
  if (method === 'CARD') return 'LYD_CARD';
  if (method === 'OFFICE_TRANSFER') return 'LYD_OFFICE_TRANSFER';
  if (([...detailedPaymentMethods, ...legacyDetailedPaymentMethods, 'USDT'] as string[]).includes(method)) {
    return method as AnyPaymentMethod;
  }
  return null;
}

export function paymentMethodForCurrency(
  currencyCode?: string | null,
  simpleMethod: SimplePaymentMethod | string | null = 'CASH',
): AnyPaymentMethod | null {
  const method = (simpleMethod || 'CASH') as SimplePaymentMethod;

  if (currencyCode === 'USDT') return 'USDT';
  if (currencyCode === 'USD') {
    if (method === 'CARD') return 'USD_CARD';
    return method === 'CASH' ? 'USD_CASH' : 'USD_TRANSFER';
  }
  if (currencyCode === 'LYD') {
    if (method === 'TRANSFER') return 'LYD_TRANSFER';
    if (method === 'OFFICE_TRANSFER') return 'LYD_OFFICE_TRANSFER';
    if (method === 'CARD') return 'LYD_CARD';
    return 'LYD_CASH';
  }

  return null;
}

export function paymentMethodLabel(method?: string | null) {
  const normalized = normalizeDetailedPaymentMethod(method) || (method as AnyPaymentMethod | null);
  return normalized ? detailedPaymentLabels[normalized] || normalized : 'غير محدد';
}
