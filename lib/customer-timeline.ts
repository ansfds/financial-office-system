export function customerInteractionDates(person: any) {
  const firstDates = [
    ...(person.transactions || []).map((t: any) => t.transactionAt),
    ...(person.cardBatches || []).map((b: any) => b.receivedAt),
    ...(person.walletSettlements || []).map((s: any) => s.occurredAt),
    ...(person.cardDeliveries || []).map((d: any) => d.occurredAt),
  ]
    .filter(Boolean)
    .map((value: string | Date) => new Date(value).getTime())
    .filter(Number.isFinite);
  const updates = (person.cardBatches || [])
    .flatMap((b: any) => (b.cards || []).map((c: any) => new Date(c.updatedAt).getTime()))
    .filter(Number.isFinite);
  const fallback = new Date(person.createdAt).getTime();
  return {
    first: new Date(firstDates.length ? Math.min(...firstDates) : fallback),
    last: new Date(firstDates.length || updates.length ? Math.max(...firstDates, ...updates) : fallback),
  };
}
