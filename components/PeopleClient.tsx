'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Edit3,
  Eye,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatDateTime, formatMoney, numberValue } from '@/lib/format';
import { detailedPaymentLabels } from '@/lib/payment-methods';
import ModalLayer, { ModalBackdrop } from '@/components/ModalLayer';
import { STANDARD_CUSTOMER_CARD_VALUE_USD, cardOperationTypeLabels } from '@/lib/customer-cards';
import { compareCardsBySequence, sortByCustomerCode } from '@/lib/customer-code-sort';

const FastCardEntryModal = dynamic(() => import('@/components/FastCardEntryModal'), { ssr: false });
const CardOperationModal = dynamic(() => import('@/components/CardOperationModal'), { ssr: false });
const CustomerDeliveryModal = dynamic(() => import('@/components/CustomerDeliveryModal'), { ssr: false });

type CurrencyOption = {
  id: string;
  code: string;
  name: string;
  symbol: string;
};

type PersonForm = {
  fullName: string;
  phone: string;
  address: string;
  notes: string;
  externalId: string;
  category: string;
};

type CardDraft = {
  bankName?: string;
  cardLast4?: string;
  valueUsd?: string;
  agreedAmount?: string;
  receivedAmount?: string;
  settlementAmount?: string;
  settlementPaymentMethod?: string;
  status?: string;
  notes?: string;
  stageAmount?: string;
  stageNote?: string;
  currentStage?: string;
};

const blankForm: PersonForm = {
  fullName: '',
  phone: '',
  address: '',
  notes: '',
  externalId: '',
  category: 'REGULAR',
};

const statusLabels: Record<string, string> = {
  RECEIVED: 'نشطة',
  IN_SETTLEMENT: 'نشطة',
  PARTIAL: 'نشطة',
  SETTLED: 'مصفاة',
  COMPLETED: 'مصفاة',
  CANCELLED: 'مرفوضة',
};

const statusClasses: Record<string, string> = {
  RECEIVED: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800',
  IN_SETTLEMENT:
    'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800',
  PARTIAL:
    'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800',
  SETTLED:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800',
  COMPLETED:
    'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800',
  CANCELLED: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800',
};

const statusOptions = [
  { value: 'RECEIVED', label: 'جديدة' },
  { value: 'IN_SETTLEMENT', label: 'قيد السحب' },
  { value: 'SETTLED', label: 'تمت التصفية' },
  { value: 'COMPLETED', label: 'تم استلام القيمة' },
  { value: 'CANCELLED', label: 'مرفوضة أو متوقفة' },
];

const settlementMethods = ['USD_CASH', 'USD_TRANSFER', 'USD_CARD', 'LYD_CASH', 'LYD_TRANSFER', 'LYD_OFFICE_TRANSFER', 'LYD_CARD'];
const defaultOriginalCardValue = String(STANDARD_CUSTOMER_CARD_VALUE_USD);

function formFromPerson(person: any): PersonForm {
  return {
    fullName: person.fullName || '',
    phone: person.phone || '',
    address: person.address || '',
    notes: person.notes || '',
    externalId: person.externalId || '',
    category: person.category || 'REGULAR',
  };
}

function allCards(person: any) {
  return (person.cardBatches || []).flatMap((batch: any) =>
    (batch.cards || []).map((card: any) => ({
      ...card,
      batchId: batch.id,
      batch,
      person,
      currency: card.settlementCurrency || batch.currency,
    })),
  ).sort(compareCardsBySequence);
}

function cardCode(card: any) {
  return card.publicCode || `#C${String(card.sequence || 0).padStart(4, '0')}`;
}

function cardOriginal(card: any) {
  return numberValue(card.valueUsd) > 0 ? numberValue(card.valueUsd) : 0;
}

function cardRemaining(card: any) {
  if (card.remainingAmount !== undefined && card.remainingAmount !== null) return numberValue(card.remainingAmount);
  return Math.max(cardOriginal(card) - numberValue(card.receivedAmount), 0);
}

function cardDraftRemaining(card: any, draft: CardDraft = {}) {
  const original = cardOriginal({ ...card, ...draft });
  if (draft.receivedAmount !== undefined) return Math.max(original - numberValue(draft.receivedAmount), 0);
  return cardRemaining(card);
}

function cardDeducted(card: any, draft: CardDraft = {}) {
  if (draft.receivedAmount !== undefined) return Math.max(numberValue(draft.receivedAmount), 0);
  return Math.max(numberValue(card.totalDeducted ?? card.receivedAmount), 0);
}

function cardProgressPercent(card: any, draft: CardDraft = {}) {
  const original = cardOriginal({ ...card, ...draft });
  if (original <= 0) return 0;

  const status = draft.status ?? card.status;
  const deducted = ['SETTLED', 'COMPLETED'].includes(status) && cardDraftRemaining(card, draft) <= 0
    ? original
    : cardDeducted(card, draft);

  return Math.min(Math.max((deducted / original) * 100, 0), 100);
}

function cardProgressClass(card: any, draft: CardDraft = {}) {
  const status = draft.status ?? card.status;
  const percent = cardProgressPercent(card, draft);

  if (status === 'CANCELLED') return 'bg-red-500';
  if (['SETTLED', 'COMPLETED'].includes(status) && percent >= 100) return 'bg-emerald-500';
  if (percent <= 0) return 'bg-blue-500';
  return 'bg-orange-500';
}

