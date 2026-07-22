'use client';

import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  HandCoins,
  Loader2,
  ReceiptText,
  Repeat2,
  Save,
  Send,
  ShoppingBag,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

type OperationKind =
  | 'MANUAL'
  | 'USDT'
  | 'CARD_OPERATION'
  | 'CASHBOX_MOVEMENT'
  | 'CURRENCY_CONVERSION'
  | 'MONEY_TRANSFER'
  | 'SHEIN_CARD_SALE'
  | 'EXPENSE';

type CashDirection = 'IN' | 'OUT' | 'NONE';
type SimplePaymentMethod = 'CASH' | 'TRANSFER' | 'CARD';
type DetailedPaymentMethod = 'LYD_CASH' | 'USD_CASH' | 'LYD_TRANSFER' | 'USD_TRANSFER' | 'CARD';
type UsdtAction = 'BUY' | 'SELL';
type CardAction = 'RECEIVE_CARD' | 'PAY_CARD_VALUE' | 'WITHDRAW_FROM_CARD';
type ConversionAction = 'SELL_CURRENCY' | 'BUY_CURRENCY' | 'TRANSFER_AMOUNT';
type ExpenseAction = 'PAY_BILL' | 'GENERAL_EXPENSE';
type TransferStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
type ReceivedCardStatus = 'RECEIVED' | 'IN_SETTLEMENT' | 'SETTLED' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED';

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

type FormState = {
  personId: string;
  operationKind: OperationKind;
  executionType: string;
  notes: string;
};

type ManualForm = {
  currencyId: string;
  amount: string;
  cashDirection: CashDirection;
};

type UsdtForm = {
  action: UsdtAction;
  network: 'TRC20' | 'BEP20' | 'OTHER';
  customNetwork: string;
  usdtAmount: string;
  price: string;
  counterCurrencyId: string;
  paymentMethod: SimplePaymentMethod;
  txId: string;
};

type CardOperationForm = {
  action: CardAction;
  cardCount: string;
  cardValue: string;
  currencyId: string;
  paymentAmount: string;
  paymentMethod: DetailedPaymentMethod;
  cardStatus: ReceivedCardStatus;
};

type CashboxMovementForm = {
  action: 'IN' | 'OUT';
  currencyId: string;
  amount: string;
  movementMethod: SimplePaymentMethod;
  reason: string;
};

type ConversionForm = {
  action: ConversionAction;
  fromCurrencyId: string;
  fromAmount: string;
  toCurrencyId: string;
  toAmount: string;
  exchangeRate: string;
  paymentMethod: SimplePaymentMethod;
};

type MoneyTransferForm = {
  receiverName: string;
  destination: string;
  currencyId: string;
  amount: string;
  commission: string;
  paymentMethod: SimplePaymentMethod;
  status: TransferStatus;
  transferNumber: string;
};

type SheinSaleForm = {
  denomination: string;
  customDenomination: string;
  paymentMethod: DetailedPaymentMethod;
  pricePerCard: string;
  cardCount: string;
};

type ExpenseForm = {
  action: ExpenseAction;
  payee: string;
  expenseType: string;
  currencyId: string;
  amount: string;
  paymentMethod: SimplePaymentMethod;
  invoiceNumber: string;
};

type QuickCustomerForm = {
  fullName: string;
  phone: string;
  category: 'REGULAR' | 'VIP';
  notes: string;
  externalId: string;
};

const ADD_CUSTOMER_VALUE = '__add_customer__';
const CUSTOM_DENOMINATION = '__custom__';

const operationOptions: Array<{ value: OperationKind; label: string; icon: ReactNode }> = [
  { value: 'MANUAL', label: 'نوع يدوي', icon: <HandCoins size={18} /> },
  { value: 'USDT', label: 'USDT', icon: <Wallet size={18} /> },
  { value: 'CARD_OPERATION', label: 'عمليات بطاقة', icon: <CreditCard size={18} /> },
  { value: 'CASHBOX_MOVEMENT', label: 'حركة صندوق', icon: <Banknote size={18} /> },
  { value: 'CURRENCY_CONVERSION', label: 'صرف / تحويل عملة', icon: <ArrowLeftRight size={18} /> },
  { value: 'MONEY_TRANSFER', label: 'حوالة مالية', icon: <Send size={18} /> },
  { value: 'SHEIN_CARD_SALE', label: 'كروت شي إن', icon: <ShoppingBag size={18} /> },
  { value: 'EXPENSE', label: 'مصروف / دفع فاتورة', icon: <ReceiptText size={18} /> },
];

const simplePaymentLabels: Record<SimplePaymentMethod, string> = {
  CASH: 'كاش',
  TRANSFER: 'حوالة',
  CARD: 'بطاقة مصرفية',
};

const detailedPaymentLabels: Record<DetailedPaymentMethod, string> = {
  LYD_CASH: 'كاش دينار',
  USD_CASH: 'كاش دولار',
  LYD_TRANSFER: 'حوالة دينار',
  USD_TRANSFER: 'حوالة دولار',
  CARD: 'بطاقة مصرفية',
};

const detailedPaymentCurrencyCode: Record<DetailedPaymentMethod, string> = {
  LYD_CASH: 'LYD',
  USD_CASH: 'USD',
  LYD_TRANSFER: 'LYD',
  USD_TRANSFER: 'USD',
  CARD: 'LYD',
};

