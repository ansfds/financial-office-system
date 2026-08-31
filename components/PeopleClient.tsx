'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, UIEvent } from 'react';
import dynamic from 'next/dynamic';
import {
  Archive,
  Banknote,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  Edit3,
  Eye,
  HandCoins,
  ImagePlus,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  WalletCards,
  UserPlus,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatDateTime, formatMoney, numberValue } from '@/lib/format';
import { detailedPaymentLabels } from '@/lib/payment-methods';
import ModalLayer, { ModalBackdrop } from '@/components/ModalLayer';
import { STANDARD_CUSTOMER_CARD_VALUE_USD, cardOperationTypeLabels } from '@/lib/customer-cards';
import { compareCardsBySequence, sortByCustomerCode } from '@/lib/customer-code-sort';
import { processCardImageFile, type ProcessedCardImage } from '@/components/card-image-tools';

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
  rejectReason?: string;
  notes?: string;
  stageAmount?: string;
  stageNote?: string;
  currentStage?: string;
  cardImageDataUrl?: string | null;
  cardThumbnailDataUrl?: string | null;
  cardImageMimeType?: ProcessedCardImage['cardImageMimeType'] | null;
  cardImageSize?: number | null;
};

type StageUndoAction = {
  cardId: string;
  cardLabel: string;
  stage: number;
  previousStage: number;
  operationId?: string;
};

