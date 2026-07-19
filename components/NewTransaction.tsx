'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, CheckCircle2, Loader2, Repeat2, Save, ShoppingBag, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';

type PaymentMode = 'received' | 'paid';
type TransactionMode = 'standard' | 'conversion' | 'shein';

type PersonOption = {
  id: string;
  customerNo?: string | null;
  fullName: string;
  phone?: string | null;
  category?: 'REGULAR' | 'VIP';
};

type CurrencyOption = {
  id: string;
  code: string;
  name: string;
  symbol: string;
};

type TransactionTypeOption = {
  id: string;
  name: string;
};

type FormState = {
  personId: string;
  typeSelection: string;
  customType: string;
  description: string;
  executionType: string;
  currencyId: string;
  agreedAmount: string;
  paidOrReceivedAmount: string;
  paymentMode: PaymentMode;
  verificationReceived: boolean;
  secureInternalNote: string;
  notes: string;
};

type ConversionForm = {
  fromCurrencyId: string;
  fromAmount: string;
  toCurrencyId: string;
  toAmount: string;
};

type SheinSaleForm = {
  denomination: string;
  customDenomination: string;
  paymentMethod: 'LYD_CASH' | 'USD_CASH' | 'LYD_TRANSFER' | 'USD_TRANSFER' | 'CARD';
  pricePerCard: string;
  cardCount: string;
};

type QuickCustomerForm = {
  fullName: string;
  phone: string;
  category: 'REGULAR' | 'VIP';
  notes: string;
  externalId: string;
};

const ADD_CUSTOMER_VALUE = '__add_customer__';
const SPECIAL_CONVERSION = '__currency_conversion__';
const SPECIAL_SHEIN = '__shein_card_sale__';
const CUSTOM_DENOMINATION = '__custom__';

const paymentMethodLabels: Record<SheinSaleForm['paymentMethod'], string> = {
  LYD_CASH: 'كاش دينار',
  USD_CASH: 'كاش دولار',
  LYD_TRANSFER: 'حوالة دينار',
  USD_TRANSFER: 'حوالة دولار',
  CARD: 'بطاقة مصرفية',
};

const paymentMethodCurrencyCode: Record<SheinSaleForm['paymentMethod'], string> = {
  LYD_CASH: 'LYD',
  USD_CASH: 'USD',
  LYD_TRANSFER: 'LYD',
  USD_TRANSFER: 'USD',
  CARD: 'LYD',
};

const initialForm: FormState = {
  personId: '',
  typeSelection: '',
  customType: '',
  description: '',
  executionType: '',
  currencyId: '',
  agreedAmount: '',
  paidOrReceivedAmount: '',
  paymentMode: 'received',
  verificationReceived: false,
  secureInternalNote: '',
  notes: '',
};

const initialCustomerForm: QuickCustomerForm = {
  fullName: '',
  phone: '',
  category: 'REGULAR',
  notes: '',
  externalId: '',
};

function money(value: string | number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value: string | number, currency?: CurrencyOption) {
  return `${money(value).toLocaleString('en-US')} ${currency?.symbol || ''}`.trim();
}

function isConversionName(name?: string) {
  return name === 'تحويل مبلغ';
}

function isSheinName(name?: string) {
  return name === 'كروت شي إن';
}