const cashDirectionLabels: Record<CashDirection, string> = {
  IN: 'داخل',
  OUT: 'خارج',
  NONE: 'بدون تأثير على الصندوق',
};

const usdtActionLabels: Record<UsdtAction, string> = {
  BUY: 'شراء USDT',
  SELL: 'بيع USDT',
};

const cardActionLabels: Record<CardAction, string> = {
  RECEIVE_CARD: 'استلام بطاقة',
  PAY_CARD_VALUE: 'دفع قيمة بطاقة',
  WITHDRAW_FROM_CARD: 'سحب من بطاقة',
};

const conversionActionLabels: Record<ConversionAction, string> = {
  SELL_CURRENCY: 'بيع عملة',
  BUY_CURRENCY: 'شراء عملة',
  TRANSFER_AMOUNT: 'تحويل مبلغ',
};

const expenseActionLabels: Record<ExpenseAction, string> = {
  PAY_BILL: 'دفع فاتورة',
  GENERAL_EXPENSE: 'مصروف عام',
};

const transferStatusLabels: Record<TransferStatus, string> = {
  IN_PROGRESS: 'قيد التنفيذ',
  COMPLETED: 'مكتملة',
  CANCELLED: 'ملغية',
};

const cardStatusLabels: Record<ReceivedCardStatus, string> = {
  RECEIVED: 'مستلمة',
  IN_SETTLEMENT: 'قيد التصفية',
  SETTLED: 'تمت التصفية',
  PARTIAL: 'جزئية',
  COMPLETED: 'مكتملة',
  CANCELLED: 'ملغاة',
};