type ImageViewerState = {
  src: string;
  label: string;
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
const workflowStages = [1, 2, 3, 4, 5] as const;

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

function displayLast4(card: any, draft: CardDraft = {}) {
  return draft.cardLast4 ?? card.cardLast4 ?? '----';
}

function cardImageSrc(card: any, draft: CardDraft = {}) {
  return draft.cardThumbnailDataUrl || card.cardThumbnailDataUrl || draft.cardImageDataUrl || card.cardImageDataUrl || '';
}

function cardFullImageSrc(card: any, draft: CardDraft = {}) {
  return draft.cardImageDataUrl || card.cardImageDataUrl || cardImageSrc(card, draft);
}

function isCardSettled(card: any, draft: CardDraft = {}) {
  const status = draft.status ?? card.status;
  return ['SETTLED', 'COMPLETED'].includes(status) || Number(draft.currentStage ?? card.currentStage ?? 0) >= 5;
}

function isCardStopped(card: any, draft: CardDraft = {}) {
  return (draft.status ?? card.status) === 'CANCELLED';
}

function stageLabel(stage: number) {
  if (stage === 5) return 'التصفية';
  return `مرحلة ${stage}`;
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
  const payload: Record<string, unknown> = {
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
    rejectReason: draft.rejectReason ?? card.rejectReason ?? null,
    notes: draft.notes ?? card.notes ?? null,
  };

  if (draft.cardImageDataUrl !== undefined) payload.cardImageDataUrl = draft.cardImageDataUrl;
  if (draft.cardThumbnailDataUrl !== undefined) payload.cardThumbnailDataUrl = draft.cardThumbnailDataUrl;
  if (draft.cardImageMimeType !== undefined) payload.cardImageMimeType = draft.cardImageMimeType;
  if (draft.cardImageSize !== undefined) payload.cardImageSize = draft.cardImageSize;

  return payload;
}

function updateCardInPerson(person: any, updated: any) {
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
}

function addBatchToPerson(person: any, batch: any) {
  const existingBatches = person.cardBatches || [];
  const withoutDuplicate = existingBatches.filter((item: any) => item.id !== batch.id);
  return { ...person, cardBatches: [batch, ...withoutDuplicate] };
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
  const [stageAnimations, setStageAnimations] = useState<Record<string, boolean>>({});
  const [stageHolds, setStageHolds] = useState<Record<string, boolean>>({});
  const [optimisticStages, setOptimisticStages] = useState<Record<string, number>>({});
  const [stageUndo, setStageUndo] = useState<StageUndoAction | null>(null);
  const [celebration, setCelebration] = useState<{ cardId: string; label: string } | null>(null);
  const [imageViewer, setImageViewer] = useState<ImageViewerState | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [processingCardImageId, setProcessingCardImageId] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [mobileAddOpen, setMobileAddOpen] = useState(false);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const [customerHeaderHidden, setCustomerHeaderHidden] = useState(false);
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
  const stageHoldTimersRef = useRef<Record<string, number>>({});
  const stageUndoTimerRef = useRef<number | null>(null);
  const activeStageSaveRef = useRef<Record<string, boolean>>({});
  const customerHeaderScrollRef = useRef(0);
  const customerHeaderTickingRef = useRef(false);

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
  const selectedDeliveryRemaining = useMemo(
    () =>
      selectedDeliveryRows
        .filter((row: { remaining: number }) => row.remaining > 0)
        .map((row: { currency: CurrencyOption; remaining: number }) => formatMoney(row.remaining, row.currency))
        .join(' • ') || '0',
    [selectedDeliveryRows],
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
    setStageUndo(null);
    setCustomerHeaderHidden(false);
  }, []);

  const openCustomerCardsDrawer = useCallback((personId: string) => {
    if (!personId) return;
    setStatusFilter('ALL');
    setCustomerHeaderHidden(false);
    customerHeaderScrollRef.current = 0;
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
    const stageHoldTimers = stageHoldTimersRef.current;
    return () => {
      detailAbortRef.current?.abort();
      searchAbortRef.current?.abort();
      Object.values(stageHoldTimers).forEach((timer) => window.clearTimeout(timer));
      if (stageUndoTimerRef.current) window.clearTimeout(stageUndoTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    let ticking = false;

    function syncToolbarVisibility() {
      const nextScrollY = window.scrollY;
      if (nextScrollY < 72) {
        setToolbarHidden(false);
      } else if (nextScrollY > lastScrollY + 12) {
        setToolbarHidden(true);
      } else if (nextScrollY < lastScrollY - 12) {
        setToolbarHidden(false);
      }
      lastScrollY = nextScrollY;
      ticking = false;
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(syncToolbarVisibility);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function handleCustomerDrawerScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    if (customerHeaderTickingRef.current) return;

    customerHeaderTickingRef.current = true;
    window.requestAnimationFrame(() => {
      const nextScrollTop = target.scrollTop;
      const lastScrollTop = customerHeaderScrollRef.current;

      if (nextScrollTop < 24) {
        setCustomerHeaderHidden(false);
      } else if (nextScrollTop > lastScrollTop + 16) {
        setCustomerHeaderHidden(true);
      } else if (nextScrollTop < lastScrollTop - 16) {
        setCustomerHeaderHidden(false);
      }

      customerHeaderScrollRef.current = nextScrollTop;
      customerHeaderTickingRef.current = false;
    });
  }

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

  function haptic(pattern: number | number[] = 18) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }

  async function attachCardImage(cardId: string, file?: File | null) {
    if (!file) return;
    setProcessingCardImageId(cardId);
    try {
      const image = await processCardImageFile(file);
      setCardDraft(cardId, {
        cardImageDataUrl: image.cardImageDataUrl,
        cardThumbnailDataUrl: image.cardThumbnailDataUrl,
        cardImageMimeType: image.cardImageMimeType,
        cardImageSize: image.cardImageSize,
      });
      toast.success('تم تجهيز صورة البطاقة');
    } catch (error) {
      const message = (error as Error).message;
      toast.error(
        message === 'IMAGE_TOO_LARGE'
          ? 'الصورة ما زالت كبيرة بعد الضغط'
          : message === 'INVALID_IMAGE_TYPE'
            ? 'اختر صورة صحيحة'
            : 'تعذر تجهيز الصورة',
      );
    } finally {
      setProcessingCardImageId('');
    }
  }

  function openCardImageViewer(card: any, draft: CardDraft = {}) {
    const src = cardFullImageSrc(card, draft);
    if (!src) return;
    setImageZoom(1);
    setImageViewer({ src, label: `**** ${displayLast4(card, draft)}` });
  }

  function animationKey(cardId: string, stage: number) {
    return `${cardId}-${stage}`;
  }

  function replaceCard(updated: any) {
    const personId = updated.batch?.personId;
    if (!personId) return load(q);

    setItems((current) => current.map((person) => (person.id === personId ? updateCardInPerson(person, updated) : person)));
    setDetailCache((current) =>
      current[personId] ? { ...current, [personId]: updateCardInPerson(current[personId], updated) } : current,
    );
  }

  function handleFastEntrySaved(batch: any) {
    setItems((current) => {
      const exists = current.some((person) => person.id === batch.personId);
      if (!exists) {
        return sortByCustomerCode([{ ...batch.person, cardBatches: [batch], cardDeliveries: [] }, ...current]);
      }

      return sortByCustomerCode(
        current.map((person) => (person.id === batch.personId ? addBatchToPerson(person, batch) : person)),
      );
    });
    setDetailCache((current) =>
      current[batch.personId] ? { ...current, [batch.personId]: addBatchToPerson(current[batch.personId], batch) } : current,
    );
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
    const draft = drafts[card.id] || {};
    const status = (extra.status as string | undefined) || draft.status || card.status;
    const rejectReason = (extra.rejectReason as string | undefined) || draft.rejectReason || card.rejectReason;
    if (status === 'CANCELLED' && !String(rejectReason || '').trim()) {
      return toast.error('اكتب سبب إيقاف أو رفض البطاقة قبل الحفظ');
    }
    setSavingCards((current) => ({ ...current, [card.id]: true }));
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

  function clearStageHold(key: string) {
    const timer = stageHoldTimersRef.current[key];
    if (timer) window.clearTimeout(timer);
    delete stageHoldTimersRef.current[key];
    setStageHolds((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function beginStageHold(card: any, stage: number, enabled: boolean) {
    if (!enabled) return;
    const key = animationKey(card.id, stage);
    if (stageHoldTimersRef.current[key]) return;

    haptic(8);
    setStageHolds((current) => ({ ...current, [key]: true }));
    stageHoldTimersRef.current[key] = window.setTimeout(() => {
      clearStageHold(key);
      void advanceCardStage(card, stage);
    }, 420);
  }

  function cancelStageHold(cardId: string, stage: number) {
    clearStageHold(animationKey(cardId, stage));
  }

  function clearOptimisticStage(cardId: string) {
    setOptimisticStages((current) => {
      if (current[cardId] === undefined) return current;
      const next = { ...current };
      delete next[cardId];
      return next;
    });
  }

  function queueStageUndo(action: StageUndoAction) {
    if (stageUndoTimerRef.current) window.clearTimeout(stageUndoTimerRef.current);
    setStageUndo(action);
    stageUndoTimerRef.current = window.setTimeout(() => {
      setStageUndo((current) => (current?.cardId === action.cardId && current.stage === action.stage ? null : current));
    }, 6000);
  }

  async function undoStageAction() {
    const action = stageUndo;
    if (!action || savingCards[action.cardId]) return;

    if (stageUndoTimerRef.current) window.clearTimeout(stageUndoTimerRef.current);
    setStageUndo(null);
    setSavingCards((current) => ({ ...current, [action.cardId]: true }));
    setOptimisticStages((current) => ({ ...current, [action.cardId]: action.previousStage }));

    try {
      let result: any = null;
      if (action.operationId) {
        const deleteResponse = await fetch(`/api/inventory/received-cards/${action.cardId}/operations/${action.operationId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: `تراجع سريع عن ${stageLabel(action.stage)}` }),
        });
        result = await deleteResponse.json().catch(() => ({}));
        if (!deleteResponse.ok) {
          clearOptimisticStage(action.cardId);
          toast.error(result.error || 'تعذر التراجع عن التصفية');
          return;
        }
        replaceCard(result);
      }

      const response = await fetch(`/api/inventory/received-cards/${action.cardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentStage: action.previousStage,
          stageAmount: 0,
          stageNote: `تراجع عن ${stageLabel(action.stage)}`,
        }),
      });
      result = await response.json().catch(() => ({}));
      if (!response.ok) {
        clearOptimisticStage(action.cardId);
        toast.error(result.error || 'تعذر تثبيت التراجع');
        return;
      }

      replaceCard(result);
      clearOptimisticStage(action.cardId);
      toast.success('تم التراجع');
    } catch {
      clearOptimisticStage(action.cardId);
      toast.error('تعذر الاتصال بالخادم أثناء التراجع');
    } finally {
      setSavingCards((current) => ({ ...current, [action.cardId]: false }));
    }
  }

  async function advanceCardStage(card: any, targetStage: number) {
    const draft = drafts[card.id] || {};
    const currentStage = Math.max(0, Math.min(Number(optimisticStages[card.id] ?? draft.currentStage ?? card.currentStage ?? 0), 5));
    const terminal = isCardSettled(card, draft) || isCardStopped(card, draft);
    const key = animationKey(card.id, targetStage);
    const previousStage = currentStage;

    if (terminal) return;
    if (targetStage !== currentStage + 1) {
      return toast.error('نفّذ المراحل بالترتيب');
    }
    if (savingCards[card.id] || activeStageSaveRef.current[card.id]) return;

    activeStageSaveRef.current[card.id] = true;
    haptic(targetStage === 5 ? [20, 35, 24] : 18);
    setStageAnimations((current) => ({ ...current, [key]: true }));
    setOptimisticStages((current) => ({ ...current, [card.id]: targetStage }));
    setSavingCards((current) => ({ ...current, [card.id]: true }));

    try {
      const response =
        targetStage === 5
          ? await fetch(`/api/inventory/received-cards/${card.id}/operations`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                operationType: 'FINAL_SETTLEMENT',
                note: 'تمت تصفية البطاقة بالكامل من شريط المراحل',
              }),
            })
          : await fetch(`/api/inventory/received-cards/${card.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...cardPayload(card, draft),
                stageAction: 'NEXT',
                stageAmount: Number(draft.stageAmount || 0),
                stageNote: draft.stageNote || `تم تنفيذ ${stageLabel(targetStage)}`,
              }),
            });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(result.error || 'تعذر تنفيذ المرحلة');
        clearOptimisticStage(card.id);
        return;
      }

      replaceCard(result);
      clearOptimisticStage(card.id);
      setDrafts((current) => ({ ...current, [card.id]: {} }));
      if (result.cashboxWarning) toast.warning(result.cashboxWarning);
      queueStageUndo({
        cardId: card.id,
        cardLabel: displayLast4(result),
        stage: targetStage,
        previousStage,
        operationId:
          targetStage === 5
            ? (result.operations || []).find((operation: any) => operation.operationType === 'FINAL_SETTLEMENT' && !operation.deletedAt)?.id
            : undefined,
      });
      if (targetStage === 5) {
        setCelebration({ cardId: card.id, label: displayLast4(result) });
        window.setTimeout(() => setCelebration((current) => (current?.cardId === card.id ? null : current)), 2600);
        toast.success('مبروك، تمت تصفية البطاقة بالكامل');
      } else {
        toast.success(`تم تنفيذ ${stageLabel(targetStage)} - يمكنك التراجع خلال لحظات`);
      }
    } catch {
      clearOptimisticStage(card.id);
      toast.error('تعذر الاتصال بالخادم أثناء تنفيذ المرحلة');
    } finally {
      window.setTimeout(() => {
        setStageAnimations((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }, 360);
      delete activeStageSaveRef.current[card.id];
      setSavingCards((current) => ({ ...current, [card.id]: false }));
    }
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

    setItems((current) => current.map((person) => (person.id === selectedPerson.id ? addBatchToPerson(person, result) : person)));
    setDetailCache((current) =>
      current[selectedPerson.id] ? { ...current, [selectedPerson.id]: addBatchToPerson(current[selectedPerson.id], result) } : current,
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
    const reason = window.prompt('اكتب سبب إيقاف أو رفض البطاقات المحددة');
    if (!reason?.trim()) return toast.error('سبب الإيقاف مطلوب');

    await Promise.all(
      ids.map((id) =>
        fetch(`/api/inventory/received-cards/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'CANCELLED', rejectReason: reason.trim() }),
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
        <div className={`people-toolbar mb-3 grid gap-2 md:mb-4 md:grid-cols-[1fr_auto_auto] ${toolbarHidden ? 'people-toolbar--hidden' : ''}`}>
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              className="h-10 pr-9 text-sm md:h-auto md:text-base"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="بحث فوري بالاسم، رقم الزبون، الهاتف أو آخر 4 أرقام من البطاقة"
            />
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white dark:bg-slate-100 dark:text-slate-950 md:px-5 md:text-base"
            aria-label="بحث"
          >
            {loading ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />}
            <span className="hidden sm:inline">بحث</span>
          </button>
          <button
            type="button"
            onClick={() => setFastEntryOpen(true)}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white md:px-5 md:text-base"
          >
            <Plus size={17} />
            <span className="hidden sm:inline">إضافة بطاقة جديدة</span>
            <span className="sm:hidden">بطاقة</span>
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
                    onMouseEnter={() => {
                      if (!detailCache[person.id]) void loadPersonDetails(person.id);
                    }}
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
                className="customer-compact-row rounded-lg border border-slate-200 bg-white text-right shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <button
                  type="button"
                  onClick={() => openCustomerCardsDrawer(person.id)}
                  onPointerEnter={() => {
                    if (!detailCache[person.id]) void loadPersonDetails(person.id);
                  }}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 text-right"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-[11px] font-black text-indigo-600">{person.customerNo || '—'}</span>
                      <span className="truncate text-sm font-black">{person.fullName}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-500">
                      <span>{summary.totalCards} بطاقة</span>
                      <span>نشطة {summary.active}</span>
                      <span>مصفاة {summary.completed}</span>
                      <span>متبقي <b className="num text-slate-800 dark:text-slate-100">{formatMoney(remaining, '$')}</b></span>
                    </div>
                  </div>
                  <ChevronLeft className="text-slate-400" size={18} />
                </button>
                <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                  <div className="truncate text-[11px] font-bold text-slate-500">
                    آخر تحديث: <span className="num">{formatDate(summary.lastUpdate)}</span>
                    {delivered > 0 ? <span className="ms-2">مسلّم: <b className="num">{formatMoney(delivered, '$')}</b></span> : null}
                  </div>
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
          بطاقة جديدة
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
            <div className={`modal-header customer-drawer-header flex items-start justify-between gap-2 ${customerHeaderHidden ? 'customer-drawer-header--hidden' : ''}`}>
              <div className="min-w-0">
                <div className="text-xs font-bold text-indigo-600">{selectedPerson.customerNo || 'زبون بدون رقم'}</div>
                <h2 id="customer-cards-drawer-title" className="mt-0.5 truncate text-base font-black md:text-lg">{selectedPerson.fullName}</h2>
                <p className="mt-0.5 truncate text-[11px] font-bold text-slate-500 md:text-xs">{selectedPerson.phone || 'لا يوجد رقم هاتف'}</p>
                <div className="customer-summary-strip mt-1.5">
                  <span>{selectedPersonSummary?.totalCards || selectedPersonCards.length} بطاقات</span>
                  <span>{selectedPersonSummary?.active || 0} نشطة</span>
                  <span>{selectedPersonSummary?.completed || 0} مصفاة</span>
                  <span>{selectedPersonSummary?.rejected || 0} متوقفة</span>
                  <span>المتبقي: <b className="num">{selectedDeliveryRemaining}</b></span>
                </div>
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

            <div className="modal-body p-3 md:p-4" data-modal-scroll-body onScroll={handleCustomerDrawerScroll}>
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFastEntryOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
              >
                <Plus size={16} />
                إضافة بطاقة
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

            <section className="customer-delivery-inline mb-4">
              {selectedDeliveryRows.map((row: { currency: CurrencyOption; agreed: number; delivered: number; remaining: number }) => (
                <span key={row.currency.id} title={row.currency.name}>
                  {row.currency.code}: متفق <b className="num">{formatMoney(row.agreed, row.currency)}</b>
                  <span>مسلم <b className="num">{formatMoney(row.delivered, row.currency)}</b></span>
                  <span>متبقي <b className="num">{formatMoney(row.remaining, row.currency)}</b></span>
                </span>
              ))}
              {!selectedDeliveryRows.length ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-bold text-slate-500 dark:border-slate-700">
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

            {stageUndo ? (
              <div className="stage-undo-banner" role="status" aria-live="polite">
                <span>
                  تم تنفيذ {stageLabel(stageUndo.stage)} ✓
                  <b className="num"> {stageUndo.cardLabel}</b>
                </span>
                <button type="button" onClick={undoStageAction} disabled={savingCards[stageUndo.cardId]}>
                  {savingCards[stageUndo.cardId] ? <Loader2 className="animate-spin" size={15} /> : <RotateCcw size={15} />}
                  تراجع
                </button>
              </div>
            ) : null}

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
                const optimisticStage = optimisticStages[card.id];
                const currentStage = Math.max(0, Math.min(Number(optimisticStage ?? draft.currentStage ?? card.currentStage ?? 0), 5));
                const currency = card.currency || card.batch?.currency || '$';
                const original = cardOriginal({ ...card, ...draft });
                const optimisticFinal = currentStage >= 5 && optimisticStage !== undefined;
                const remainingAmount = optimisticFinal ? 0 : cardDraftRemaining(card, draft);
                const deductedAmount = optimisticFinal ? original : Math.min(cardDeducted(card, draft), original);
                const progress = optimisticFinal ? 100 : cardProgressPercent(card, draft);
                const statusKey = optimisticFinal ? 'SETTLED' : draft.status ?? card.status;
                const settled = optimisticFinal || isCardSettled(card, draft);
                const stopped = isCardStopped(card, draft);
                const terminal = settled || stopped;
                const imageSrc = cardImageSrc(card, draft);
                const last4 = displayLast4(card, draft);
                return (
                  <article
                    key={card.id}
                    style={{ '--stagger': index } as CSSProperties}
                    className={`customer-card-card rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-4 ${
                      settled ? 'customer-card-terminal customer-card-settled' : ''
                    } ${stopped ? 'customer-card-terminal customer-card-stopped' : ''}`}
                  >
                    <div className="customer-card-image-wrap">
                      {imageSrc ? (
                        <button
                          type="button"
                          className="customer-card-image-button"
                          onClick={() => openCardImageViewer(card, draft)}
                          aria-label={`فتح صورة البطاقة ${last4}`}
                        >
                          <img
                            src={imageSrc}
                            alt={`صورة البطاقة ${last4}`}
                            loading="lazy"
                            className="customer-card-image"
                          />
                          <span className="customer-card-image-action" aria-hidden="true">
                            <Maximize2 size={16} />
                          </span>
                        </button>
                      ) : (
                        <div className="customer-card-placeholder">
                          <ImagePlus size={38} />
                          <span>لا توجد صورة للبطاقة</span>
                        </div>
                      )}
                      {settled ? (
                        <div className="customer-card-state-overlay text-emerald-600">
                          <CheckCircle2 size={66} />
                          <b>تمت التصفية بالكامل</b>
                        </div>
                      ) : null}
                      {stopped ? (
                        <div className="customer-card-state-overlay text-red-600">
                          <XCircle size={66} />
                          <b>البطاقة متوقفة</b>
                          {card.rejectReason ? <span>السبب: {card.rejectReason}</span> : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="grid gap-4">
                      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-black">{cardCode(card)}</span>
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                              **** {last4}
                            </span>
                          </div>
                          <div className="card-metric-row mt-3">
                            <span className="card-metric-chip" title="قيمة البطاقة" aria-label={`قيمة البطاقة ${formatMoney(original, currency)}`}>
                              <WalletCards size={14} />
                              <b className="num">{formatMoney(original, currency)}</b>
                            </span>
                            <span className="card-metric-chip" title="المتفق عليه" aria-label={`المتفق عليه ${formatMoney(draft.agreedAmount ?? card.agreedAmount, currency)}`}>
                              <HandCoins size={14} />
                              <b className="num">{formatMoney(draft.agreedAmount ?? card.agreedAmount, currency)}</b>
                            </span>
                            <span className="card-metric-chip" title="المستلم أو المسحوب" aria-label={`المستلم أو المسحوب ${formatMoney(deductedAmount, currency)}`}>
                              <Banknote size={14} />
                              <b className="num">{formatMoney(deductedAmount, currency)}</b>
                            </span>
                            <span className="card-metric-chip card-metric-chip--remaining" title="المتبقي" aria-label={`المتبقي ${formatMoney(remainingAmount, currency)}`}>
                              <CircleDollarSign size={14} />
                              <b className="num">{formatMoney(remainingAmount, currency)}</b>
                            </span>
                          </div>
                        </div>
                        <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-black ring-1 ${statusClasses[statusKey] || statusClasses.RECEIVED}`}>
                          {statusLabels[statusKey] || statusKey}
                        </span>
                      </div>

                      {(draft.notes ?? card.notes) ? (
                        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                          <b>الملاحظات: </b>
                          {draft.notes ?? card.notes}
                        </div>
                      ) : null}

                      <div className="grid gap-2">
                        <div className="relative h-9 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className={`absolute inset-y-0 right-0 rounded-full transition-all duration-300 ${optimisticFinal ? 'bg-emerald-500' : cardProgressClass(card, draft)}`}
                            style={{ width: `${progress}%` }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center text-sm font-black text-slate-900 mix-blend-multiply dark:text-white dark:mix-blend-normal">
                            {optimisticFinal ? '100%' : cardProgressLabel(card, draft)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-5 gap-2" aria-label="مراحل البطاقة">
                        {workflowStages.map((stage) => {
                          const done = settled || currentStage >= stage;
                          const next = stage === currentStage + 1;
                          const final = stage === 5;
                          const key = animationKey(card.id, stage);
                          const running = stageAnimations[key];
                          const holding = stageHolds[key];
                          const enabled = !terminal && !savingCards[card.id] && next;
                          return (
                            <button
                              type="button"
                              key={stage}
                              onPointerDown={(event) => {
                                event.preventDefault();
                                beginStageHold(card, stage, enabled);
                              }}
                              onPointerUp={() => cancelStageHold(card.id, stage)}
                              onPointerCancel={() => cancelStageHold(card.id, stage)}
                              onPointerLeave={() => cancelStageHold(card.id, stage)}
                              onKeyDown={(event) => {
                                if ((event.key === 'Enter' || event.key === ' ') && enabled) {
                                  event.preventDefault();
                                  void advanceCardStage(card, stage);
                                }
                              }}
                              disabled={!enabled}
                              aria-label={`تنفيذ ${stageLabel(stage)}`}
                              title={next && !done ? `اضغط مطولًا لتنفيذ ${stageLabel(stage)}` : stageLabel(stage)}
                              className={`card-stage-tile ${final ? 'card-stage-final' : 'card-stage-normal'} ${
                                done ? 'card-stage-done' : ''
                              } ${running ? 'card-stage-animating' : ''} ${holding ? 'card-stage-holding' : ''}`}
                            >
                              {done ? <Check size={22} /> : stage}
                            </button>
                          );
                        })}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <button
                          type="button"
                          onClick={() => setOperationModal({ card })}
                          disabled={terminal}
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

                        <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950 md:grid-cols-[minmax(12rem,18rem)_1fr] md:items-center">
                          <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-800">
                            {imageSrc ? (
                              <button
                                type="button"
                                onClick={() => openCardImageViewer(card, draft)}
                                className="h-full w-full"
                                aria-label={`فتح صورة البطاقة ${last4}`}
                              >
                                <img src={imageSrc} alt={`صورة البطاقة ${last4}`} className="h-full w-full object-contain" loading="lazy" />
                              </button>
                            ) : (
                              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
                                <ImagePlus size={30} />
                                <span className="text-sm font-bold">لا توجد صورة</span>
                              </div>
                            )}
                          </div>
                          <div className="grid gap-2">
                            <input
                              id={`manage-card-image-${card.id}`}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="sr-only"
                              onChange={(event) => {
                                void attachCardImage(card.id, event.target.files?.[0]);
                                event.currentTarget.value = '';
                              }}
                            />
                            <label
                              htmlFor={`manage-card-image-${card.id}`}
                              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white dark:bg-slate-100 dark:text-slate-950"
                            >
                              {processingCardImageId === card.id ? <Loader2 className="animate-spin" size={16} /> : imageSrc ? <RotateCcw size={16} /> : <Camera size={16} />}
                              {imageSrc ? 'تغيير صورة البطاقة' : 'تصوير البطاقة'}
                            </label>
                            {imageSrc ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setCardDraft(card.id, {
                                    cardImageDataUrl: null,
                                    cardThumbnailDataUrl: null,
                                    cardImageMimeType: null,
                                    cardImageSize: null,
                                  })
                                }
                                className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-950 dark:text-red-200"
                              >
                                <Trash2 size={16} />
                                حذف الصورة
                              </button>
                            ) : null}
                          </div>
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
                          {(draft.status ?? card.status) === 'CANCELLED' ? (
                            <input
                              className="md:col-span-2"
                              placeholder="سبب الإيقاف أو الرفض"
                              value={draft.rejectReason ?? card.rejectReason ?? ''}
                              onChange={(event) => setCardDraft(card.id, { rejectReason: event.target.value })}
                            />
                          ) : null}
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
                        disabled={terminal}
                        className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-950 dark:text-red-200"
                      >
                        <Trash2 size={16} />
                        رفض
                      </button>
                      <button
                        type="button"
                        onClick={() => saveCard(card, { stageAction: 'PREVIOUS', stageAmount: 0 })}
                        disabled={savingCards[card.id] || terminal || currentStage === 0}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
                      >
                        <ChevronRight size={16} />
                        المرحلة السابقة
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const nextStage = currentStage + 1;
                          if (window.confirm(`تنفيذ ${stageLabel(nextStage)}؟`)) void advanceCardStage(card, nextStage);
                        }}
                        disabled={savingCards[card.id] || terminal || currentStage >= 5}
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

      {imageViewer ? (
        <ModalLayer name="card-image-viewer" onClose={() => setImageViewer(null)} className="items-stretch justify-stretch">
          <ModalBackdrop className="bg-slate-950/80" onClick={() => setImageViewer(null)} aria-label="إغلاق صورة البطاقة" />
          <div className="card-image-viewer" role="dialog" aria-modal="true" aria-label={`صورة البطاقة ${imageViewer.label}`}>
            <div className="card-image-viewer-toolbar">
              <span className="num">{imageViewer.label}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setImageZoom((value) => Math.max(1, value - 0.25))} aria-label="تصغير الصورة">
                  <ZoomOut size={18} />
                </button>
                <button type="button" onClick={() => setImageZoom(1)} aria-label="إعادة حجم الصورة">
                  <Minus size={18} />
                </button>
                <button type="button" onClick={() => setImageZoom((value) => Math.min(3, value + 0.25))} aria-label="تكبير الصورة">
                  <ZoomIn size={18} />
                </button>
                <button type="button" onClick={() => setImageViewer(null)} aria-label="إغلاق">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="card-image-viewer-stage">
              <img
                src={imageViewer.src}
                alt={`صورة البطاقة ${imageViewer.label}`}
                style={{ width: `${imageZoom * 100}%` }}
              />
            </div>
          </div>
        </ModalLayer>
      ) : null}

      {celebration ? (
        <div className="card-celebration" role="status" aria-live="polite">
          <div className="card-confetti" aria-hidden="true">
            {Array.from({ length: 24 }).map((_, index) => (
              <span
                key={index}
                style={
                  {
                    '--delay': `${index * 16}ms`,
                    '--drift': `${(index - 12) * 0.75}rem`,
                    '--x': `${3 + index * 4}%`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="card-celebration-message">
            <Sparkles size={34} />
            <div>
              <b>مبروك، تمت تصفية البطاقة بالكامل</b>
              <span>**** {celebration.label}</span>
            </div>
          </div>
        </div>
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
