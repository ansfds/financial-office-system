'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { withdrawalSlots } from '@/lib/card-withdrawals';
export default function WithdrawalBoxes({ card, onSaved }: { card: any; onSaved?: (card: any) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const slots = withdrawalSlots(card);
  async function setSlot(index: number) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/inventory/received-cards/${card.id}/withdrawals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: index + 1, checked: !slots[index], updatedAt: card.updatedAt }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) router.refresh();
        throw new Error(result.error);
      }
      onSaved?.(result);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || 'تعذر حفظ السحبة');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-withdrawal-boxes={card.id} aria-busy={busy}>
      <div className="mb-2 flex justify-between text-xs">
        <span>السحبات</span>
        <span data-withdrawal-count>{slots.filter(Boolean).length}/5</span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {slots.map((checked, index) => (
          <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={`السحبة ${index + 1} للبطاقة ${card.cardLast4 || ''}`}
            disabled={busy}
            onClick={() => setSlot(index)}
            key={index}
            className={`rounded-lg border text-sm font-bold disabled:opacity-50 ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'}`}
          >
            {checked ? '✓' : index + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
