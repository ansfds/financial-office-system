export const cardStateDefinitions = [
  {
    key: 'NEW',
    label: 'البطاقات الجديدة',
    statuses: ['RECEIVED'],
    color: 'text-blue-700 dark:text-blue-300',
  },
  {
    key: 'IN_PROGRESS',
    label: 'قيد السحب',
    statuses: ['IN_SETTLEMENT', 'PARTIAL'],
    color: 'text-amber-700 dark:text-amber-300',
  },
  {
    key: 'CLEARED',
    label: 'مصفاة',
    statuses: ['SETTLED', 'COMPLETED'],
    color: 'text-emerald-700 dark:text-emerald-300',
  },
  { key: 'CANCELLED', label: 'ملغية', statuses: ['CANCELLED'], color: 'text-slate-600 dark:text-slate-300' },
  {
    key: 'PAYMENT_FAILED',
    label: 'فشل الدفع',
    statuses: ['PAYMENT_FAILED'],
    color: 'text-red-700 dark:text-red-300',
  },
  {
    key: 'INSUFFICIENT_BALANCE',
    label: 'رصيد غير كافي',
    statuses: ['INSUFFICIENT_BALANCE'],
    color: 'text-orange-800 dark:text-orange-300',
  },
] as const;
export type CardState = (typeof cardStateDefinitions)[number]['key'];
export type CardCounts = Record<CardState | 'total', number>;
export function cardState(status: string): CardState {
  return (
    cardStateDefinitions.find((s) => s.key === status || (s.statuses as readonly string[]).includes(status))
      ?.key || 'NEW'
  );
}
export function parseCardState(value?: string | null): CardState | undefined {
  return cardStateDefinitions.find((s) => s.key === value)?.key;
}
export function summarizeCardStates(rows: Array<{ status: string; _count?: number }>): CardCounts {
  const counts: CardCounts = {
    NEW: 0,
    IN_PROGRESS: 0,
    CLEARED: 0,
    CANCELLED: 0,
    PAYMENT_FAILED: 0,
    INSUFFICIENT_BALANCE: 0,
    total: 0,
  };
  for (const row of rows) {
    const count = row._count ?? 1;
    counts[cardState(row.status)] += count;
    counts.total += count;
  }
  return counts;
}
export const specialCardStatuses = new Set(['CANCELLED', 'PAYMENT_FAILED', 'INSUFFICIENT_BALANCE']);
