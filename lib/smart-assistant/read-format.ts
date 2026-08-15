import type { AssistantIntent } from './schema';
import { numberValue, toEnglishDigits } from '@/lib/format';

export type AssistantReadQueryMode =
  | 'DEBT_SUMMARY'
  | 'CARDS_SUMMARY'
  | 'CARDS_DETAILS'
  | 'DELIVERIES_SUMMARY'
  | 'FINANCIAL_REMAINING'
  | 'ACCOUNT_SUMMARY'
  | 'CARD_LAST_OPERATION'
  | 'CARD_REMAINING'
  | 'FULL_SUMMARY';

export type AssistantAmount = {
  amount: unknown;
  currencyCode: string;
  currencySymbol?: string | null;
};

export type AssistantCustomerCardView = {
  publicCode?: string | null;
  cardLast4?: string | null;
  bankName?: string | null;
  originalAmount: unknown;
  agreedAmount: unknown;
  agreedCurrencyCode: string;
  agreedCurrencySymbol?: string | null;
  deductedAmount: unknown;
  remainingAmount: unknown;
  status: string;
  lastOperation?: {
    label: string;
    amount: unknown;
    currencyCode: string;
    currencySymbol?: string | null;
    occurredAt: Date | string;
  } | null;
};

export type AssistantCustomerReadView = {
  customer: {
    code?: string | null;
    name: string;
  };
  cards: AssistantCustomerCardView[];
  totalOriginalUsd: unknown;
  agreedByCurrency: AssistantAmount[];
  deliveredByCurrency: AssistantAmount[];
  financialRemainingByCurrency: AssistantAmount[];
  walletDebtByCurrency: AssistantAmount[];
  walletCreditByCurrency: AssistantAmount[];
  hasDeliveries: boolean;
  latestActivity?: {
    label: string;
    occurredAt: Date | string;
  } | null;
};

export type AssistantSystemAccountView = {
  walletDebtByCurrency: AssistantAmount[];
  walletCreditByCurrency: AssistantAmount[];
  latestActivity?: {
    label: string;
    occurredAt: Date | string;
  } | null;
};

export type AssistantCustomerMatch = {
  code?: string | null;
  name: string;
};

type QueryCustomerIntent = Extract<AssistantIntent, { type: 'QUERY_CUSTOMER' }>;