export default function NewTransaction({
  initialPeople,
  initialCurrencies,
  initialTypes,
  initialSheinDenominations = [],
}: {
  initialPeople: PersonOption[];
  initialCurrencies: CurrencyOption[];
  initialTypes: TransactionTypeOption[];
  initialSheinDenominations?: string[];
}) {
  const router = useRouter();
  const [people, setPeople] = useState<PersonOption[]>(initialPeople);
  const currencies = initialCurrencies;
  const types = initialTypes;
  const defaultCurrencyId = currencies[0]?.id || '';
  const usdCurrency = currencies.find((currency) => currency.code === 'USD');
  const lydCurrency = currencies.find((currency) => currency.code === 'LYD');
  const [form, setForm] = useState<FormState>({
    ...initialForm,
    currencyId: defaultCurrencyId,
  });
  const [conversionForm, setConversionForm] = useState<ConversionForm>({
    fromCurrencyId: lydCurrency?.id || defaultCurrencyId,
    fromAmount: '',
    toCurrencyId: usdCurrency?.id || currencies[1]?.id || defaultCurrencyId,
    toAmount: '',
  });
  const [sheinForm, setSheinForm] = useState<SheinSaleForm>({
    denomination: '500',
    customDenomination: '',
    paymentMethod: 'LYD_CASH',
    pricePerCard: '',
    cardCount: '1',
  });
  const [customerForm, setCustomerForm] = useState<QuickCustomerForm>(initialCustomerForm);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedType = types.find((type) => type.id === form.typeSelection);
  const mode: TransactionMode =
    form.typeSelection === SPECIAL_CONVERSION || isConversionName(selectedType?.name)
      ? 'conversion'
      : form.typeSelection === SPECIAL_SHEIN || isSheinName(selectedType?.name)
        ? 'shein'
        : 'standard';

  const selectedCurrency = currencies.find((currency) => currency.id === form.currencyId);
  const fromCurrency = currencies.find((currency) => currency.id === conversionForm.fromCurrencyId);
  const toCurrency = currencies.find((currency) => currency.id === conversionForm.toCurrencyId);
  const sheinCurrency = currencies.find((currency) => currency.code === paymentMethodCurrencyCode[sheinForm.paymentMethod]);
  const denominationValue = sheinForm.denomination === CUSTOM_DENOMINATION ? sheinForm.customDenomination : sheinForm.denomination;
  const sheinTotal = money(sheinForm.pricePerCard) * Math.max(money(sheinForm.cardCount), 0);
  const remainingAmount = useMemo(
    () => Math.max(money(form.agreedAmount) - money(form.paidOrReceivedAmount), 0),
    [form.agreedAmount, form.paidOrReceivedAmount],
  );
  const isCompleted = money(form.agreedAmount) > 0 && remainingAmount === 0;
  const conversionExecution = `تحويل مبلغ من ${formatAmount(conversionForm.fromAmount, fromCurrency)} إلى ${formatAmount(
    conversionForm.toAmount,
    toCurrency,
  )}`;
  const sheinExecution = `بيع ${money(sheinForm.cardCount).toLocaleString('en-US')} كروت شي إن فئة ${money(
    denominationValue,
  ).toLocaleString('en-US')}$ بسعر ${formatAmount(sheinForm.pricePerCard, sheinCurrency)} للكرت (${
    paymentMethodLabels[sheinForm.paymentMethod]
  })`;
  const denominationOptions = useMemo(() => {
    const fixed = ['100', '300', '500', '800', '1000'];
    const extras = initialSheinDenominations.filter((item) => !fixed.includes(item));
    return Array.from(new Set([...fixed, ...extras])).sort((a, b) => Number(a) - Number(b));
  }, [initialSheinDenominations]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setCustomerField<K extends keyof QuickCustomerForm>(key: K, value: QuickCustomerForm[K]) {
    setCustomerForm((current) => ({ ...current, [key]: value }));
  }

  function selectedTypeId() {
    return form.typeSelection && !form.typeSelection.startsWith('__') ? form.typeSelection : null;
  }

  function selectPerson(value: string) {
    if (value === ADD_CUSTOMER_VALUE) {
      setCustomerModalOpen(true);
      return;
    }

    setField('personId', value);
  }

  function closeCustomerModal() {
    if (customerLoading) return;
    setCustomerModalOpen(false);
    setCustomerForm(initialCustomerForm);
  }

  async function addCustomer(event: React.FormEvent) {
    event.preventDefault();

    if (customerForm.fullName.trim().length < 2) {
      return toast.error('أدخل اسم الزبون');
    }

    setCustomerLoading(true);
    const response = await fetch('/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: customerForm.fullName,
        phone: customerForm.phone || undefined,
        category: customerForm.category,
        notes: customerForm.notes || undefined,
        externalId: customerForm.externalId || undefined,
      }),
    });
    const result = await response.json();
    setCustomerLoading(false);

    if (!response.ok) return toast.error(result.error || 'تعذر إضافة الزبون');

    setPeople((current) => [result, ...current.filter((person) => person.id !== result.id)]);
    setField('personId', result.id);
    setCustomerForm(initialCustomerForm);
    setCustomerModalOpen(false);
    toast.success('تمت إضافة الزبون واختياره');
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();

    let body: any;

    if (mode === 'conversion') {
      if (!conversionForm.fromCurrencyId || !conversionForm.toCurrencyId) return toast.error('اختر عملتي التحويل');
      if (conversionForm.fromCurrencyId === conversionForm.toCurrencyId) return toast.error('اختر عملتين مختلفتين');
      if (money(conversionForm.fromAmount) <= 0 || money(conversionForm.toAmount) <= 0) {
        return toast.error('أدخل مبلغ التحويل الخارج والداخل');
      }

      body = {
        transactionKind: 'CURRENCY_CONVERSION',
        personId: form.personId || null,
        typeId: selectedTypeId(),
        customType: 'تحويل مبلغ',
        description: form.description || conversionExecution,
        executionType: form.executionType || conversionExecution,
        notes: form.notes || undefined,
        conversion: {
          fromCurrencyId: conversionForm.fromCurrencyId,
          toCurrencyId: conversionForm.toCurrencyId,
          fromAmount: money(conversionForm.fromAmount),
          toAmount: money(conversionForm.toAmount),
          notes: form.notes || undefined,
        },
      };
    } else if (mode === 'shein') {
      if (!form.personId) return toast.error('اختر الزبون');
      if (money(denominationValue) <= 0) return toast.error('اختر فئة الكرت');
      if (money(sheinForm.pricePerCard) <= 0) return toast.error('أدخل سعر البيع لكل كرت');
      if (money(sheinForm.cardCount) <= 0) return toast.error('أدخل عدد الكروت المباعة');
      if (!sheinCurrency) return toast.error('عملة طريقة الدفع غير مفعلة');

      body = {
        transactionKind: 'SHEIN_CARD_SALE',
        personId: form.personId,
        typeId: selectedTypeId(),
        customType: 'كروت شي إن',
        description: form.description || sheinExecution,
        executionType: form.executionType || sheinExecution,
        notes: form.notes || undefined,
        sheinSale: {
          denomination: money(denominationValue),
          paymentMethod: sheinForm.paymentMethod,
          pricePerCard: money(sheinForm.pricePerCard),
          cardCount: money(sheinForm.cardCount),
          notes: form.notes || undefined,
        },
      };
    } else {
      if (!form.currencyId) return toast.error('اختر العملة');
      if (money(form.agreedAmount) <= 0) return toast.error('أدخل المبلغ المتفق عليه');

      const paidOrReceivedAmount = money(form.paidOrReceivedAmount);
      body = {
        transactionKind: 'STANDARD',
        personId: form.personId || null,
        typeId: selectedTypeId(),
        customType: form.typeSelection ? undefined : form.customType || undefined,
        description: form.description || undefined,
        executionType: form.executionType || form.description || undefined,
        currencyId: form.currencyId,
        agreedAmount: money(form.agreedAmount),
        receivedAmount: form.paymentMode === 'received' ? paidOrReceivedAmount : 0,
        paidAmount: form.paymentMode === 'paid' ? paidOrReceivedAmount : 0,
        verificationReceived: form.verificationReceived,
        secureInternalNote: form.secureInternalNote || undefined,
        notes: form.notes || undefined,
      };
    }

    setLoading(true);
    const response = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    setLoading(false);

    if (!response.ok) return toast.error(result.error || 'تعذر حفظ المعاملة');

    toast.success('تم إنشاء المعاملة');
    router.push('/transactions');
  }

  function swapConversionCurrencies() {
    setConversionForm((current) => ({
      fromCurrencyId: current.toCurrencyId,
      toCurrencyId: current.fromCurrencyId,
      fromAmount: current.toAmount,
      toAmount: current.fromAmount,
    }));
  }

  return (
    <>
      <form onSubmit={add} className="card grid gap-5 p-5 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">الزبون</label>
          <select value={form.personId} onChange={(event) => selectPerson(event.target.value)}>
            <option value="">بدون زبون</option>
            <option value={ADD_CUSTOMER_VALUE}>+ إضافة زبون جديد</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.customerNo ? `${person.customerNo} - ` : ''}
                {person.fullName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">نوع المعاملة</label>
          <select value={form.typeSelection} onChange={(event) => setField('typeSelection', event.target.value)}>
            <option value="">نوع يدوي</option>
            {!types.some((type) => isConversionName(type.name)) ? (
              <option value={SPECIAL_CONVERSION}>تحويل مبلغ</option>
            ) : null}
            {!types.some((type) => isSheinName(type.name)) ? <option value={SPECIAL_SHEIN}>كروت شي إن</option> : null}
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </div>

        {mode === 'standard' && !form.typeSelection ? (
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">النوع اليدوي</label>
            <input
              value={form.customType}
              onChange={(event) => setField('customType', event.target.value)}
              placeholder="مثال: بطاقة مستلمة"
            />
          </div>
        ) : null}

        <div className={mode === 'standard' && !form.typeSelection ? '' : 'md:col-span-2'}>
          <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">وصف المعاملة</label>
          <input
            value={form.description}
            onChange={(event) => setField('description', event.target.value)}
            placeholder="وصف مختصر"
          />
        </div>

        {mode === 'conversion' ? (
          <>
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="mb-3 flex items-center gap-2 font-black">
                <ArrowLeftRight size={18} />
                العملة المحوّل منها
              </h2>
              <div className="grid gap-3">
                <select
                  value={conversionForm.fromCurrencyId}
                  onChange={(event) => setConversionForm({ ...conversionForm, fromCurrencyId: event.target.value })}
                >
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
                  value={conversionForm.fromAmount}
                  onChange={(event) => setConversionForm({ ...conversionForm, fromAmount: event.target.value })}
                  placeholder="المبلغ الخارج"
                />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="mb-3 flex items-center gap-2 font-black">
                <ArrowLeftRight size={18} />
                العملة المحوّل إليها
              </h2>
              <div className="grid gap-3">
                <select
                  value={conversionForm.toCurrencyId}
                  onChange={(event) => setConversionForm({ ...conversionForm, toCurrencyId: event.target.value })}
                >
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
                  value={conversionForm.toAmount}
                  onChange={(event) => setConversionForm({ ...conversionForm, toAmount: event.target.value })}
                  placeholder="المبلغ الداخل"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={swapConversionCurrencies}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 md:col-span-2"
            >
              <Repeat2 size={18} />
              قلب العملات
            </button>
          </>
        ) : null}

        {mode === 'shein' ? (
          <>
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">فئة الكرت</label>
              <select
                value={sheinForm.denomination}
                onChange={(event) => setSheinForm({ ...sheinForm, denomination: event.target.value })}
              >
                {denominationOptions.map((denomination) => (
                  <option key={denomination} value={denomination}>
                    {denomination}$
                  </option>
                ))}
                <option value={CUSTOM_DENOMINATION}>فئة أخرى</option>
              </select>
            </div>

            {sheinForm.denomination === CUSTOM_DENOMINATION ? (
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">الفئة الجديدة</label>
                <input
                  type="number"
                  min="1"
                  step="0.000001"
                  value={sheinForm.customDenomination}
                  onChange={(event) => setSheinForm({ ...sheinForm, customDenomination: event.target.value })}
                  placeholder="مثال: 1200"
                />
              </div>
            ) : null}

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">طريقة الدفع</label>
              <select
                value={sheinForm.paymentMethod}
                onChange={(event) =>
                  setSheinForm({ ...sheinForm, paymentMethod: event.target.value as SheinSaleForm['paymentMethod'] })
                }
              >
                {Object.entries(paymentMethodLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">سعر البيع لكل كرت</label>
              <input
                type="number"
                min="0"
                step="0.000001"
                value={sheinForm.pricePerCard}
                onChange={(event) => setSheinForm({ ...sheinForm, pricePerCard: event.target.value })}
                placeholder="4000"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">عدد الكروت المباعة</label>
              <input
                type="number"
                min="1"
                step="1"
                value={sheinForm.cardCount}
                onChange={(event) => setSheinForm({ ...sheinForm, cardCount: event.target.value })}
                placeholder="5"
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-sm text-slate-500">الإجمالي</div>
              <div className="mt-1 flex items-center gap-2 text-2xl font-black">
                <ShoppingBag size={22} />
                {formatAmount(sheinTotal, sheinCurrency)}
              </div>
            </div>
          </>
        ) : null}

        {mode === 'standard' ? (
          <>
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">العملة</label>
              <select value={form.currencyId} onChange={(event) => setField('currencyId', event.target.value)}>
                {currencies.map((currency) => (
                  <option key={currency.id} value={currency.id}>
                    {currency.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">المبلغ المتفق عليه</label>
              <input
                type="number"
                min="0"
                step="0.000001"
                value={form.agreedAmount}
                onChange={(event) => setField('agreedAmount', event.target.value)}
                placeholder="1760"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">
                المبلغ المستلم / المدفوع
              </label>
              <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                <select
                  value={form.paymentMode}
                  onChange={(event) => setField('paymentMode', event.target.value as PaymentMode)}
                >
                  <option value="received">مستلم</option>
                  <option value="paid">مدفوع</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={form.paidOrReceivedAmount}
                  onChange={(event) => setField('paidOrReceivedAmount', event.target.value)}
                  placeholder="1000"
                />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-sm text-slate-500">المبلغ المتبقي</div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="text-2xl font-black">
                  {remainingAmount.toLocaleString('en-US')} {selectedCurrency?.symbol || ''}
                </span>
                {isCompleted ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                    <CheckCircle2 size={16} />
                    مكتمل
                  </span>
                ) : null}
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm font-bold dark:border-slate-800 dark:bg-slate-900">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.verificationReceived}
                onChange={(event) => setField('verificationReceived', event.target.checked)}
              />
              تم استلام بيانات التحقق
            </label>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">ملاحظة داخلية آمنة</label>
              <textarea
                value={form.secureInternalNote}
                onChange={(event) => setField('secureInternalNote', event.target.value)}
                placeholder="لا تكتب CVV هنا. استخدم هذا الحقل للملاحظات التشغيلية فقط."
                rows={3}
              />
            </div>
          </>
        ) : null}

        <div className="md:col-span-2">
          <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">نوع التنفيذ</label>
          <input
            value={form.executionType}
            onChange={(event) => setField('executionType', event.target.value)}
            placeholder={mode === 'conversion' ? conversionExecution : mode === 'shein' ? sheinExecution : 'مثال: استلام 10 بطاقات'}
          />
          {mode !== 'standard' ? (
            <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
              {mode === 'conversion' ? conversionExecution : sheinExecution}
            </div>
          ) : null}
        </div>

        <div className="md:col-span-2">
          <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">ملاحظات</label>
          <textarea
            value={form.notes}
            onChange={(event) => setField('notes', event.target.value)}
            placeholder="ملاحظات عامة"
            rows={3}
          />
        </div>

        <button
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-400 md:col-span-2"
        >
          <Save size={18} />
          {loading ? 'جار الحفظ...' : 'حفظ المعاملة'}
        </button>
      </form>

      {customerModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={addCustomer}
            className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">إضافة زبون جديد</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  بعد الحفظ سيتم اختيار الزبون تلقائيًا داخل المعاملة.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCustomerModal}
                disabled={customerLoading}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="إغلاق نافذة إضافة زبون"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">اسم الزبون</label>
                <input
                  autoFocus
                  value={customerForm.fullName}
                  onChange={(event) => setCustomerField('fullName', event.target.value)}
                  placeholder="الاسم الكامل"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">رقم الهاتف</label>
                <input
                  value={customerForm.phone}
                  onChange={(event) => setCustomerField('phone', event.target.value)}
                  placeholder="09xxxxxxxx"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">التصنيف</label>
                <select
                  value={customerForm.category}
                  onChange={(event) => setCustomerField('category', event.target.value as QuickCustomerForm['category'])}
                >
                  <option value="REGULAR">عميل عادي</option>
                  <option value="VIP">عميل مميز</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">معلومات إضافية</label>
                <textarea
                  value={customerForm.externalId}
                  onChange={(event) => setCustomerField('externalId', event.target.value)}
                  placeholder="أي معلومات إضافية عن الزبون"
                  rows={2}
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">ملاحظات</label>
                <textarea
                  value={customerForm.notes}
                  onChange={(event) => setCustomerField('notes', event.target.value)}
                  placeholder="ملاحظات عن الزبون"
                  rows={3}
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={closeCustomerModal}
                disabled={customerLoading}
                className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                disabled={customerLoading}
                className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-400"
              >
                {customerLoading ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
                {customerLoading ? 'جار الحفظ...' : 'حفظ واختيار الزبون'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
