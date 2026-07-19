'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Eye, EyeOff, Loader2, Mail, MessageCircle, Plus, Save, X } from 'lucide-react';
import { toast } from 'sonner';

const fixedDenominations = ['100', '300', '500', '800', '1000'];
const companyWhatsAppPhone = '218935085091';

const statusLabels: Record<string, string> = {
  AVAILABLE: 'متوفر',
  SOLD: 'تم البيع',
  RESERVED: 'محجوز',
  INVALID: 'غير صالح',
  CANCELLED: 'ملغي',
};

const statusOptions = [
  { value: 'AVAILABLE', label: 'متوفر' },
  { value: 'SOLD', label: 'تم البيع' },
  { value: 'RESERVED', label: 'محجوز' },
  { value: 'INVALID', label: 'غير صالح' },
];

type Secret = {
  cardCode: string;
  pin: string;
};

type SheinForm = {
  denomination: string;
  cardCode: string;
  pin: string;
  purchasePrice: string;
  salePrice: string;
  saleCurrencyId: string;
  supplier: string;
  notes: string;
};

type SendDraft = {
  open: boolean;
  method: 'whatsapp' | 'email';
  recipient: string;
  message: string;
};

function blankForm(saleCurrencyId: string): SheinForm {
  return {
    denomination: '500',
    cardCode: '',
    pin: '',
    purchasePrice: '',
    salePrice: '',
    saleCurrencyId,
    supplier: '',
    notes: '',
  };
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function SheinCardsClient({
  people,
  currencies,
  initialCards,
}: {
  people: any[];
  currencies: any[];
  initialCards: any[];
}) {
  const defaultSaleCurrencyId = currencies.find((currency) => currency.code === 'USD')?.id || currencies[0]?.id || '';
  const [cards, setCards] = useState<any[]>(initialCards);
  const [activeDenomination, setActiveDenomination] = useState<string>('all');
  const [openCardId, setOpenCardId] = useState('');
  const [savingId, setSavingId] = useState('');
  const [revealingId, setRevealingId] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visibleSecretIds, setVisibleSecretIds] = useState<string[]>([]);
  const [secretsById, setSecretsById] = useState<Record<string, Secret>>({});
  const [sendDraft, setSendDraft] = useState<SendDraft>({
    open: false,
    method: 'whatsapp',
    recipient: companyWhatsAppPhone,
    message: '',
  });
  const [saleConfirmCard, setSaleConfirmCard] = useState<any | null>(null);
  const [form, setForm] = useState<SheinForm>(() => blankForm(defaultSaleCurrencyId));

  async function load() {
    const response = await fetch('/api/inventory/shein-cards');
    const data = await response.json();
    if (!response.ok) return toast.error(data.error || 'تعذر تحميل كروت شي إن');
    setCards(data);
  }

  useEffect(() => {
    setCards(initialCards);
  }, [initialCards]);

  useEffect(() => {
    if (!form.saleCurrencyId && defaultSaleCurrencyId) {
      setForm((current) => ({ ...current, saleCurrencyId: defaultSaleCurrencyId }));
    }
  }, [defaultSaleCurrencyId, form.saleCurrencyId]);

  const summary = useMemo(() => {
    const result = new Map<string, { total: number; available: number }>();
    for (const card of cards) {
      const key = String(Number(card.denomination));
      const current = result.get(key) || { total: 0, available: 0 };
      current.total += 1;
      if (card.status === 'AVAILABLE') current.available += 1;
      result.set(key, current);
    }
    return result;
  }, [cards]);

  const denominationFilters = useMemo(() => {
    const extras = Array.from(summary.keys())
      .filter((denomination) => !fixedDenominations.includes(denomination))
      .sort((a, b) => Number(a) - Number(b));
    return [...fixedDenominations, ...extras];
  }, [summary]);

  const visibleCards =
    activeDenomination === 'all'
      ? cards
      : cards.filter((card) => String(Number(card.denomination)) === activeDenomination);

  const allVisibleSelected = visibleCards.length > 0 && visibleCards.every((card) => selectedIds.includes(card.id));

  async function add(event: React.FormEvent) {
    event.preventDefault();

    if (!form.cardCode.trim()) return toast.error('أدخل كود الكرت');
    if (!form.pin.trim()) return toast.error('أدخل PIN');

    const response = await fetch('/api/inventory/shein-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        denomination: Number(form.denomination),
        cardCode: form.cardCode,
        pin: form.pin,
        purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : null,
        salePrice: form.salePrice ? Number(form.salePrice) : null,
        saleCurrencyId: form.saleCurrencyId || null,
        supplier: form.supplier || undefined,
        notes: form.notes || undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok) return toast.error(data.error || 'تعذر إضافة الكرت');

    toast.success('تمت إضافة كرت شي إن');
    setForm(blankForm(defaultSaleCurrencyId));
    setCards((items) => [data, ...items.filter((item) => item.id !== data.id)]);
    setActiveDenomination(String(Number(data.denomination)));
  }

  function updateLocal(id: string, patch: any) {
    setCards((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleVisibleSelection() {
    const visibleIds = visibleCards.map((card) => card.id);
    setSelectedIds((current) => {
      if (visibleIds.every((id) => current.includes(id))) {
        return current.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  async function save(card: any, confirmedSale = false) {
    if (card.status === 'SOLD' && (money(card.salePrice) <= 0 || !card.saleCurrencyId)) {
      return toast.error('تغيير الحالة إلى تم البيع يتطلب سعر البيع وعملة الدفع');
    }

    if (card.status === 'SOLD' && !confirmedSale) {
      setSaleConfirmCard({ ...card, saleNote: card.saleNote || card.notes || '' });
      return;
    }

    setSavingId(card.id);
    const response = await fetch(`/api/inventory/shein-cards/${card.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: card.status,
        salePrice: card.salePrice ? Number(card.salePrice) : null,
        saleCurrencyId: card.saleCurrencyId || null,
        buyerPersonId: card.buyerPersonId || null,
        notes: card.notes || null,
        logNote: card.saleNote || undefined,
      }),
    });
    const data = await response.json();
    setSavingId('');
    if (!response.ok) return toast.error(data.error || 'تعذر تعديل الكرت');
    updateLocal(card.id, data);
    setSaleConfirmCard(null);
    toast.success('تم حفظ الكرت');
  }

  async function fetchSecret(card: any) {
    if (secretsById[card.id]) return secretsById[card.id];

    const response = await fetch(`/api/inventory/shein-cards/${card.id}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'تعذر إظهار بيانات الكرت');
    }

    setSecretsById((current) => ({ ...current, [card.id]: { cardCode: data.cardCode, pin: data.pin } }));
    return { cardCode: data.cardCode, pin: data.pin };
  }

  async function toggleSecret(card: any) {
    if (visibleSecretIds.includes(card.id)) {
      setVisibleSecretIds((current) => current.filter((id) => id !== card.id));
      return;
    }

    try {
      setRevealingId(card.id);
      await fetchSecret(card);
      setVisibleSecretIds((current) => Array.from(new Set([...current, card.id])));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRevealingId('');
    }
  }

  async function buildSelectedMessage() {
    const selectedCards = cards.filter((card) => selectedIds.includes(card.id));
    if (!selectedCards.length) throw new Error('حدد كرتًا واحدًا على الأقل');

    const lines = [];
    for (const card of selectedCards) {
      const secret = await fetchSecret(card);
      lines.push(`كرت شي إن:\n${card.code}\nCode: ${secret.cardCode}\nPIN: ${secret.pin}`);
    }

    return lines.join('\n\n');
  }

  async function openSendModal() {
    try {
      setSending(true);
      const message = await buildSelectedMessage();
      setSendDraft({
        open: true,
        method: 'whatsapp',
        recipient: companyWhatsAppPhone,
        message,
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  function confirmSend() {
    if (!sendDraft.recipient.trim()) return toast.error('أدخل رقم الهاتف أو البريد');

    if (sendDraft.method === 'whatsapp') {
      const phone = sendDraft.recipient.replace(/\D/g, '');
      const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(sendDraft.message)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      toast.success('تم تجهيز رسالة واتساب للمراجعة والإرسال');
    } else {
      const url = `mailto:${encodeURIComponent(sendDraft.recipient)}?subject=${encodeURIComponent(
        'كروت شي إن',
      )}&body=${encodeURIComponent(sendDraft.message)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      toast.success('تم تجهيز رسالة الإيميل للمراجعة والإرسال');
    }
  }

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-black">كروت شي إن</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              الهاشتاق يتولد تلقائيًا، وكود الكرت و PIN لا يظهران إلا بزر إظهار.
            </p>
          </div>
          <button
            type="button"
            onClick={openSendModal}
            disabled={sending || !selectedIds.length}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {sending ? <Loader2 className="animate-spin" size={18} /> : <MessageCircle size={18} />}
            إرسال الكروت
          </button>
        </div>

        <form onSubmit={add} className="grid gap-4 lg:grid-cols-4">
          <input
            type="number"
            min="1"
            placeholder="الفئة"
            value={form.denomination}
            onChange={(event) => setForm({ ...form, denomination: event.target.value })}
          />
          <input
            dir="ltr"
            placeholder="Code"
            value={form.cardCode}
            onChange={(event) => setForm({ ...form, cardCode: event.target.value })}
          />
          <input
            dir="ltr"
            placeholder="PIN"
            value={form.pin}
            onChange={(event) => setForm({ ...form, pin: event.target.value })}
          />
          <input
            type="number"
            min="0"
            step="0.000001"
            placeholder="سعر البيع"
            value={form.salePrice}
            onChange={(event) => setForm({ ...form, salePrice: event.target.value })}
          />
          <select
            value={form.saleCurrencyId}
            onChange={(event) => setForm({ ...form, saleCurrencyId: event.target.value })}
          >
            <option value="">عملة الدفع</option>
            {currencies.map((currency) => (
              <option key={currency.id} value={currency.id}>
                {currency.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.000001"
            placeholder="سعر الشراء"
            value={form.purchasePrice}
            onChange={(event) => setForm({ ...form, purchasePrice: event.target.value })}
          />
          <input
            placeholder="المورد"
            value={form.supplier}
            onChange={(event) => setForm({ ...form, supplier: event.target.value })}
          />
          <button className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-bold text-white hover:bg-indigo-500">
            <Plus size={18} />
            إضافة كرت
          </button>
          <input
            className="lg:col-span-4"
            placeholder="ملاحظات"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </form>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <button
          type="button"
          onClick={() => setActiveDenomination('all')}
          className={`card p-4 text-right ${activeDenomination === 'all' ? 'ring-2 ring-indigo-400' : ''}`}
        >
          <div className="text-sm text-slate-500">كل الكروت</div>
          <div className="mt-2 text-2xl font-black">{cards.length}</div>
        </button>
        {denominationFilters.map((denomination) => {
          const item = summary.get(denomination) || { total: 0, available: 0 };
          return (
            <button
              type="button"
              key={denomination}
              onClick={() => setActiveDenomination(denomination)}
              className={`card p-4 text-right ${activeDenomination === denomination ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <div className="text-sm text-slate-500">فئة {denomination}$</div>
              <div className="mt-2 text-2xl font-black">{item.available}</div>
              <div className="mt-1 text-xs text-slate-500">من أصل {item.total}</div>
            </button>
          );
        })}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelection} />
              </th>
              <th>الهاشتاق</th>
              <th>الفئة</th>
              <th>Code / PIN</th>
              <th>الحالة</th>
              <th>سعر البيع</th>
              <th>عملة الدفع</th>
              <th>المشتري</th>
              <th>تاريخ الإضافة</th>
              <th>تاريخ البيع</th>
              <th>حفظ</th>
            </tr>
          </thead>
          <tbody>
            {visibleCards.map((card) => {
              const secret = secretsById[card.id];
              const secretsVisible = visibleSecretIds.includes(card.id);
              return (
                <Fragment key={card.id}>
                  <tr>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(card.id)}
                        onChange={() => toggleSelected(card.id)}
                      />
                    </td>
                    <td className="font-black">{card.code}</td>
                    <td>{Number(card.denomination).toLocaleString('en-US')}$</td>
                    <td>
                      <div className="grid gap-2">
                        {secretsVisible ? (
                          <div className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-950">
                            <div dir="ltr">Code: {secret?.cardCode || '...'}</div>
                            <div dir="ltr">PIN: {secret?.pin || '...'}</div>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-500">مخفي</span>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleSecret(card)}
                          disabled={revealingId === card.id}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          {revealingId === card.id ? (
                            <Loader2 className="animate-spin" size={16} />
                          ) : secretsVisible ? (
                            <EyeOff size={16} />
                          ) : (
                            <Eye size={16} />
                          )}
                          {secretsVisible ? 'إخفاء' : 'إظهار'}
                        </button>
                      </div>
                    </td>
                    <td>
                      <select
                        value={card.status}
                        onChange={(event) => updateLocal(card.id, { status: event.target.value })}
                      >
                        {statusOptions.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={card.salePrice?.toString() || ''}
                        onChange={(event) => updateLocal(card.id, { salePrice: event.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        value={card.saleCurrencyId || ''}
                        onChange={(event) => updateLocal(card.id, { saleCurrencyId: event.target.value })}
                      >
                        <option value="">بدون</option>
                        {currencies.map((currency) => (
                          <option key={currency.id} value={currency.id}>
                            {currency.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={card.buyerPersonId || ''}
                        onChange={(event) => updateLocal(card.id, { buyerPersonId: event.target.value })}
                      >
                        <option value="">بدون</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.customerNo ? `${person.customerNo} - ` : ''}
                            {person.fullName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-xs text-slate-500">{new Date(card.createdAt).toLocaleString('en-GB')}</td>
                    <td className="text-xs text-slate-500">
                      {card.soldAt ? new Date(card.soldAt).toLocaleString('en-GB') : '—'}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setOpenCardId(openCardId === card.id ? '' : card.id)}
                          className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          <ChevronDown size={16} />
                          السجل
                        </button>
                        <button
                          type="button"
                          onClick={() => save(card)}
                          disabled={savingId === card.id}
                          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-indigo-400"
                        >
                          {savingId === card.id ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                          {savingId === card.id ? 'جار...' : 'حفظ'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {openCardId === card.id ? (
                    <tr>
                      <td colSpan={11} className="bg-slate-50 dark:bg-slate-950">
                        <div className="grid gap-2">
                          <div className="font-black">سجل شراء وبيع الكرت</div>
                          {card.logs?.length ? (
                            card.logs.map((log: any) => (
                              <div
                                key={log.id}
                                className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[140px_120px_1fr_auto]"
                              >
                                <span className="font-bold">{logTypeLabel(log.type)}</span>
                                <span>{log.amount ? Number(log.amount).toLocaleString('en-US') : '—'}</span>
                                <span className="text-slate-600 dark:text-slate-300">{log.note || '—'}</span>
                                <span className="text-xs text-slate-500">
                                  {new Date(log.createdAt).toLocaleString('en-GB')}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="text-sm text-slate-500">لا يوجد سجل لهذا الكرت.</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!visibleCards.length ? (
              <tr>
                <td colSpan={11} className="text-center text-slate-500">
                  لا توجد كروت في هذه الفئة
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {sendDraft.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black">إرسال الكروت</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  راجع الرسالة قبل فتح واتساب أو الإيميل.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSendDraft((draft) => ({ ...draft, open: false }))}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق نافذة الإرسال"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">طريقة الإرسال</label>
                <select
                  value={sendDraft.method}
                  onChange={(event) =>
                    setSendDraft((draft) => ({
                      ...draft,
                      method: event.target.value as SendDraft['method'],
                      recipient: event.target.value === 'whatsapp' ? companyWhatsAppPhone : '',
                    }))
                  }
                >
                  <option value="whatsapp">واتساب</option>
                  <option value="email">إيميل</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">
                  {sendDraft.method === 'whatsapp' ? 'رقم الهاتف' : 'البريد'}
                </label>
                <input
                  dir="ltr"
                  value={sendDraft.recipient}
                  onChange={(event) => setSendDraft((draft) => ({ ...draft, recipient: event.target.value }))}
                  placeholder={sendDraft.method === 'whatsapp' ? '218935085091' : 'customer@example.com'}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">معاينة الرسالة</label>
                <textarea
                  dir="ltr"
                  rows={10}
                  value={sendDraft.message}
                  onChange={(event) => setSendDraft((draft) => ({ ...draft, message: event.target.value }))}
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSendDraft((draft) => ({ ...draft, open: false }))}
                className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={confirmSend}
                className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-500"
              >
                {sendDraft.method === 'whatsapp' ? <MessageCircle size={18} /> : <Mail size={18} />}
                فتح الرسالة للمراجعة
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saleConfirmCard ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black">تأكيد بيع كرت شي إن</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  بعد التأكيد سيتم تحديث الصندوق وتسجيل الحركة.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSaleConfirmCard(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق نافذة تأكيد البيع"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">سعر البيع</label>
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={saleConfirmCard.salePrice?.toString() || ''}
                  onChange={(event) => setSaleConfirmCard({ ...saleConfirmCard, salePrice: event.target.value })}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">العملة</label>
                <select
                  value={saleConfirmCard.saleCurrencyId || ''}
                  onChange={(event) => setSaleConfirmCard({ ...saleConfirmCard, saleCurrencyId: event.target.value })}
                >
                  <option value="">اختر العملة</option>
                  {currencies.map((currency) => (
                    <option key={currency.id} value={currency.id}>
                      {currency.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">اسم الزبون اختياري</label>
                <select
                  value={saleConfirmCard.buyerPersonId || ''}
                  onChange={(event) => setSaleConfirmCard({ ...saleConfirmCard, buyerPersonId: event.target.value })}
                >
                  <option value="">بدون</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.customerNo ? `${person.customerNo} - ` : ''}
                      {person.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">ملاحظة</label>
                <textarea
                  rows={3}
                  value={saleConfirmCard.saleNote || ''}
                  onChange={(event) => setSaleConfirmCard({ ...saleConfirmCard, saleNote: event.target.value })}
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSaleConfirmCard(null)}
                className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => save(saleConfirmCard, true)}
                disabled={savingId === saleConfirmCard.id}
                className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-400"
              >
                {savingId === saleConfirmCard.id ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                تأكيد وتحديث الصندوق
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function logTypeLabel(type: string) {
  const labels: Record<string, string> = {
    PURCHASE: 'شراء',
    SALE: 'بيع',
    RESERVE: 'حجز',
    RELEASE: 'إتاحة',
    CANCEL: 'إلغاء',
    UPDATE: 'تعديل',
  };
  return labels[type] || type;
}