const rawDataPatterns = [
  /```/,
  /^\s*[\[{]/,
  /[\]}]\s*$/,
  /"\w+"\s*:/,
  /\b(function_call|tool_call|JSON|stringify|customerCode|currencyCode|paymentMethod|accountType)\b/i,
];

function amountIsNonZero(amount: unknown) {
  return Math.abs(numberValue(amount)) > 0.000001;
}

function displayCurrency(currencyCode?: string | null, currencySymbol?: string | null) {
  if (currencyCode === 'USD') return '$';
  if (currencyCode === 'LYD') return 'د.ل';
  if (currencyCode === 'USDT') return 'USDT';
  if (currencyCode === 'CNY') return '¥';
  return currencySymbol || currencyCode || '';
}

export function formatAssistantMoney(amount: unknown, currencyCode?: string | null, currencySymbol?: string | null) {
  const maximumFractionDigits = currencyCode === 'USDT' ? 6 : 2;
  const value = numberValue(amount).toLocaleString('en-US', {
    maximumFractionDigits,
  });
  const currency = displayCurrency(currencyCode, currencySymbol);
  if (!currency) return value;
  return currency === '$' ? `${value}$` : `${value} ${currency}`;
}

function formatDateForArabic(value: Date | string) {
  return new Date(value).toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function customerHeader(view: AssistantCustomerReadView) {
  const code = view.customer.code || 'بدون كود';
  return `**${code} - ${view.customer.name}**`;
}

function cardHeader(card: AssistantCustomerCardView, customer?: AssistantCustomerReadView['customer']) {
  const code = card.publicCode || 'بطاقة';
  const last4 = card.cardLast4 ? ` - ${card.cardLast4}` : '';
  const owner = customer?.code || customer?.name ? `\nالزبون: ${[customer.code, customer.name].filter(Boolean).join(' - ')}` : '';
  return `**${code}${last4}**${owner}`;
}

function formatAmountLines(amounts: AssistantAmount[], emptyText = 'لا يوجد') {
  const visible = amounts.filter((item) => amountIsNonZero(item.amount));
  if (!visible.length) return emptyText;
  if (visible.length === 1) {
    const item = visible[0];
    return formatAssistantMoney(item.amount, item.currencyCode, item.currencySymbol);
  }
  return visible.map((item) => `- ${formatAssistantMoney(item.amount, item.currencyCode, item.currencySymbol)}`).join('\n');
}

function formatAmountLinesKeepingZeros(amounts: AssistantAmount[], fallbackCurrency = 'USD') {
  if (!amounts.length) return formatAssistantMoney(0, fallbackCurrency);
  if (amounts.length === 1) {
    const item = amounts[0];
    return formatAssistantMoney(item.amount, item.currencyCode, item.currencySymbol);
  }
  return amounts.map((item) => `- ${formatAssistantMoney(item.amount, item.currencyCode, item.currencySymbol)}`).join('\n');
}

function labelledAmount(label: string, amountText: string) {
  return amountText.startsWith('- ') ? `${label}:\n${amountText}` : `${label}: ${amountText}`;
}

function cardStatusLabel(status: string) {
  const labels: Record<string, string> = {
    RECEIVED: 'مستلمة',
    IN_SETTLEMENT: 'قيد التسوية',
    SETTLED: 'تمت التسوية',
    PARTIAL: 'جزئية',
    COMPLETED: 'مكتملة',
    CANCELLED: 'ملغاة',
  };
  return labels[status] || status;
}

function formatCardsSummary(view: AssistantCustomerReadView) {
  if (!view.cards.length) return `${customerHeader(view)}\n\nلا توجد بطاقات مسجلة لهذا الزبون.`;

  return [
    customerHeader(view),
    '',
    `- عدد البطاقات: ${view.cards.length}`,
    `- إجمالي المبلغ الأصلي: ${formatAssistantMoney(view.totalOriginalUsd, 'USD')}`,
    `- ${labelledAmount('إجمالي المتفق عليه', formatAmountLinesKeepingZeros(view.agreedByCurrency))}`,
    `- ${labelledAmount('المسلّم', formatAmountLinesKeepingZeros(view.deliveredByCurrency))}`,
    `- ${labelledAmount('المتبقي للزبون', formatAmountLinesKeepingZeros(view.financialRemainingByCurrency))}`,
  ].join('\n');
}

function formatCardsDetails(view: AssistantCustomerReadView) {
  if (!view.cards.length) return `${customerHeader(view)}\n\nلا توجد بطاقات مسجلة لهذا الزبون.`;

  return [
    customerHeader(view),
    '',
    ...view.cards.map((card, index) => {
      const code = card.publicCode || `بطاقة ${index + 1}`;
      const last4 = card.cardLast4 || 'بدون آخر 4';
      return [
        `- ${code} - ${last4}:`,
        `  الأصلي ${formatAssistantMoney(card.originalAmount, 'USD')}، المتفق عليه ${formatAssistantMoney(
          card.agreedAmount,
          card.agreedCurrencyCode,
          card.agreedCurrencySymbol,
        )}، المسحوب ${formatAssistantMoney(card.deductedAmount, 'USD')}، المتبقي داخل البطاقة ${formatAssistantMoney(
          card.remainingAmount,
          'USD',
        )}، الحالة: ${cardStatusLabel(card.status)}.`,
      ].join('\n');
    }),
  ].join('\n');
}

function formatDebtSummary(view: AssistantCustomerReadView) {
  const debtText = formatAmountLines(view.walletDebtByCurrency, 'لا يوجد');
  const hasDebt = view.walletDebtByCurrency.some((item) => amountIsNonZero(item.amount));

  return [
    customerHeader(view),
    '',
    labelledAmount('الدين الحالي', debtText),
    `الحالة: ${hasDebt ? 'لم يتم السداد.' : 'تم السداد.'}`,
  ].join('\n');
}

function formatDeliveriesSummary(view: AssistantCustomerReadView) {
  const lines = [customerHeader(view), ''];
  if (!view.hasDeliveries) lines.push('لا توجد حركة مسجلة بهذا النوع.');
  lines.push(labelledAmount('إجمالي المسلّم', formatAmountLinesKeepingZeros(view.deliveredByCurrency)));
  lines.push(labelledAmount('المتبقي للزبون', formatAmountLinesKeepingZeros(view.financialRemainingByCurrency)));
  return lines.join('\n');
}

function formatFinancialRemaining(view: AssistantCustomerReadView) {
  return [
    customerHeader(view),
    '',
    labelledAmount('المتبقي المالي للزبون', formatAmountLinesKeepingZeros(view.financialRemainingByCurrency)),
  ].join('\n');
}

function formatAccountSummary(view: AssistantCustomerReadView) {
  const lines = [
    customerHeader(view),
    '',
    labelledAmount('لنا', formatAmountLines(view.walletDebtByCurrency, 'لا يوجد')),
    labelledAmount('علينا', formatAmountLines(view.walletCreditByCurrency, 'لا يوجد')),
    labelledAmount('المتبقي المالي للزبون', formatAmountLinesKeepingZeros(view.financialRemainingByCurrency)),
  ];

  if (view.latestActivity) lines.push(`آخر تحديث: ${view.latestActivity.label} - ${formatDateForArabic(view.latestActivity.occurredAt)}`);
  return lines.join('\n');
}

function formatFullSummary(view: AssistantCustomerReadView) {
  const lines = [
    customerHeader(view),
    '',
    `عدد البطاقات: ${view.cards.length}`,
    labelledAmount('لنا', formatAmountLines(view.walletDebtByCurrency, 'لا يوجد')),
    labelledAmount('علينا', formatAmountLines(view.walletCreditByCurrency, 'لا يوجد')),
    labelledAmount('المسلّم', formatAmountLinesKeepingZeros(view.deliveredByCurrency)),
    labelledAmount('المتبقي للزبون', formatAmountLinesKeepingZeros(view.financialRemainingByCurrency)),
  ];

  if (view.latestActivity) lines.push(`آخر تحديث: ${view.latestActivity.label} - ${formatDateForArabic(view.latestActivity.occurredAt)}`);
  return lines.join('\n');
}

export function formatCustomerReadAnswer(mode: AssistantReadQueryMode, view: AssistantCustomerReadView) {
  if (mode === 'DEBT_SUMMARY') return formatDebtSummary(view);
  if (mode === 'CARDS_SUMMARY') return formatCardsSummary(view);
  if (mode === 'CARDS_DETAILS') return formatCardsDetails(view);
  if (mode === 'DELIVERIES_SUMMARY') return formatDeliveriesSummary(view);
  if (mode === 'FINANCIAL_REMAINING') return formatFinancialRemaining(view);
  if (mode === 'ACCOUNT_SUMMARY') return formatAccountSummary(view);
  return formatFullSummary(view);
}

export function formatCardReadAnswer(
  mode: Extract<AssistantReadQueryMode, 'CARD_LAST_OPERATION' | 'CARD_REMAINING'>,
  card: AssistantCustomerCardView,
  customer?: AssistantCustomerReadView['customer'],
) {
  if (mode === 'CARD_REMAINING') {
    return [
      cardHeader(card, customer),
      '',
      `المتبقي داخل البطاقة: ${formatAssistantMoney(card.remainingAmount, 'USD')}`,
      `المسحوب: ${formatAssistantMoney(card.deductedAmount, 'USD')}`,
    ].join('\n');
  }

  if (!card.lastOperation) {
    return [cardHeader(card, customer), '', 'لا توجد حركة مسجلة بهذا النوع.'].join('\n');
  }

  return [
    cardHeader(card, customer),
    '',
    `آخر حركة: ${card.lastOperation.label}`,
    `المبلغ: ${formatAssistantMoney(card.lastOperation.amount, card.lastOperation.currencyCode, card.lastOperation.currencySymbol)}`,
    `التاريخ: ${formatDateForArabic(card.lastOperation.occurredAt)}`,
    `المتبقي داخل البطاقة: ${formatAssistantMoney(card.remainingAmount, 'USD')}`,
  ].join('\n');
}

export function formatSystemAccountAnswer(view: AssistantSystemAccountView) {
  const hasDebt = view.walletDebtByCurrency.some((item) => amountIsNonZero(item.amount));
  const hasCredit = view.walletCreditByCurrency.some((item) => amountIsNonZero(item.amount));
  const lines = [
    '**ملخص لنا وعلينا**',
    '',
    labelledAmount('لنا', formatAmountLines(view.walletDebtByCurrency, 'لا يوجد')),
    labelledAmount('علينا', formatAmountLines(view.walletCreditByCurrency, 'لا يوجد')),
  ];

  if (!hasDebt && !hasCredit) lines.push('لا توجد مبالغ لنا أو علينا حاليًا.');
  if (view.latestActivity) lines.push(`آخر تحديث: ${view.latestActivity.label} - ${formatDateForArabic(view.latestActivity.occurredAt)}`);
  return lines.join('\n');
}

export function formatAuditLogsAnswer(
  logs: Array<{ description?: string | null; action?: string | null; username?: string | null; createdAt: Date | string }>,
) {
  if (!logs.length) return 'لا توجد حركة مسجلة بهذا النوع.';

  return [
    '**آخر السجلات**',
    '',
    ...logs.slice(0, 8).map((log) => {
      const label = log.description || log.action || 'حركة مسجلة';
      const user = log.username ? ` - بواسطة ${log.username}` : '';
      return `- ${label}${user} - ${formatDateForArabic(log.createdAt)}`;
    }),
  ].join('\n');
}

export function formatDuplicateCustomers(matches: AssistantCustomerMatch[]) {
  return [
    'وجدت أكثر من زبون بهذا الاسم. حدد الكود المطلوب:',
    ...matches.map((person) => `${person.code || 'بدون كود'} - ${person.name}`),
  ].join('\n');
}

export function isRawAssistantData(message: string) {
  return rawDataPatterns.some((pattern) => pattern.test(message));
}

export function enforceArabicAssistantMessage(message: string, fallback = 'لم أستطع تجهيز إجابة عربية واضحة. أعد صياغة السؤال باختصار.') {
  const cleaned = String(message || '').trim();
  if (!cleaned || isRawAssistantData(cleaned)) return fallback;
  return cleaned;
}

function normalizeQuery(command: string) {
  return toEnglishDigits(command)
    .replace(/[؟?.,،:؛!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCustomerCode(text: string) {
  const match = text.match(/#\s*([AM]\d{3,}|[A-Z]?\d{3,})/i);
  if (!match) return undefined;
  const code = `#${match[1].replace(/\s+/g, '').toUpperCase()}`;
  return code.startsWith('#C') ? undefined : code;
}