const initialForm: FormState = {
  personId: '',
  operationKind: 'MANUAL',
  executionType: '',
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

function normalizeNumberInput(value: string) {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';

  return value
    .replace(/[٠-٩]/g, (digit) => String(eastern.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
    .replace(',', '.');
}

function formatNumber(value: string | number) {
  return money(value).toLocaleString('en-US');
}

function formatAmount(value: string | number, currency?: CurrencyOption) {
  return `${formatNumber(value)} ${currency?.symbol || currency?.name || ''}`.trim();
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">{label}</label>
      {children}
    </div>
  );
}

export default function NewTransaction({
  initialPeople,
  initialCurrencies,
  initialSheinDenominations = [],
}: {
  initialPeople: PersonOption[];
  initialCurrencies: CurrencyOption[];
  initialSheinDenominations?: string[];
}) {
  const router = useRouter();
  const [people, setPeople] = useState<PersonOption[]>(initialPeople);
  const currencies = initialCurrencies;
  const defaultCurrencyId = currencies[0]?.id || '';
  const usdCurrency = currencies.find((currency) => currency.code === 'USD');
  const lydCurrency = currencies.find((currency) => currency.code === 'LYD');
  const usdtCurrency = currencies.find((currency) => currency.code === 'USDT');
  const counterCurrencies = currencies.filter((currency) => ['LYD', 'USD'].includes(currency.code));
  const defaultCounterCurrencyId = lydCurrency?.id || usdCurrency?.id || counterCurrencies[0]?.id || defaultCurrencyId;
  const [form, setForm] = useState<FormState>(initialForm);
  const [manualForm, setManualForm] = useState<ManualForm>({
    currencyId: defaultCurrencyId,
    amount: '',
    cashDirection: 'IN',
  });
  const [usdtForm, setUsdtForm] = useState<UsdtForm>({
    action: 'SELL',
    network: 'TRC20',
    customNetwork: '',
    usdtAmount: '',
    price: '',
    counterCurrencyId: defaultCounterCurrencyId,
    paymentMethod: 'CASH',
    txId: '',
  });
  const [cardForm, setCardForm] = useState<CardOperationForm>({
    action: 'RECEIVE_CARD',
    cardCount: '1',
    cardValue: '',
    currencyId: usdCurrency?.id || defaultCurrencyId,
    paymentAmount: '',
    paymentMethod: 'USD_CASH',
    cardStatus: 'RECEIVED',
  });
  const [cashboxForm, setCashboxForm] = useState<CashboxMovementForm>({
    action: 'IN',
    currencyId: defaultCurrencyId,
    amount: '',
    movementMethod: 'CASH',
    reason: '',
  });
  const [conversionForm, setConversionForm] = useState<ConversionForm>({
    action: 'TRANSFER_AMOUNT',
    fromCurrencyId: lydCurrency?.id || defaultCurrencyId,
    fromAmount: '',
    toCurrencyId: usdCurrency?.id || currencies[1]?.id || defaultCurrencyId,
    toAmount: '',
    exchangeRate: '',
    paymentMethod: 'CASH',
  });
  const [transferForm, setTransferForm] = useState<MoneyTransferForm>({
    receiverName: '',
    destination: '',
    currencyId: usdCurrency?.id || defaultCurrencyId,
    amount: '',
    commission: '',
    paymentMethod: 'CASH',
    status: 'IN_PROGRESS',
    transferNumber: '',
  });
  const [sheinForm, setSheinForm] = useState<SheinSaleForm>({
    denomination: '500',
    customDenomination: '',
    paymentMethod: 'LYD_CASH',
    pricePerCard: '',
    cardCount: '1',
  });
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>({
    action: 'PAY_BILL',
    payee: '',
    expenseType: '',
    currencyId: lydCurrency?.id || defaultCurrencyId,
    amount: '',
    paymentMethod: 'CASH',
    invoiceNumber: '',
  });
  const [customerForm, setCustomerForm] = useState<QuickCustomerForm>(initialCustomerForm);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const denominationOptions = useMemo(() => {
    const fixed = ['100', '300', '500', '800', '1000'];
    const extras = initialSheinDenominations.filter((item) => !fixed.includes(item));
    return Array.from(new Set([...fixed, ...extras])).sort((a, b) => Number(a) - Number(b));
  }, [initialSheinDenominations]);

  const selectedOperation = operationOptions.find((operation) => operation.value === form.operationKind);
  const manualCurrency = currencies.find((currency) => currency.id === manualForm.currencyId);
  const usdtCounterCurrency = currencies.find((currency) => currency.id === usdtForm.counterCurrencyId);
  const cardCurrency = currencies.find((currency) => currency.id === cardForm.currencyId);
  const cashboxCurrency = currencies.find((currency) => currency.id === cashboxForm.currencyId);
  const fromCurrency = currencies.find((currency) => currency.id === conversionForm.fromCurrencyId);
  const toCurrency = currencies.find((currency) => currency.id === conversionForm.toCurrencyId);
  const transferCurrency = currencies.find((currency) => currency.id === transferForm.currencyId);
  const sheinCurrency = currencies.find((currency) => currency.code === detailedPaymentCurrencyCode[sheinForm.paymentMethod]);
  const expenseCurrency = currencies.find((currency) => currency.id === expenseForm.currencyId);

  const usdtNetwork = usdtForm.network === 'OTHER' ? usdtForm.customNetwork.trim() || 'أخرى' : usdtForm.network;
  const usdtTotal = money(usdtForm.usdtAmount) * money(usdtForm.price);
  const cardTotal = money(cardForm.cardCount) * money(cardForm.cardValue);
  const sheinDenomination =
    sheinForm.denomination === CUSTOM_DENOMINATION ? sheinForm.customDenomination : sheinForm.denomination;
  const sheinTotal = money(sheinForm.pricePerCard) * Math.max(money(sheinForm.cardCount), 0);
  const calculatedExchangeRate =
    money(conversionForm.fromAmount) > 0 && money(conversionForm.toAmount) > 0
      ? money(conversionForm.toAmount) / money(conversionForm.fromAmount)
      : 0;
  const transferTotal = money(transferForm.amount) + money(transferForm.commission);

  const manualExecution = form.executionType || 'كتابة يدوية';
  const usdtExecution = `${usdtActionLabels[usdtForm.action]} ${formatNumber(usdtForm.usdtAmount)} USDT عبر ${usdtNetwork} مقابل ${formatAmount(
    usdtTotal,
    usdtCounterCurrency,
  )} ${simplePaymentLabels[usdtForm.paymentMethod]}`;
  const cardExecution = `${cardActionLabels[cardForm.action]} ${formatNumber(cardForm.cardCount)} بطاقات، قيمة كل بطاقة ${formatAmount(
    cardForm.cardValue,
    cardCurrency,
  )}، الإجمالي ${formatAmount(cardTotal, cardCurrency)}`;
  const cashboxExecution = `${cashboxForm.action === 'IN' ? 'دخول' : 'خروج'} ${formatAmount(
    cashboxForm.amount,
    cashboxCurrency,
  )} ${simplePaymentLabels[cashboxForm.movementMethod]}${cashboxForm.reason ? ` - ${cashboxForm.reason}` : ''}`;
  const conversionExecution = `${conversionActionLabels[conversionForm.action]} من ${formatAmount(
    conversionForm.fromAmount,
    fromCurrency,
  )} إلى ${formatAmount(conversionForm.toAmount, toCurrency)} عبر ${simplePaymentLabels[conversionForm.paymentMethod]}`;
  const transferExecution = `حوالة مالية إلى ${transferForm.destination || 'الجهة'} بقيمة ${formatAmount(
    transferForm.amount,
    transferCurrency,
  )}${money(transferForm.commission) > 0 ? ` وعمولة ${formatAmount(transferForm.commission, transferCurrency)}` : ''}`;
  const sheinExecution = `بيع ${formatNumber(sheinForm.cardCount)} كروت شي إن فئة ${formatNumber(
    sheinDenomination,
  )}$ بسعر ${formatAmount(sheinForm.pricePerCard, sheinCurrency)} للكرت (${detailedPaymentLabels[sheinForm.paymentMethod]})`;
  const expenseExecution = `${expenseActionLabels[expenseForm.action]} ${expenseForm.expenseType || 'مصروف'} بقيمة ${formatAmount(
    expenseForm.amount,
    expenseCurrency,
  )} عبر ${simplePaymentLabels[expenseForm.paymentMethod]}`;

  const executionPreview: Record<OperationKind, string> = {
    MANUAL: manualExecution,
    USDT: usdtExecution,
    CARD_OPERATION: cardExecution,
    CASHBOX_MOVEMENT: cashboxExecution,
    CURRENCY_CONVERSION: conversionExecution,
    MONEY_TRANSFER: transferExecution,
    SHEIN_CARD_SALE: sheinExecution,
    EXPENSE: expenseExecution,
  };

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setCustomerField<K extends keyof QuickCustomerForm>(key: K, value: QuickCustomerForm[K]) {
    setCustomerForm((current) => ({ ...current, [key]: value }));
  }

  function selectOperation(value: OperationKind) {
    setForm((current) => ({ ...current, operationKind: value, executionType: '' }));
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

  function setNumeric(value: string, setter: (value: string) => void) {
    setter(normalizeNumberInput(value));
  }

  async function addCustomer(event: FormEvent) {
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
    router.refresh();
  }

  async function add(event: FormEvent) {
    event.preventDefault();

    let body: any;
    const executionType = (form.executionType || executionPreview[form.operationKind]).trim();

    if (form.operationKind === 'MANUAL') {
      if (!manualForm.currencyId) return toast.error('اختر العملة');
      if (money(manualForm.amount) <= 0) return toast.error('أدخل مبلغ العملية');
      if (!form.executionType.trim()) return toast.error('اكتب نوع التنفيذ للعملية اليدوية');

      body = {
        operationKind: 'MANUAL',
        personId: form.personId || null,
        executionType,
        notes: form.notes || undefined,
        manual: {
          currencyId: manualForm.currencyId,
          amount: money(manualForm.amount),
          cashDirection: manualForm.cashDirection,
        },
      };
    }

    if (form.operationKind === 'USDT') {
      if (!form.personId) return toast.error('اختر الزبون');
      if (!usdtCurrency) return toast.error('عملة USDT غير مفعلة في الإعدادات');
      if (!usdtForm.counterCurrencyId) return toast.error('اختر العملة المقابلة');
      if (money(usdtForm.usdtAmount) <= 0) return toast.error('أدخل كمية USDT');
      if (money(usdtForm.price) <= 0) return toast.error('أدخل السعر');

      body = {
        operationKind: 'USDT',
        personId: form.personId,
        executionType,
        txId: usdtForm.txId || undefined,
        notes: form.notes || undefined,
        usdt: {
          action: usdtForm.action,
          network: usdtNetwork,
          usdtAmount: money(usdtForm.usdtAmount),
          price: money(usdtForm.price),
          counterCurrencyId: usdtForm.counterCurrencyId,
          paymentMethod: usdtForm.paymentMethod,
          txId: usdtForm.txId || undefined,
        },
      };
    }

    if (form.operationKind === 'CARD_OPERATION') {
      if (!form.personId) return toast.error('اختر الزبون');
      if (!cardForm.currencyId) return toast.error('اختر العملة');
      if (money(cardForm.cardCount) <= 0) return toast.error('أدخل عدد البطاقات');
      if (money(cardForm.cardValue) <= 0) return toast.error('أدخل قيمة كل بطاقة');
      if (cardForm.action !== 'RECEIVE_CARD' && money(cardForm.paymentAmount) <= 0) {
        return toast.error('أدخل المبلغ المدفوع أو المسحوب');
      }

      body = {
        operationKind: 'CARD_OPERATION',
        personId: form.personId,
        executionType,
        notes: form.notes || undefined,
        cardOperation: {
          action: cardForm.action,
          cardCount: Number(cardForm.cardCount),
          cardValue: money(cardForm.cardValue),
          currencyId: cardForm.currencyId,
          paymentAmount: cardForm.action === 'RECEIVE_CARD' ? 0 : money(cardForm.paymentAmount || cardTotal),
          paymentMethod: cardForm.paymentMethod,
          cardStatus: cardForm.cardStatus,
        },
      };
    }

    if (form.operationKind === 'CASHBOX_MOVEMENT') {
      if (!cashboxForm.currencyId) return toast.error('اختر العملة');
      if (money(cashboxForm.amount) <= 0) return toast.error('أدخل مبلغ الحركة');
      if (cashboxForm.reason.trim().length < 3) return toast.error('أدخل سبب حركة الصندوق');

      body = {
        operationKind: 'CASHBOX_MOVEMENT',
        personId: form.personId || null,
        executionType,
        notes: form.notes || undefined,
        cashboxMovement: {
          action: cashboxForm.action,
          currencyId: cashboxForm.currencyId,
          amount: money(cashboxForm.amount),
          movementMethod: cashboxForm.movementMethod,
          reason: cashboxForm.reason,
        },
      };
    }

    if (form.operationKind === 'CURRENCY_CONVERSION') {
      if (!form.personId) return toast.error('اختر الزبون');
      if (!conversionForm.fromCurrencyId || !conversionForm.toCurrencyId) return toast.error('اختر عملتي العملية');
      if (conversionForm.fromCurrencyId === conversionForm.toCurrencyId) return toast.error('اختر عملتين مختلفتين');
      if (money(conversionForm.fromAmount) <= 0 || money(conversionForm.toAmount) <= 0) {
        return toast.error('أدخل المبلغ الخارج والمبلغ الداخل');
      }

      body = {
        operationKind: 'CURRENCY_CONVERSION',
        personId: form.personId,
        executionType,
        notes: form.notes || undefined,
        conversion: {
          action: conversionForm.action,
          fromCurrencyId: conversionForm.fromCurrencyId,
          toCurrencyId: conversionForm.toCurrencyId,
          fromAmount: money(conversionForm.fromAmount),
          toAmount: money(conversionForm.toAmount),
          exchangeRate: money(conversionForm.exchangeRate) || undefined,
          paymentMethod: conversionForm.paymentMethod,
          notes: form.notes || undefined,
        },
      };
    }

    if (form.operationKind === 'MONEY_TRANSFER') {
      if (!form.personId) return toast.error('اختر الزبون / المرسل');
      if (transferForm.receiverName.trim().length < 2) return toast.error('أدخل اسم المستلم');
      if (transferForm.destination.trim().length < 2) return toast.error('أدخل الدولة أو الجهة');
      if (!transferForm.currencyId) return toast.error('اختر العملة');
      if (money(transferForm.amount) <= 0) return toast.error('أدخل مبلغ الحوالة');

      body = {
        operationKind: 'MONEY_TRANSFER',
        personId: form.personId,
        executionType,
        notes: form.notes || undefined,
        moneyTransfer: {
          receiverName: transferForm.receiverName,
          destination: transferForm.destination,
          currencyId: transferForm.currencyId,
          amount: money(transferForm.amount),
          commission: money(transferForm.commission),
          paymentMethod: transferForm.paymentMethod,
          status: transferForm.status,
          transferNumber: transferForm.transferNumber || undefined,
        },
      };
    }

    if (form.operationKind === 'SHEIN_CARD_SALE') {
      if (!form.personId) return toast.error('اختر الزبون');
      if (money(sheinDenomination) <= 0) return toast.error('اختر فئة الكرت');
      if (money(sheinForm.pricePerCard) <= 0) return toast.error('أدخل سعر بيع الكرت الواحد');
      if (money(sheinForm.cardCount) <= 0) return toast.error('أدخل عدد الكروت');
      if (!sheinCurrency) return toast.error('عملة طريقة الدفع غير مفعلة');

      body = {
        operationKind: 'SHEIN_CARD_SALE',
        personId: form.personId,
        executionType,
        notes: form.notes || undefined,
        sheinSale: {
          denomination: money(sheinDenomination),
          paymentMethod: sheinForm.paymentMethod,
          pricePerCard: money(sheinForm.pricePerCard),
          cardCount: Number(sheinForm.cardCount),
          notes: form.notes || undefined,
        },
      };
    }

    if (form.operationKind === 'EXPENSE') {
      if (expenseForm.payee.trim().length < 2) return toast.error('أدخل الجهة أو الشخص');
      if (expenseForm.expenseType.trim().length < 2) return toast.error('أدخل نوع المصروف');
      if (!expenseForm.currencyId) return toast.error('اختر العملة');
      if (money(expenseForm.amount) <= 0) return toast.error('أدخل مبلغ المصروف');

      body = {
        operationKind: 'EXPENSE',
        personId: form.personId || null,
        executionType,
        notes: form.notes || undefined,
        expense: {
          action: expenseForm.action,
          payee: expenseForm.payee,
          expenseType: expenseForm.expenseType,
          currencyId: expenseForm.currencyId,
          amount: money(expenseForm.amount),
          paymentMethod: expenseForm.paymentMethod,
          invoiceNumber: expenseForm.invoiceNumber || undefined,
        },
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
    router.refresh();
    router.push('/transactions');
  }

  function swapConversionCurrencies() {
    setConversionForm((current) => ({
      ...current,
      fromCurrencyId: current.toCurrencyId,
      toCurrencyId: current.fromCurrencyId,
      fromAmount: current.toAmount,
      toAmount: current.fromAmount,
    }));
  }

  function renderCurrencyOptions(items = currencies) {
    return items.map((currency) => (
      <option key={currency.id} value={currency.id}>
        {currency.name}
      </option>
    ));
  }

  function renderOperationFields() {
    if (form.operationKind === 'MANUAL') {
      return (
        <>
          <Field label="المبلغ">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={manualForm.amount}
              onChange={(event) => setNumeric(event.target.value, (value) => setManualForm({ ...manualForm, amount: value }))}
              placeholder="1000"
            />
          </Field>
          <Field label="العملة">
            <select value={manualForm.currencyId} onChange={(event) => setManualForm({ ...manualForm, currencyId: event.target.value })}>
              {renderCurrencyOptions()}
            </select>
          </Field>
          <Field label="اتجاه العملية" className="md:col-span-2">
            <select
              value={manualForm.cashDirection}
              onChange={(event) => setManualForm({ ...manualForm, cashDirection: event.target.value as CashDirection })}
            >
              {Object.entries(cashDirectionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </>
      );
    }

    if (form.operationKind === 'USDT') {
      return (
        <>
          <Field label="نوع العملية">
            <select value={usdtForm.action} onChange={(event) => setUsdtForm({ ...usdtForm, action: event.target.value as UsdtAction })}>
              {Object.entries(usdtActionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الشبكة">
            <select value={usdtForm.network} onChange={(event) => setUsdtForm({ ...usdtForm, network: event.target.value as UsdtForm['network'] })}>
              <option value="TRC20">TRC20</option>
              <option value="BEP20">BEP20</option>
              <option value="OTHER">أخرى</option>
            </select>
          </Field>
          {usdtForm.network === 'OTHER' ? (
            <Field label="اسم الشبكة">
              <input value={usdtForm.customNetwork} onChange={(event) => setUsdtForm({ ...usdtForm, customNetwork: event.target.value })} />
            </Field>
          ) : null}
          <Field label="كمية USDT">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={usdtForm.usdtAmount}
              onChange={(event) => setNumeric(event.target.value, (value) => setUsdtForm({ ...usdtForm, usdtAmount: value }))}
              placeholder="500"
            />
          </Field>
          <Field label="السعر">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={usdtForm.price}
              onChange={(event) => setNumeric(event.target.value, (value) => setUsdtForm({ ...usdtForm, price: value }))}
              placeholder="5.4"
            />
          </Field>
          <Field label="العملة المقابلة">
            <select value={usdtForm.counterCurrencyId} onChange={(event) => setUsdtForm({ ...usdtForm, counterCurrencyId: event.target.value })}>
              {renderCurrencyOptions(counterCurrencies.length ? counterCurrencies : currencies)}
            </select>
          </Field>
          <Field label="طريقة الدفع">
            <select
              value={usdtForm.paymentMethod}
              onChange={(event) => setUsdtForm({ ...usdtForm, paymentMethod: event.target.value as SimplePaymentMethod })}
            >
              {Object.entries(simplePaymentLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="TxID اختياري" className="md:col-span-2">
            <input value={usdtForm.txId} onChange={(event) => setUsdtForm({ ...usdtForm, txId: event.target.value })} />
          </Field>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300 md:col-span-2">
            الإجمالي: {formatAmount(usdtTotal, usdtCounterCurrency)}
          </div>
        </>
      );
    }

    if (form.operationKind === 'CARD_OPERATION') {
      return (
        <>
          <Field label="نوع العملية">
            <select value={cardForm.action} onChange={(event) => setCardForm({ ...cardForm, action: event.target.value as CardAction })}>
              {Object.entries(cardActionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="عدد البطاقات">
            <input
              type="number"
              min="1"
              step="1"
              value={cardForm.cardCount}
              onChange={(event) => setNumeric(event.target.value, (value) => setCardForm({ ...cardForm, cardCount: value }))}
            />
          </Field>
          <Field label="قيمة كل بطاقة">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={cardForm.cardValue}
              onChange={(event) => setNumeric(event.target.value, (value) => setCardForm({ ...cardForm, cardValue: value }))}
              placeholder="200"
            />
          </Field>
          <Field label="إجمالي قيمة البطاقات">
            <input value={formatAmount(cardTotal, cardCurrency)} readOnly disabled />
          </Field>
          <Field label="العملة">
            <select value={cardForm.currencyId} onChange={(event) => setCardForm({ ...cardForm, currencyId: event.target.value })}>
              {renderCurrencyOptions()}
            </select>
          </Field>
          {cardForm.action !== 'RECEIVE_CARD' ? (
            <>
              <Field label="المبلغ المدفوع أو المسحوب">
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={cardForm.paymentAmount}
                  onChange={(event) => setNumeric(event.target.value, (value) => setCardForm({ ...cardForm, paymentAmount: value }))}
                  placeholder={formatNumber(cardTotal)}
                />
              </Field>
              <Field label="طريقة الدفع أو الاستلام">
                <select
                  value={cardForm.paymentMethod}
                  onChange={(event) => setCardForm({ ...cardForm, paymentMethod: event.target.value as DetailedPaymentMethod })}
                >
                  {Object.entries(detailedPaymentLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}
          <Field label="حالة البطاقة">
            <select
              value={cardForm.cardStatus}
              onChange={(event) => setCardForm({ ...cardForm, cardStatus: event.target.value as ReceivedCardStatus })}
            >
              {Object.entries(cardStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </>
      );
    }

    if (form.operationKind === 'CASHBOX_MOVEMENT') {
      return (
        <>
          <Field label="نوع الحركة">
            <select
              value={cashboxForm.action}
              onChange={(event) => setCashboxForm({ ...cashboxForm, action: event.target.value as CashboxMovementForm['action'] })}
            >
              <option value="IN">دخول مبلغ</option>
              <option value="OUT">خروج مبلغ</option>
            </select>
          </Field>
          <Field label="العملة">
            <select value={cashboxForm.currencyId} onChange={(event) => setCashboxForm({ ...cashboxForm, currencyId: event.target.value })}>
              {renderCurrencyOptions()}
            </select>
          </Field>
          <Field label="المبلغ">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={cashboxForm.amount}
              onChange={(event) => setNumeric(event.target.value, (value) => setCashboxForm({ ...cashboxForm, amount: value }))}
              placeholder="5000"
            />
          </Field>
          <Field label="طريقة الحركة">
            <select
              value={cashboxForm.movementMethod}
              onChange={(event) => setCashboxForm({ ...cashboxForm, movementMethod: event.target.value as SimplePaymentMethod })}
            >
              {Object.entries(simplePaymentLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="السبب - إجباري" className="md:col-span-2">
            <input value={cashboxForm.reason} onChange={(event) => setCashboxForm({ ...cashboxForm, reason: event.target.value })} />
          </Field>
        </>
      );
    }

    if (form.operationKind === 'CURRENCY_CONVERSION') {
      return (
        <>
          <Field label="نوع العملية">
            <select
              value={conversionForm.action}
              onChange={(event) => setConversionForm({ ...conversionForm, action: event.target.value as ConversionAction })}
            >
              {Object.entries(conversionActionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="طريقة الدفع">
            <select
              value={conversionForm.paymentMethod}
              onChange={(event) => setConversionForm({ ...conversionForm, paymentMethod: event.target.value as SimplePaymentMethod })}
            >
              {Object.entries(simplePaymentLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="العملة الخارجة">
            <select
              value={conversionForm.fromCurrencyId}
              onChange={(event) => setConversionForm({ ...conversionForm, fromCurrencyId: event.target.value })}
            >
              {renderCurrencyOptions()}
            </select>
          </Field>
          <Field label="المبلغ الخارج">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={conversionForm.fromAmount}
              onChange={(event) => setNumeric(event.target.value, (value) => setConversionForm({ ...conversionForm, fromAmount: value }))}
              placeholder="17000"
            />
          </Field>
          <button
            type="button"
            onClick={swapConversionCurrencies}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 md:col-span-2"
          >
            <Repeat2 size={18} />
            قلب العملات
          </button>
          <Field label="العملة الداخلة">
            <select
              value={conversionForm.toCurrencyId}
              onChange={(event) => setConversionForm({ ...conversionForm, toCurrencyId: event.target.value })}
            >
              {renderCurrencyOptions()}
            </select>
          </Field>
          <Field label="المبلغ الداخل">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={conversionForm.toAmount}
              onChange={(event) => setNumeric(event.target.value, (value) => setConversionForm({ ...conversionForm, toAmount: value }))}
              placeholder="2000"
            />
          </Field>
          <Field label="سعر الصرف اختياري">
            <input
              type="number"
              min="0"
              step="0.00000001"
              value={conversionForm.exchangeRate}
              onChange={(event) => setNumeric(event.target.value, (value) => setConversionForm({ ...conversionForm, exchangeRate: value }))}
              placeholder={calculatedExchangeRate ? calculatedExchangeRate.toLocaleString('en-US', { maximumFractionDigits: 8 }) : 'يحسب تلقائيًا'}
            />
          </Field>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
            السعر المحسوب: {calculatedExchangeRate ? calculatedExchangeRate.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '0'}
          </div>
        </>
      );
    }

    if (form.operationKind === 'MONEY_TRANSFER') {
      return (
        <>
          <Field label="المستلم">
            <input value={transferForm.receiverName} onChange={(event) => setTransferForm({ ...transferForm, receiverName: event.target.value })} />
          </Field>
          <Field label="الدولة أو الجهة">
            <input value={transferForm.destination} onChange={(event) => setTransferForm({ ...transferForm, destination: event.target.value })} />
          </Field>
          <Field label="العملة">
            <select value={transferForm.currencyId} onChange={(event) => setTransferForm({ ...transferForm, currencyId: event.target.value })}>
              {renderCurrencyOptions()}
            </select>
          </Field>
          <Field label="المبلغ">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={transferForm.amount}
              onChange={(event) => setNumeric(event.target.value, (value) => setTransferForm({ ...transferForm, amount: value }))}
              placeholder="1000"
            />
          </Field>
          <Field label="العمولة">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={transferForm.commission}
              onChange={(event) => setNumeric(event.target.value, (value) => setTransferForm({ ...transferForm, commission: value }))}
              placeholder="0"
            />
          </Field>
          <Field label="طريقة الدفع">
            <select
              value={transferForm.paymentMethod}
              onChange={(event) => setTransferForm({ ...transferForm, paymentMethod: event.target.value as SimplePaymentMethod })}
            >
              {Object.entries(simplePaymentLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="حالة الحوالة">
            <select value={transferForm.status} onChange={(event) => setTransferForm({ ...transferForm, status: event.target.value as TransferStatus })}>
              {Object.entries(transferStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="رقم الحوالة اختياري">
            <input value={transferForm.transferNumber} onChange={(event) => setTransferForm({ ...transferForm, transferNumber: event.target.value })} />
          </Field>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300 md:col-span-2">
            الإجمالي مع العمولة: {formatAmount(transferTotal, transferCurrency)}
          </div>
        </>
      );
    }

    if (form.operationKind === 'SHEIN_CARD_SALE') {
      return (
        <>
          <Field label="فئة الكرت">
            <select value={sheinForm.denomination} onChange={(event) => setSheinForm({ ...sheinForm, denomination: event.target.value })}>
              {denominationOptions.map((denomination) => (
                <option key={denomination} value={denomination}>
                  {denomination}$
                </option>
              ))}
              <option value={CUSTOM_DENOMINATION}>أخرى</option>
            </select>
          </Field>
          {sheinForm.denomination === CUSTOM_DENOMINATION ? (
            <Field label="الفئة الأخرى">
              <input
                type="number"
                min="1"
                step="0.000001"
                value={sheinForm.customDenomination}
                onChange={(event) => setNumeric(event.target.value, (value) => setSheinForm({ ...sheinForm, customDenomination: value }))}
                placeholder="1200"
              />
            </Field>
          ) : null}
          <Field label="عدد الكروت">
            <input
              type="number"
              min="1"
              step="1"
              value={sheinForm.cardCount}
              onChange={(event) => setNumeric(event.target.value, (value) => setSheinForm({ ...sheinForm, cardCount: value }))}
              placeholder="5"
            />
          </Field>
          <Field label="سعر بيع الكرت الواحد">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={sheinForm.pricePerCard}
              onChange={(event) => setNumeric(event.target.value, (value) => setSheinForm({ ...sheinForm, pricePerCard: value }))}
              placeholder="4000"
            />
          </Field>
          <Field label="عملة وطريقة البيع">
            <select
              value={sheinForm.paymentMethod}
              onChange={(event) => setSheinForm({ ...sheinForm, paymentMethod: event.target.value as DetailedPaymentMethod })}
            >
              {Object.entries(detailedPaymentLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
            الإجمالي: {formatAmount(sheinTotal, sheinCurrency)}
          </div>
        </>
      );
    }

    return (
      <>
        <Field label="نوع العملية">
          <select value={expenseForm.action} onChange={(event) => setExpenseForm({ ...expenseForm, action: event.target.value as ExpenseAction })}>
            {Object.entries(expenseActionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الجهة أو الشخص">
          <input value={expenseForm.payee} onChange={(event) => setExpenseForm({ ...expenseForm, payee: event.target.value })} />
        </Field>
        <Field label="نوع المصروف">
          <input value={expenseForm.expenseType} onChange={(event) => setExpenseForm({ ...expenseForm, expenseType: event.target.value })} />
        </Field>
        <Field label="العملة">
          <select value={expenseForm.currencyId} onChange={(event) => setExpenseForm({ ...expenseForm, currencyId: event.target.value })}>
            {renderCurrencyOptions()}
          </select>
        </Field>
        <Field label="المبلغ">
          <input
            type="number"
            min="0"
            step="0.000001"
            value={expenseForm.amount}
            onChange={(event) => setNumeric(event.target.value, (value) => setExpenseForm({ ...expenseForm, amount: value }))}
            placeholder="300"
          />
        </Field>
        <Field label="طريقة الدفع">
          <select
            value={expenseForm.paymentMethod}
            onChange={(event) => setExpenseForm({ ...expenseForm, paymentMethod: event.target.value as SimplePaymentMethod })}
          >
            {Object.entries(simplePaymentLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="رقم الفاتورة اختياري" className="md:col-span-2">
          <input value={expenseForm.invoiceNumber} onChange={(event) => setExpenseForm({ ...expenseForm, invoiceNumber: event.target.value })} />
        </Field>
      </>
    );
  }

  return (
    <>
      <form onSubmit={add} className="card grid gap-5 p-5 md:grid-cols-2">
        <Field label={form.operationKind === 'MONEY_TRANSFER' ? 'الزبون / المرسل' : 'الزبون'} className="md:col-span-2">
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
        </Field>

        <Field label="نوع العملية" className="md:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {operationOptions.map((operation) => (
              <button
                key={operation.value}
                type="button"
                onClick={() => selectOperation(operation.value)}
                className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${
                  form.operationKind === operation.value
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {operation.icon}
                <span>{operation.label}</span>
              </button>
            ))}
          </div>
        </Field>

        <div className="md:col-span-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
          {selectedOperation?.icon}
          <span>{selectedOperation?.label}</span>
        </div>

        {renderOperationFields()}

        <Field label="نوع التنفيذ" className="md:col-span-2">
          <input
            value={form.executionType}
            onChange={(event) => setField('executionType', event.target.value)}
            placeholder={form.operationKind === 'MANUAL' ? 'اكتب نوع التنفيذ يدويًا' : executionPreview[form.operationKind]}
          />
          {form.operationKind !== 'MANUAL' ? (
            <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
              {executionPreview[form.operationKind]}
            </div>
          ) : null}
        </Field>

        <Field label="ملاحظات" className="md:col-span-2">
          <textarea
            value={form.notes}
            onChange={(event) => setField('notes', event.target.value)}
            placeholder="ملاحظات عامة"
            rows={3}
          />
        </Field>

        <button
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-400 md:col-span-2"
        >
          {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
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
              <Field label="اسم الزبون">
                <input
                  autoFocus
                  value={customerForm.fullName}
                  onChange={(event) => setCustomerField('fullName', event.target.value)}
                  placeholder="الاسم الكامل"
                />
              </Field>

              <Field label="رقم الهاتف">
                <input
                  value={customerForm.phone}
                  onChange={(event) => setCustomerField('phone', event.target.value)}
                  placeholder="09xxxxxxxx"
                />
              </Field>

              <Field label="التصنيف" className="md:col-span-2">
                <select
                  value={customerForm.category}
                  onChange={(event) => setCustomerField('category', event.target.value as QuickCustomerForm['category'])}
                >
                  <option value="REGULAR">عميل عادي</option>
                  <option value="VIP">عميل مميز</option>
                </select>
              </Field>

              <Field label="معلومات إضافية" className="md:col-span-2">
                <textarea
                  value={customerForm.externalId}
                  onChange={(event) => setCustomerField('externalId', event.target.value)}
                  placeholder="أي معلومات إضافية عن الزبون"
                  rows={2}
                />
              </Field>

              <Field label="ملاحظات" className="md:col-span-2">
                <textarea
                  value={customerForm.notes}
                  onChange={(event) => setCustomerField('notes', event.target.value)}
                  placeholder="ملاحظات عن الزبون"
                  rows={3}
                />
              </Field>
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
