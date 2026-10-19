export const cardStatusLabels: Record<string, string> = {
  RECEIVED: 'جديدة',
  IN_SETTLEMENT: 'قيد السحب',
  PARTIAL: 'قيد السحب',
  SETTLED: 'مصفاة',
  COMPLETED: 'مصفاة',
  CANCELLED: 'ملغية',
  PAYMENT_FAILED: 'فشل الدفع',
  INSUFFICIENT_BALANCE: 'رصيد غير كافي',
};
export const cardEntryStatuses = [
  'RECEIVED',
  'SETTLED',
  'PAYMENT_FAILED',
  'INSUFFICIENT_BALANCE',
  'CANCELLED',
] as const;

export function cardMoneyGroups(cards: any[]) {
  const groups = new Map<string, { code: string; agreed: number }>();
  for (const card of cards) {
    const code = card.settlementCurrency?.code || card.batch?.currency?.code || 'USD';
    const row = groups.get(code) || { code, agreed: 0 };
    if (card.status !== 'CANCELLED') row.agreed += Number(card.agreedAmount || 0);
    // Withdrawals are denominated in USD (valueUsd), independent of payment currency.
    groups.set(code, row);
  }
  return [...groups.values()];
}
