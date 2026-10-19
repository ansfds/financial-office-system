import { specialCardStatuses } from './card-states';
type StageLog = { stage: number; direction: string; createdAt: string | Date; id?: string };
type WithdrawalCard = { currentStage?: number; stageLogs?: StageLog[] };
const directions = new Set(['WITHDRAWAL_ON', 'WITHDRAWAL_OFF']);
export function hasWithdrawalBoxes(card: WithdrawalCard) {
  return (card.stageLogs || []).some((log) => directions.has(log.direction));
}
export function withdrawalSlots(card: WithdrawalCard): boolean[] {
  const logs = (card.stageLogs || []).filter((log) => directions.has(log.direction));
  if (!logs.length)
    return Array.from({ length: 5 }, (_, i) => i < Math.max(0, Math.min(card.currentStage || 0, 5)));
  const latest = new Map<number, StageLog>();
  for (const log of logs) {
    const previous = latest.get(log.stage);
    if (
      !previous ||
      new Date(log.createdAt).getTime() > new Date(previous.createdAt).getTime() ||
      (new Date(log.createdAt).getTime() === new Date(previous.createdAt).getTime() &&
        (log.id || '') > (previous.id || ''))
    )
      latest.set(log.stage, log);
  }
  return Array.from({ length: 5 }, (_, i) => latest.get(i + 1)?.direction === 'WITHDRAWAL_ON');
}
export function withdrawalBoxStatus(slots: boolean[], currentStatus: string) {
  if (specialCardStatuses.has(currentStatus)) return currentStatus;
  const count = slots.filter(Boolean).length;
  return count === 5 ? 'SETTLED' : count > 0 ? 'IN_SETTLEMENT' : 'RECEIVED';
}