function cardProgressLabel(card: any, draft: CardDraft = {}) {
  const percent = cardProgressPercent(card, draft);
  return `${percent % 1 === 0 ? Math.round(percent) : percent.toFixed(1)}%`;
}

function personSummary(person: any) {
  if (!person.cardBatches?.length && person.cardSummary) {
    return {
      cards: [],
      totalCards: numberValue(person.cardSummary.totalCards),
      originalTotal: numberValue(person.cardSummary.originalTotal),
      agreedTotal: numberValue(person.cardSummary.agreedTotal),
      active: numberValue(person.cardSummary.active),
      completed: numberValue(person.cardSummary.completed),
      rejected: numberValue(person.cardSummary.rejected),
      lastUpdate: person.cardSummary.lastUpdate ? new Date(person.cardSummary.lastUpdate) : person.updatedAt || person.createdAt,
    };
  }

  const cards = allCards(person);
  const active = cards.filter((card: any) => ['RECEIVED', 'IN_SETTLEMENT', 'PARTIAL'].includes(card.status)).length;
  const completed = cards.filter((card: any) => ['SETTLED', 'COMPLETED'].includes(card.status)).length;
  const rejected = cards.filter((card: any) => card.status === 'CANCELLED').length;
  const lastUpdate = [person.updatedAt, ...cards.map((card: any) => card.updatedAt)]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .sort((a, b) => b - a)[0];

  return {
    cards,
    totalCards: cards.length,
    originalTotal: cards.reduce((sum: number, card: any) => sum + cardOriginal(card), 0),
    agreedTotal: cards.reduce((sum: number, card: any) => sum + numberValue(card.agreedAmount), 0),
    active,
    completed,
    rejected,
    lastUpdate: lastUpdate ? new Date(lastUpdate) : person.updatedAt || person.createdAt,
  };
}

function customerDeliverySummary(person: any, currencies: CurrencyOption[]) {
  if (!person.cardBatches?.length && Array.isArray(person.deliverySummary)) {
    return person.deliverySummary;
  }

  const currencyById = new Map(currencies.map((currency) => [currency.id, currency]));
  const rows = new Map<string, { currency: CurrencyOption; agreed: number; delivered: number; remaining: number }>();

  for (const card of allCards(person)) {
    if (card.status === 'CANCELLED') continue;
    const currency = card.settlementCurrency || card.batch?.currency || card.currency;
    if (!currency?.id) continue;
    const current =
      rows.get(currency.id) ||
      {
        currency: currencyById.get(currency.id) || currency,
        agreed: 0,
        delivered: 0,
        remaining: 0,
      };
    current.agreed += numberValue(card.agreedAmount);
    rows.set(currency.id, current);
  }

  for (const delivery of person.cardDeliveries || []) {
    const currency = delivery.currency || currencyById.get(delivery.currencyId);
    if (!currency?.id) continue;
    const current =
      rows.get(currency.id) ||
      {
        currency,
        agreed: 0,
        delivered: 0,
        remaining: 0,
      };
    current.delivered += numberValue(delivery.amount);
    rows.set(currency.id, current);
  }

  return Array.from(rows.values()).map((row) => ({ ...row, remaining: Math.max(row.agreed - row.delivered, 0) }));
}

function defaultCurrencyId(currencies: CurrencyOption[]) {
  return currencies.find((currency) => currency.code === 'USD')?.id || currencies[0]?.id || '';
}

function normalizeDraftValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value);
}

function cardPayload(card: any, draft: CardDraft) {
  return {
    bankName: draft.bankName ?? card.bankName ?? null,
    cardLast4: draft.cardLast4 ?? card.cardLast4 ?? null,
    valueUsd: Number(draft.valueUsd ?? numberValue(card.valueUsd)),
    agreedAmount: Number(draft.agreedAmount ?? numberValue(card.agreedAmount)),
    receivedAmount: Number(draft.receivedAmount ?? numberValue(card.receivedAmount)),
    settlementAmount:
      draft.settlementAmount !== undefined
        ? Number(draft.settlementAmount || 0)
        : card.settlementAmount
          ? numberValue(card.settlementAmount)
          : null,
    settlementPaymentMethod: draft.settlementPaymentMethod ?? card.settlementPaymentMethod ?? null,
    status: draft.status ?? card.status,
    notes: draft.notes ?? card.notes ?? null,
  };
}

