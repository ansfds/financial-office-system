'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Save, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';

type PaymentMode = 'received' | 'paid';

type PersonOption = {
  id: string;
  customerNo?: string | null;
  fullName: string;
  phone?: string | null;
  category?: 'REGULAR' | 'VIP';
};

type FormState = {
  personId: string;
  typeId: string;
  customType: string;
  description: string;
  currencyId: string;
  agreedAmount: string;
  paidOrReceivedAmount: string;
  paymentMode: PaymentMode;
  bankName: string;
  verificationReceived: boolean;
  secureInternalNote: string;
  notes: string;
};

type QuickCustomerForm = {
  fullName: string;
  phone: string;
  category: 'REGULAR' | 'VIP';
  notes: string;
};

const initialForm: FormState = {
  personId: '',
  typeId: '',
  customType: '',
  description: '',
  currencyId: '',
  agreedAmount: '',
  paidOrReceivedAmount: '',
  paymentMode: 'received',
  bankName: '',
  verificationReceived: false,
  secureInternalNote: '',
  notes: '',
};

const initialCustomerForm: QuickCustomerForm = {
  fullName: '',
  phone: '',
  category: 'REGULAR',
  notes: '',
};

const ADD_CUSTOMER_VALUE = '__add_customer__';

function money(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function NewTransaction({
  initialPeople,
  initialCurrencies,
  initialTypes,
}: {
  initialPeople: PersonOption[];
  initialCurrencies: any[];
  initialTypes: any[];
}) {
  const router = useRouter();
  const [people, setPeople] = useState<PersonOption[]>(initialPeople);
  const currencies = initialCurrencies;
  const types = initialTypes;
  const [form, setForm] = useState<FormState>({
    ...initialForm,
    currencyId: initialCurrencies[0]?.id || '',
  });
  const [customerForm, setCustomerForm] = useState<QuickCustomerForm>(initialCustomerForm);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedCurrency = currencies.find((currency) => currency.id === form.currencyId);
  const remainingAmount = useMemo(
    () => Math.max(money(form.agreedAmount) - money(form.paidOrReceivedAmount), 0),
    [form.agreedAmount, form.paidOrReceivedAmount],
  );
  const isCompleted = money(form.agreedAmount) > 0 && remainingAmount === 0;

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setCustomerField<K extends keyof QuickCustomerForm>(key: K, value: QuickCustomerForm[K]) {
    setCustomerForm((current) => ({ ...current, [key]: value }));
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

    if (!form.currencyId) return toast.error('اختر العملة');
    if (money(form.agreedAmount) <= 0) return toast.error('أدخل المبلغ المتفق عليه');

    setLoading(true);
    const paidOrReceivedAmount = money(form.paidOrReceivedAmount);
    const response = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personId: form.personId || null,
        typeId: form.typeId || null,
        customType: form.customType || undefined,
        description: form.description || undefined,
        currencyId: form.currencyId,
        agreedAmount: money(form.agreedAmount),
        receivedAmount: form.paymentMode === 'received' ? paidOrReceivedAmount : 0,
        paidAmount: form.paymentMode === 'paid' ? paidOrReceivedAmount : 0,
        bankName: form.bankName || undefined,
        verificationReceived: form.verificationReceived,
        secureInternalNote: form.secureInternalNote || undefined,
        notes: form.notes || undefined,
      }),
    });
    const result = await response.json();
    setLoading(false);

    if (!response.ok) return toast.error(result.error || 'تعذر حفظ المعاملة');

    toast.success('تم إنشاء المعاملة');
    router.push('/transactions');
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
        <select value={form.typeId} onChange={(event) => setField('typeId', event.target.value)}>
          <option value="">نوع يدوي</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>

      {!form.typeId ? (
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">النوع اليدوي</label>
          <input
            value={form.customType}
            onChange={(event) => setField('customType', event.target.value)}
            placeholder="مثال: بطاقة مستلمة"
          />
        </div>
      ) : null}

      <div>
        <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">وصف المعاملة</label>
        <input
          value={form.description}
          onChange={(event) => setField('description', event.target.value)}
          placeholder="وصف مختصر"
        />
      </div>

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

      <div>
        <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">مصرف البطاقة</label>
        <input
          value={form.bankName}
          onChange={(event) => setField('bankName', event.target.value)}
          placeholder="مثال: مصرف الجمهورية"
        />
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