function extractCardPublicCode(text: string) {
  const match = text.match(/#\s*(C\d{3,})/i);
  return match ? `#${match[1].toUpperCase()}` : undefined;
}

function extractCardLast4(text: string) {
  const publicCode = extractCardPublicCode(text);
  if (publicCode) return undefined;
  const cardMatch = text.match(/(?:بطاقة|البطاقة|كرت|الكرت)\s*(?:رقم)?\s*#?\s*(\d{4})\b/);
  if (cardMatch) return cardMatch[1];
  const generic = text.match(/\b(\d{4})\b/);
  return generic ? generic[1] : undefined;
}

function extractCurrencyCode(text: string) {
  const found = new Set<string>();
  if (/\bUSD\b|دولار|\$/i.test(text)) found.add('USD');
  if (/\bLYD\b|دينار|د\.ل/i.test(text)) found.add('LYD');
  if (/\bUSDT\b|تيثر/i.test(text)) found.add('USDT');
  if (/\bCNY\b|يوان|¥/i.test(text)) found.add('CNY');
  return found.size === 1 ? Array.from(found)[0] : undefined;
}

function cleanupName(value: string) {
  const noiseWords = [
    'للزبون',
    'لزبون',
    'الزبون',
    'زبون',
    'العميل',
    'عميل',
    'البطاقة',
    'بطاقة',
    'الكرت',
    'كرت',
    'رقم',
    'كم',
    'قداش',
    'ما',
    'شن',
    'اعرض',
    'عرض',
    'حساب',
    'دين',
    'ديون',
    'بطاقات',
    'استلم',
    'استلام',
    'المسلّم',
    'المسلم',
    'المتبقي',
    'المالي',
    'داخل',
    'آخر',
    'اخر',
    'عملية',
    'حركة',
    'على',
    'عن',
    'حق',
    'لنا',
    'علينا',
    'التي',
    'او',
    'أو',
  ];

  let result = value
    .replace(/#\s*[A-Z]?\d+/gi, ' ')
    .replace(/\b\d{4}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const word of noiseWords) {
    result = result.replace(new RegExp(`(^|\\s)${word}(?=\\s|$)`, 'g'), ' ');
  }

  return result.replace(/\s+/g, ' ').trim();
}

function extractNameAfter(text: string, phrases: string[]) {
  for (const phrase of phrases) {
    const index = text.indexOf(phrase);
    if (index >= 0) {
      const name = cleanupName(text.slice(index + phrase.length));
      if (name) return name;
    }
  }
  const fallback = cleanupName(text);
  return fallback || undefined;
}

function hasWriteVerb(text: string) {
  return /(^|\s)(أضف|اضف|سجل|سجّل|سدد|سدّد|احذف|حذف|عدل|عدّل|نفذ|نفّذ|صفي|صفّي|ارفض|رفض)(?=\s|$)/.test(text);
}

function makeQueryIntent(
  command: string,
  mode: AssistantReadQueryMode,
  phrases: string[],
): QueryCustomerIntent {
  const text = normalizeQuery(command);
  return {
    type: 'QUERY_CUSTOMER',
    customerCode: extractCustomerCode(text),
    customerName: extractNameAfter(text, phrases),
    includeCards: mode !== 'DEBT_SUMMARY',
    includeWallet: mode !== 'CARDS_DETAILS' && mode !== 'CARDS_SUMMARY',
    queryMode: mode,
    cardPublicCode: extractCardPublicCode(text),
    cardLast4: extractCardLast4(text),
    currencyCode: extractCurrencyCode(text) as QueryCustomerIntent['currencyCode'],
  };
}

export function tryBuildDeterministicReadIntent(command: string): QueryCustomerIntent | null {
  const text = normalizeQuery(command);
  if (!text || hasWriteVerb(text)) return null;

  if (/(آخر|اخر).*(عملية|حركة).*(بطاقة|البطاقة|كرت|الكرت)/.test(text)) {
    return makeQueryIntent(command, 'CARD_LAST_OPERATION', ['البطاقة', 'بطاقة', 'الكرت', 'كرت']);
  }

  if (/المتبقي.*داخل.*(بطاقة|البطاقة|كرت|الكرت)/.test(text)) {
    return makeQueryIntent(command, 'CARD_REMAINING', ['البطاقة', 'بطاقة', 'الكرت', 'كرت']);
  }

  if (/(كم|قداش|ما|شن).*(دين|ديون)|(^|\s)(دين|ديون)(?=\s|$)/.test(text)) {
    return makeQueryIntent(command, 'DEBT_SUMMARY', ['دين', 'ديون']);
  }

  if (/(استلم|استلام|المسلّم|المسلم)/.test(text)) {
    return makeQueryIntent(command, 'DELIVERIES_SUMMARY', ['استلم', 'استلام', 'المسلّم', 'المسلم']);
  }

  if (/المتبقي.*المالي|المتبقي.*للزبون|المتبقي.*لزبون/.test(text)) {
    return makeQueryIntent(command, 'FINANCIAL_REMAINING', ['المتبقي المالي', 'المتبقي']);
  }

  if (/(بطاقات|البطاقات)/.test(text)) {
    const details = /(تفاصيل|بالتفصيل|منفصلة|كل بطاقة|كل البطاقات)/.test(text);
    return makeQueryIntent(command, details ? 'CARDS_DETAILS' : 'CARDS_SUMMARY', ['بطاقات', 'البطاقات']);
  }

  if (/(لنا|علينا).*(مبالغ|المبالغ|حساب|رصيد)|(?:مبالغ|المبالغ).*(لنا|علينا)/.test(text)) {
    return makeQueryIntent(command, 'ACCOUNT_SUMMARY', ['حساب', 'المبالغ', 'مبالغ']);
  }

  if (/(اعرض|عرض|ما).*(حساب|رصيد)/.test(text)) {
    return makeQueryIntent(command, 'ACCOUNT_SUMMARY', ['حساب', 'رصيد']);
  }

  return null;
}