export default function PeopleClient({
  initialPeople,
  currencies,
}: {
  initialPeople: any[];
  currencies: CurrencyOption[];
}) {
  const [items, setItems] = useState<any[]>(() => sortByCustomerCode(initialPeople));
  const [detailCache, setDetailCache] = useState<Record<string, any>>({});
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPersonId, setLoadingPersonId] = useState('');
  const [savingPerson, setSavingPerson] = useState(false);
  const [form, setForm] = useState<PersonForm>(blankForm);
  const [editingPerson, setEditingPerson] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<PersonForm>(blankForm);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, CardDraft>>({});
  const [savingCards, setSavingCards] = useState<Record<string, boolean>>({});
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [mobileAddOpen, setMobileAddOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({
    cardCount: '1',
    valueUsdPerCard: defaultOriginalCardValue,
    agreedAmountPerCard: '',
    currencyId: defaultCurrencyId(currencies),
    commonBankName: '',
    notes: '',
  });
  const [fastEntryOpen, setFastEntryOpen] = useState(false);
  const [operationModal, setOperationModal] = useState<{ card: any; operation?: any | null; initialType?: string } | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const detailAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const loadingDetailRef = useRef('');

  const selectedPerson = useMemo(
    () => detailCache[selectedPersonId] || items.find((person) => person.id === selectedPersonId) || null,
    [detailCache, items, selectedPersonId],
  );
  const selectedPersonSummary = useMemo(() => (selectedPerson ? personSummary(selectedPerson) : null), [selectedPerson]);
  const selectedPersonCards = useMemo(() => selectedPersonSummary?.cards || [], [selectedPersonSummary]);
  const visibleCards = useMemo(
    () => selectedPersonCards.filter((card: any) => statusFilter === 'ALL' || card.status === statusFilter),
    [selectedPersonCards, statusFilter],
  );
  const selectedDeliveryRows = useMemo(
    () => (selectedPerson ? customerDeliverySummary(selectedPerson, currencies) : []),
    [currencies, selectedPerson],
  );
  const selectedPersonHasDetails = Boolean(selectedPersonId && detailCache[selectedPersonId]);

  const loadPersonDetails = useCallback(async (personId: string) => {
    if (!personId) return;
    if (loadingDetailRef.current === personId) return;

    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    loadingDetailRef.current = personId;
    setLoadingPersonId(personId);

    try {
      const response = await fetch(`/api/people/${personId}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(result.error || 'تعذر تحميل تفاصيل الزبون');
        return;
      }

      setDetailCache((current) => ({ ...current, [personId]: result }));
      setItems((current) => sortByCustomerCode(current.map((person) => (person.id === personId ? { ...person, ...result } : person))));
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast.error('تعذر الاتصال بالخادم أثناء تحميل تفاصيل الزبون');
    } finally {
      if (detailAbortRef.current === controller) detailAbortRef.current = null;
      if (loadingDetailRef.current === personId) loadingDetailRef.current = '';
      setLoadingPersonId((current) => (current === personId ? '' : current));
    }
  }, []);

  const closeCustomerCardsDrawer = useCallback(() => {
    setSelectedPersonId('');
    setDeliveryOpen(false);
    setExpandedCardIds(new Set());
    setSelectedCards(new Set());
  }, []);

  const openCustomerCardsDrawer = useCallback((personId: string) => {
    if (!personId) return;
    setStatusFilter('ALL');
    setSelectedPersonId(personId);
    void loadPersonDetails(personId);
  }, [loadPersonDetails]);

  useEffect(() => {
    setItems(sortByCustomerCode(initialPeople));
  }, [initialPeople]);

  // The debounced loader receives q as an argument, so adding the function itself would re-run every render.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      load(q);
    }, 220);

    return () => window.clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    return () => {
      detailAbortRef.current?.abort();
      searchAbortRef.current?.abort();
    };
  }, []);

  async function load(search = q) {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setLoading(true);
    try {
    const response = await fetch(`/api/people?q=${encodeURIComponent(search)}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => []);
    if (!response.ok) return toast.error(data.error || 'تعذر تحميل الزبائن');
    setItems(sortByCustomerCode(Array.isArray(data) ? data : []));
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast.error('تعذر الاتصال بالخادم أثناء تحميل الزبائن');
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setLoading(false);
      }
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!form.fullName.trim()) return toast.error('أدخل اسم الزبون');

    const response = await fetch('/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) return toast.error(result.error || 'تعذر إضافة الزبون');

    toast.success('تمت إضافة الزبون');
    setForm(blankForm);
    setMobileAddOpen(false);
    await load('');
  }

  function openEdit(person: any) {
    setEditingPerson(person);
    setEditForm(formFromPerson(person));
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingPerson) return;

    setSavingPerson(true);
    try {
      const response = await fetch(`/api/people/${editingPerson.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: editForm.fullName,
          phone: editForm.phone || null,
          address: editForm.address || null,
          notes: editForm.notes || null,
          externalId: editForm.externalId || null,
          category: editForm.category,
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) return toast.error(result.error || 'تعذر تعديل الزبون');

      setItems((current) => sortByCustomerCode(current.map((person) => (person.id === result.id ? result : person))));
      setEditingPerson(null);
      toast.success('تم تعديل بيانات الزبون');
    } catch {
      toast.error('تعذر الاتصال بالخادم أثناء تعديل الزبون');
    } finally {
      setSavingPerson(false);
    }
  }

  async function archivePerson(person: any) {
    if (!window.confirm(`هل تريد أرشفة الزبون ${person.fullName}؟ لن يتم حذف بياناته نهائيًا.`)) return;
    const response = await fetch(`/api/people/${person.id}`, { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(result.error || 'تعذر أرشفة الزبون');
    setItems((current) => current.filter((item) => item.id !== person.id));
    if (selectedPersonId === person.id) closeCustomerCardsDrawer();
    toast.success('تمت أرشفة الزبون');
  }

  function setCardDraft(cardId: string, patch: CardDraft) {
    setDrafts((current) => ({ ...current, [cardId]: { ...current[cardId], ...patch } }));
  }

  function replaceCard(updated: any) {
    const personId = updated.batch?.personId;
    if (!personId) return load(q);

    setItems((current) =>
      current.map((person) => {
        if (person.id !== personId) return person;
        return {
          ...person,
          cardBatches: (person.cardBatches || []).map((batch: any) =>
            batch.id === updated.batchId || batch.id === updated.batch?.id
              ? {
                  ...batch,
                  cards: (batch.cards || []).map((card: any) => (card.id === updated.id ? { ...card, ...updated } : card)),
                }
              : batch,
          ),
        };
      }),
    );
  }

  function handleFastEntrySaved(batch: any) {
    setFastEntryOpen(false);
    setItems((current) => {
      const exists = current.some((person) => person.id === batch.personId);
      if (!exists) {
        return sortByCustomerCode([{ ...batch.person, cardBatches: [batch], cardDeliveries: [] }, ...current]);
      }

      return sortByCustomerCode(
        current.map((person) =>
          person.id === batch.personId ? { ...person, cardBatches: [batch, ...(person.cardBatches || [])] } : person,
        ),
      );
    });
    openCustomerCardsDrawer(batch.personId);
  }

  async function deleteCardOperation(card: any, operation: any) {
    if (!window.confirm('هل تريد حذف هذه العملية منطقيًا وإعادة حساب رصيد البطاقة؟')) return;
    const response = await fetch(`/api/inventory/received-cards/${card.id}/operations/${operation.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'حذف من واجهة الزبائن والبطاقات' }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(result.error || 'تعذر حذف عملية البطاقة');
    replaceCard(result);
    toast.success('تم حذف العملية وإعادة حساب الرصيد');
  }

  async function saveCard(card: any, extra: Record<string, unknown> = {}) {
    if (savingCards[card.id]) return;
    setSavingCards((current) => ({ ...current, [card.id]: true }));
    const draft = drafts[card.id] || {};
    const response = await fetch(`/api/inventory/received-cards/${card.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cardPayload(card, draft), ...extra }),
    });
    const result = await response.json().catch(() => ({}));
    setSavingCards((current) => ({ ...current, [card.id]: false }));

    if (!response.ok) return toast.error(result.error || 'تعذر حفظ البطاقة');
    replaceCard(result);
    setDrafts((current) => ({ ...current, [card.id]: {} }));
    if (result.cashboxWarning) toast.warning(result.cashboxWarning);
    toast.success('تم حفظ البطاقة');
  }

  async function deleteCard(card: any) {
    if (!window.confirm(`هل تريد حذف البطاقة ${cardCode(card)}؟ سيتم أرشفتها فقط.`)) return;
    const response = await fetch(`/api/inventory/received-cards/${card.id}`, { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(result.error || 'تعذر حذف البطاقة');
    await load(q);
    toast.success('تم حذف البطاقة منطقيًا');
  }

  async function addCards(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPerson) return;
    if (!batchForm.agreedAmountPerCard) return toast.error('أدخل السعر المتفق عليه');

    const response = await fetch('/api/inventory/received-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personId: selectedPerson.id,
        currencyId: batchForm.currencyId || null,
        cardCount: Number(batchForm.cardCount || 1),
        valueUsdPerCard: Number(batchForm.valueUsdPerCard || defaultOriginalCardValue),
        agreedAmountPerCard: Number(batchForm.agreedAmountPerCard),
        commonBankName: batchForm.commonBankName || undefined,
        notes: batchForm.notes || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(result.error || 'تعذر إضافة البطاقات');

    setItems((current) =>
      current.map((person) =>
        person.id === selectedPerson.id ? { ...person, cardBatches: [result, ...(person.cardBatches || [])] } : person,
      ),
    );
    setBatchForm({
      cardCount: '1',
      valueUsdPerCard: defaultOriginalCardValue,
      agreedAmountPerCard: '',
      currencyId: defaultCurrencyId(currencies),
      commonBankName: '',
      notes: '',
    });
    toast.success('تمت إضافة البطاقات وربطها بالزبون');
  }

  async function handleDeliverySaved() {
    setDeliveryOpen(false);
    if (selectedPersonId) await loadPersonDetails(selectedPersonId);
    await load(q);
  }

  function toggleCard(cardId: string) {
    setSelectedCards((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function toggleCardDetails(cardId: string) {
    setExpandedCardIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  async function bulkStageNext() {
    const ids = Array.from(selectedCards);
    if (!ids.length) return toast.error('حدد بطاقة واحدة على الأقل');
    if (!window.confirm(`سيتم نقل ${ids.length} بطاقة إلى المرحلة التالية. هل تريد المتابعة؟`)) return;

    await Promise.all(
      ids.map((id) =>
        fetch(`/api/inventory/received-cards/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stageAction: 'NEXT', stageAmount: 0 }),
        }),
      ),
    );
    setSelectedCards(new Set());
    await load(q);
    toast.success('تم تحديث البطاقات المحددة');
  }

  async function bulkReject() {
    const ids = Array.from(selectedCards);
    if (!ids.length) return toast.error('حدد بطاقة واحدة على الأقل');
    if (!window.confirm(`سيتم نقل ${ids.length} بطاقة إلى حالة مرفوضة أو متوقفة.`)) return;

    await Promise.all(
      ids.map((id) =>
        fetch(`/api/inventory/received-cards/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'CANCELLED' }),
        }),
      ),
    );
    setSelectedCards(new Set());
    await load(q);
    toast.success('تم تحديث البطاقات المحددة');
  }

  return (
    <>
      <form onSubmit={add} className={`card mb-5 gap-4 p-4 md:grid md:grid-cols-2 md:p-5 ${mobileAddOpen ? 'grid sheet-panel' : 'hidden'}`}>
        <input
          placeholder="اسم الزبون"
          value={form.fullName}
          onChange={(event) => setForm({ ...form, fullName: event.target.value })}
        />
        <input
          placeholder="رقم الهاتف اختياري"
          value={form.phone}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
        />
        <input
          placeholder="العنوان"
          value={form.address}
          onChange={(event) => setForm({ ...form, address: event.target.value })}
        />
        <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
          <option value="REGULAR">زبون عادي</option>
          <option value="VIP">زبون مميز</option>
        </select>
        <textarea
          className="md:col-span-2"
          placeholder="ملاحظات"
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          rows={2}
        />
        <button className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-500 md:col-span-2">
          <UserPlus size={18} />
          إضافة زبون
        </button>
      </form>

      <section className="card p-3 md:p-5">
        <div className="sticky top-2 z-20 mb-4 grid gap-2 rounded-lg bg-white/92 p-2 shadow-sm backdrop-blur dark:bg-[#0d1d33]/92 md:static md:grid-cols-[1fr_auto_auto] md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-0">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              className="pr-10"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="بحث فوري بالاسم، رقم الزبون، الهاتف أو آخر 4 أرقام من البطاقة"
            />
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 font-bold text-white dark:bg-slate-100 dark:text-slate-950"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
            بحث
          </button>
          <button
            type="button"
            onClick={() => setFastEntryOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 font-bold text-white"
          >
            <Plus size={18} />
            إضافة معاملة بطاقات
          </button>
        </div>

        <div className="table-wrap hidden md:block">
          <table>
            <thead>
              <tr>
                <th>رقم الزبون</th>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>البطاقات</th>
                <th>قيمة البطاقات</th>
                <th>السعر المتفق عليه</th>
                <th>الحالات</th>
                <th>آخر تحديث</th>
                <th>خيارات</th>
              </tr>
            </thead>
            <tbody>
              {items.map((person) => {
                const summary = personSummary(person);
                return (
                  <tr
                    key={person.id}
                    onClick={() => openCustomerCardsDrawer(person.id)}
                    className="cursor-pointer"
                  >
                    <td className="font-black text-slate-500">{person.customerNo || '—'}</td>
                    <td className="font-bold">{person.fullName}</td>
                    <td>{person.phone || '—'}</td>
                    <td>{summary.totalCards}</td>
                    <td>{formatMoney(summary.originalTotal, '$')}</td>
                    <td>{formatMoney(summary.agreedTotal, '$')}</td>
                    <td>
                      <div className="flex flex-wrap gap-1 text-xs font-bold">
                        <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700">نشطة {summary.active}</span>
                        <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">مصفاة {summary.completed}</span>
                        <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">مرفوضة {summary.rejected}</span>
                      </div>
                    </td>
                    <td>{formatDateTime(summary.lastUpdate)}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openCustomerCardsDrawer(person.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white"
                        >
                          <Eye size={16} />
                          عرض البطاقات
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEdit(person);
                          }}
                          className="rounded-lg bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100"
                          aria-label="تعديل الزبون"
                        >
                          <Edit3 size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            archivePerson(person);
                          }}
                          className="rounded-lg bg-red-50 p-2 text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-200"
                          aria-label="حذف الزبون"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!items.length ? (
                <tr>
                  <td colSpan={9} className="text-center text-slate-500">
                    {loading ? 'جار التحميل...' : 'لا توجد نتائج'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="stagger-list grid gap-3 md:hidden">
          {items.map((person, index) => {
            const summary = personSummary(person);
            const deliveryRows = customerDeliverySummary(person, currencies);
            const delivered = deliveryRows.reduce((sum: number, row: { delivered: number }) => sum + row.delivered, 0);
            const remaining = deliveryRows.reduce((sum: number, row: { remaining: number }) => sum + row.remaining, 0);
            return (
              <article
                key={person.id}
                style={{ '--stagger': index } as CSSProperties}
                className="rounded-lg border border-slate-200 bg-white p-4 text-right shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-indigo-600">{person.customerNo || '—'}</div>
                    <div className="font-black">{person.fullName}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{person.phone || 'لا يوجد هاتف'}</div>
                  </div>
                  <span className="shrink-0 rounded-md bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
                    {summary.totalCards} بطاقة
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <span className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950">المتفق: <b className="num">{formatMoney(summary.agreedTotal, '$')}</b></span>
                  <span className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950">المسلّم: <b className="num">{formatMoney(delivered, '$')}</b></span>
                  <span className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950">المتبقي: <b className="num">{formatMoney(remaining, '$')}</b></span>
                  <span className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950">آخر تحديث: <b className="num">{formatDate(summary.lastUpdate)}</b></span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1 text-xs font-bold">
                  <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700 dark:bg-blue-950 dark:text-blue-200">نشطة {summary.active}</span>
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">مكتملة {summary.completed}</span>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
                  <button
                    type="button"
                    onClick={() => openCustomerCardsDrawer(person.id)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white"
                  >
                    <Eye size={16} />
                    عرض البطاقات
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(person)}
                    className="rounded-lg bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    aria-label="تعديل الزبون"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => archivePerson(person)}
                    className="rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-200"
                    aria-label="حذف الزبون"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="fixed bottom-[calc(4.8rem+env(safe-area-inset-bottom))] left-3 z-20 flex flex-col gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setFastEntryOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-lg"
        >
          <Plus size={18} />
          بطاقات
        </button>
        <button
          type="button"
          onClick={() => setMobileAddOpen((value) => !value)}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-lg"
        >
          <UserPlus size={18} />
          زبون
        </button>
      </div>

      {selectedPerson ? (
        <ModalLayer
          name="customer-cards"
          onClose={closeCustomerCardsDrawer}
          className="md:items-stretch md:justify-start"
          rootProps={{ 'data-customer-cards-drawer': 'root' }}
        >
          <ModalBackdrop
            aria-label="إغلاق تفاصيل الزبون"
            className="bg-slate-950/45"
            onClick={closeCustomerCardsDrawer}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-cards-drawer-title"
            data-customer-cards-drawer="panel"
            className="modal-panel modal-panel--drawer sheet-panel max-w-5xl dark:bg-slate-950 md:w-[86vw]"
          >
            <div className="modal-header flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-bold text-indigo-600">{selectedPerson.customerNo || 'زبون بدون رقم'}</div>
                <h2 id="customer-cards-drawer-title" className="mt-1 text-2xl font-black">{selectedPerson.fullName}</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedPerson.phone || 'لا يوجد رقم هاتف'}</p>
                <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-300">
                  عدد البطاقات: {selectedPersonSummary?.totalCards || selectedPersonCards.length}
                </p>
              </div>
              <button
                type="button"
                onClick={closeCustomerCardsDrawer}
                className="modal-close text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق"
              >
                <X size={22} />
              </button>
            </div>

            <div className="modal-body p-4 md:p-5" data-modal-scroll-body>
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFastEntryOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
              >
                <Plus size={16} />
                إضافة معاملة بطاقات
              </button>
              <button
                type="button"
                onClick={() => setDeliveryOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white dark:bg-slate-100 dark:text-slate-950"
              >
                <Save size={16} />
                تسجيل تسليم مبلغ
              </button>
            </div>

            <section className="mb-4 grid gap-3 md:grid-cols-3">
              {selectedDeliveryRows.map((row: { currency: CurrencyOption; agreed: number; delivered: number; remaining: number }) => (
                <div key={row.currency.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="text-xs font-bold text-slate-500">{row.currency.name}</div>
                  <div className="mt-2 grid gap-1 text-sm">
                    <span>المتفق: <b>{formatMoney(row.agreed, row.currency)}</b></span>
                    <span>المسلّم: <b>{formatMoney(row.delivered, row.currency)}</b></span>
                    <span>المتبقي للتسليم: <b>{formatMoney(row.remaining, row.currency)}</b></span>
                  </div>
                </div>
              ))}
              {!selectedDeliveryRows.length ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-700">
                  لا توجد مبالغ تسليم مرتبطة ببطاقات هذا الزبون.
                </div>
              ) : null}
            </section>

            <form onSubmit={addCards} className="card hidden gap-3 p-4 md:grid md:grid-cols-6">
              <input
                type="number"
                min="1"
                placeholder="عدد البطاقات"
                value={batchForm.cardCount}
                onChange={(event) => setBatchForm({ ...batchForm, cardCount: event.target.value })}
              />
              <input
                type="number"
                min="0"
                step="0.000001"
                placeholder="القيمة الأصلية"
                value={batchForm.valueUsdPerCard}
                onChange={(event) => setBatchForm({ ...batchForm, valueUsdPerCard: event.target.value })}
              />
              <input
                type="number"
                min="0"
                step="0.000001"
                placeholder="السعر المتفق عليه"
                value={batchForm.agreedAmountPerCard}
                onChange={(event) => setBatchForm({ ...batchForm, agreedAmountPerCard: event.target.value })}
              />
              <select value={batchForm.currencyId} onChange={(event) => setBatchForm({ ...batchForm, currencyId: event.target.value })}>
                {currencies.map((currency) => (
                  <option key={currency.id} value={currency.id}>
                    {currency.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="المصرف"
                value={batchForm.commonBankName}
                onChange={(event) => setBatchForm({ ...batchForm, commonBankName: event.target.value })}
              />
              <button className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-bold text-white">
                <Plus size={18} />
                إضافة
              </button>
              <input
                className="md:col-span-6"
                placeholder="ملاحظات الدفعة"
                value={batchForm.notes}
                onChange={(event) => setBatchForm({ ...batchForm, notes: event.target.value })}
              />
            </form>

            <div className="my-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <select className="md:max-w-xs" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="ALL">كل الحالات</option>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={bulkStageNext}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white dark:bg-slate-100 dark:text-slate-950"
                >
                  <Archive size={16} />
                  تحديث المحدد
                </button>
                <button
                  type="button"
                  onClick={bulkReject}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-950 dark:text-red-200"
                >
                  <Trash2 size={16} />
                  رفض المحدد
                </button>
              </div>
            </div>

            <div className="stagger-list grid gap-4 safe-bottom">
              {loadingPersonId === selectedPersonId && !selectedPersonHasDetails ? (
                <div className="grid gap-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900"
                    />
                  ))}
                </div>
              ) : null}
              {selectedPersonHasDetails ? visibleCards.map((card: any, index: number) => {
                const draft = drafts[card.id] || {};
                const expanded = expandedCardIds.has(card.id);
                const currentStage = Math.max(0, Math.min(Number(draft.currentStage ?? card.currentStage ?? 0), 6));
                const currency = card.currency || card.batch?.currency || '$';
                const original = cardOriginal({ ...card, ...draft });
                const remainingAmount = cardDraftRemaining(card, draft);
                const deductedAmount = Math.min(cardDeducted(card, draft), original);
                const progress = cardProgressPercent(card, draft);
                return (
                  <article
                    key={card.id}
                    style={{ '--stagger': index } as CSSProperties}
                    className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="grid gap-4">
                      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-black">{cardCode(card)}</span>
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                              آخر 4 أرقام: {draft.cardLast4 ?? card.cardLast4 ?? '—'}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                            <span className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                              الأصل: <b>{formatMoney(original, currency)}</b>
                            </span>
                            <span className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                              المتبقي: <b>{formatMoney(remainingAmount, currency)}</b>
                            </span>
                            <span className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                              المسحوب: <b>{formatMoney(deductedAmount, currency)}</b>
                            </span>
                            <span className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                              النسبة: <b>{cardProgressLabel(card, draft)}</b>
                            </span>
                          </div>
                        </div>
                        <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-black ring-1 ${statusClasses[draft.status ?? card.status] || statusClasses.RECEIVED}`}>
                          {statusLabels[draft.status ?? card.status] || draft.status || card.status}
                        </span>
                      </div>

                      <div className="grid gap-2">
                        <div className="relative h-9 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className={`absolute inset-y-0 right-0 rounded-full transition-all duration-300 ${cardProgressClass(card, draft)}`}
                            style={{ width: `${progress}%` }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center text-sm font-black text-slate-900 mix-blend-multiply dark:text-white dark:mix-blend-normal">
                            {cardProgressLabel(card, draft)}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <button
                          type="button"
                          onClick={() => setOperationModal({ card })}
                          disabled={card.status === 'CANCELLED'}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950"
                        >
                          <Plus size={16} />
                          إضافة عملية
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleCardDetails(card.id)}
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2.5 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          aria-label={expanded ? 'إخفاء تفاصيل البطاقة' : 'عرض تفاصيل البطاقة'}
                        >
                          {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </button>
                      </div>
                    </div>

                    <div className={`grid overflow-hidden transition-all duration-200 ease-out ${expanded ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                      <div className="min-h-0 overflow-hidden border-t border-slate-200 pt-4 dark:border-slate-800">
                        <div className="mb-4 flex flex-wrap items-center gap-3">
                          <label className="inline-flex items-center gap-2 text-sm font-bold">
                            <input type="checkbox" checked={selectedCards.has(card.id)} onChange={() => toggleCard(card.id)} />
                            تحديد البطاقة
                          </label>
                          <span className="text-sm text-slate-500">الإضافة: {formatDate(card.createdAt)}</span>
                          <span className="text-sm text-slate-500">آخر تحديث: {formatDateTime(card.updatedAt)}</span>
                          <span className="text-sm text-slate-500">
                            آخر عملية: {card.stageLogs?.[0] ? formatDateTime(card.stageLogs[0].createdAt) : '—'}
                          </span>
                        </div>

                        <div className="grid gap-3 md:grid-cols-4">
                          <input
                            placeholder="المصرف"
                            value={draft.bankName ?? card.bankName ?? ''}
                            onChange={(event) => setCardDraft(card.id, { bankName: event.target.value })}
                          />
                          <input
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="آخر 4 أرقام"
                            value={draft.cardLast4 ?? card.cardLast4 ?? ''}
                            onChange={(event) =>
                              setCardDraft(card.id, { cardLast4: event.target.value.replace(/\D/g, '').slice(0, 4) })
                            }
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.000001"
                            placeholder="القيمة الأصلية"
                            value={draft.valueUsd ?? normalizeDraftValue(card.valueUsd)}
                            onChange={(event) => setCardDraft(card.id, { valueUsd: event.target.value })}
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.000001"
                            placeholder="السعر المتفق عليه"
                            value={draft.agreedAmount ?? normalizeDraftValue(card.agreedAmount)}
                            onChange={(event) => setCardDraft(card.id, { agreedAmount: event.target.value })}
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.000001"
                            placeholder="إجمالي المسحوب"
                            value={draft.receivedAmount ?? normalizeDraftValue(card.receivedAmount)}
                            onChange={(event) => setCardDraft(card.id, { receivedAmount: event.target.value })}
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.000001"
                            placeholder="مبلغ التسليم/الاستلام"
                            value={draft.settlementAmount ?? normalizeDraftValue(card.settlementAmount)}
                            onChange={(event) => setCardDraft(card.id, { settlementAmount: event.target.value })}
                          />
                          <select
                            value={draft.settlementPaymentMethod ?? card.settlementPaymentMethod ?? 'USD_CASH'}
                            onChange={(event) => setCardDraft(card.id, { settlementPaymentMethod: event.target.value })}
                          >
                            {settlementMethods.map((method) => (
                              <option key={method} value={method}>
                                {detailedPaymentLabels[method as keyof typeof detailedPaymentLabels] || method}
                              </option>
                            ))}
                          </select>
                          <select
                            value={draft.status ?? card.status}
                            onChange={(event) => setCardDraft(card.id, { status: event.target.value })}
                          >
                            {statusOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="0"
                            step="0.000001"
                            placeholder="مبلغ السحب لهذه المرحلة"
                            value={draft.stageAmount ?? ''}
                            onChange={(event) => setCardDraft(card.id, { stageAmount: event.target.value })}
                          />
                          <input
                            className="md:col-span-2"
                            placeholder="ملاحظات المرحلة"
                            value={draft.stageNote ?? ''}
                            onChange={(event) => setCardDraft(card.id, { stageNote: event.target.value })}
                          />
                          <input
                            className="md:col-span-1"
                            placeholder="ملاحظات البطاقة"
                            value={draft.notes ?? card.notes ?? ''}
                            onChange={(event) => setCardDraft(card.id, { notes: event.target.value })}
                          />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setOperationModal({ card, initialType: 'REJECT' })}
                        disabled={card.status === 'CANCELLED'}
                        className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-950 dark:text-red-200"
                      >
                        <Trash2 size={16} />
                        رفض
                      </button>
                      <button
                        type="button"
                        onClick={() => saveCard(card, { stageAction: 'PREVIOUS', stageAmount: 0 })}
                        disabled={savingCards[card.id] || currentStage === 0}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
                      >
                        <ChevronRight size={16} />
                        المرحلة السابقة
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          saveCard(card, {
                            stageAction: 'NEXT',
                            stageAmount: Number(draft.stageAmount || 0),
                            stageNote: draft.stageNote || null,
                          })
                        }
                        disabled={savingCards[card.id] || currentStage === 6}
                        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-indigo-400"
                      >
                        <ChevronLeft size={16} />
                        المرحلة التالية
                      </button>
                      <button
                        type="button"
                        onClick={() => saveCard(card)}
                        disabled={savingCards[card.id]}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-emerald-400"
                      >
                        {savingCards[card.id] ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        حفظ البطاقة
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCard(card)}
                        className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-950 dark:text-red-200"
                      >
                        <Trash2 size={16} />
                        حذف
                      </button>
                        </div>

                        <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                          <div className="mb-2 text-sm font-black">سجل عمليات البطاقة</div>
                          <div className="grid gap-2">
                            {(card.operations || []).slice(0, 8).map((operation: any) => (
                              <div key={operation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2 text-sm dark:border-slate-800 dark:bg-slate-900">
                                <div>
                                  <b>{cardOperationTypeLabels[operation.operationType as keyof typeof cardOperationTypeLabels] || operation.operationType}</b>
                                  <span className="mx-2 text-slate-400">|</span>
                                  {formatMoney(operation.amount, currency)}
                                  <span className="mx-2 text-slate-400">|</span>
                                  {formatDateTime(operation.occurredAt)}
                                  {operation.note || operation.reason ? <span className="ms-2 text-slate-500">{operation.note || operation.reason}</span> : null}
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setOperationModal({ card, operation })}
                                    className="rounded-lg bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    aria-label="تعديل عملية البطاقة"
                                  >
                                    <Edit3 size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteCardOperation(card, operation)}
                                    className="rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-200"
                                    aria-label="حذف عملية البطاقة"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              </div>
                            ))}
                            {!card.operations?.length ? <div className="text-sm text-slate-500">لا توجد عمليات بعد.</div> : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              }) : null}
              {selectedPersonHasDetails && !visibleCards.length ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
                  لا توجد بطاقات بهذه الحالة.
                </div>
              ) : null}
            </div>
            </div>
          </aside>
        </ModalLayer>
      ) : null}

      {editingPerson ? (
        <ModalLayer name="edit-person" onClose={() => setEditingPerson(null)}>
          <ModalBackdrop onClick={() => setEditingPerson(null)} />
          <form
            onSubmit={saveEdit}
            className="modal-panel modal-panel--auto sheet-panel max-w-2xl dark:bg-slate-900"
          >
            <div className="modal-header flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black">تعديل بيانات الزبون</h2>
                <p className="mt-1 text-sm text-slate-500">{editingPerson.customerNo || ''}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingPerson(null)}
                className="modal-close text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق تعديل الزبون"
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body grid gap-4 p-5 md:grid-cols-2" data-modal-scroll-body>
              <input value={editForm.fullName} onChange={(event) => setEditForm({ ...editForm, fullName: event.target.value })} placeholder="الاسم" />
              <input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} placeholder="رقم الهاتف" />
              <input value={editForm.address} onChange={(event) => setEditForm({ ...editForm, address: event.target.value })} placeholder="العنوان" />
              <select value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}>
                <option value="REGULAR">زبون عادي</option>
                <option value="VIP">زبون مميز</option>
              </select>
              <textarea
                className="md:col-span-2"
                value={editForm.notes}
                onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
                placeholder="ملاحظات"
                rows={3}
              />
            </div>

            <div className="modal-footer grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setEditingPerson(null)}
                className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                disabled={savingPerson}
                className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-400"
              >
                <Save size={18} />
                {savingPerson ? 'جار الحفظ...' : 'حفظ التعديل'}
              </button>
            </div>
          </form>
        </ModalLayer>
      ) : null}

      {fastEntryOpen ? (
        <FastCardEntryModal
          people={items}
          selectedPerson={selectedPerson}
          currencies={currencies}
          onClose={() => setFastEntryOpen(false)}
          onSaved={handleFastEntrySaved}
        />
      ) : null}

      {operationModal ? (
        <CardOperationModal
          card={operationModal.card}
          operation={operationModal.operation}
          initialType={operationModal.initialType}
          onClose={() => setOperationModal(null)}
          onSaved={(card) => {
            replaceCard(card);
            setOperationModal(null);
          }}
        />
      ) : null}

      {deliveryOpen && selectedPerson ? (
        <CustomerDeliveryModal
          person={selectedPerson}
          rows={selectedDeliveryRows}
          currencies={currencies}
          onClose={() => setDeliveryOpen(false)}
          onSaved={handleDeliverySaved}
        />
      ) : null}
    </>
  );
}
