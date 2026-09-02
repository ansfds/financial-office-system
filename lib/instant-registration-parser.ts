import { createHash } from 'crypto';
import { toEnglishDigits } from './format';

export type InstantCurrencyCode = 'USD' | 'LYD';

export type InstantAmount = {
  value: number;
  currencyCode: InstantCurrencyCode;
  raw: string;
};

export type InstantCardDraft = {
  cardLast4?: string;
  bankName?: string;
  valueAmount?: InstantAmount;
  agreedAmount?: InstantAmount;
  receivedAmount?: InstantAmount;
  remainingAmount?: InstantAmount;
  status?: 'ACTIVE' | 'SETTLED' | 'STOPPED' | 'REJECTED';
  reason?: string;
  notes?: string;
  ambiguousAmounts?: number[];
};

type ParsedBase = {
  kind:
    | 'CARD_ENTRY'
    | 'CUSTOMER_DELIVERY'
    | 'CARD_WITHDRAWAL'
    | 'CARD_FINAL_SETTLEMENT'
    | 'CARD_STATUS'
    | 'WALLET_MOVEMENT'
    | 'WALLET_REPAYMENT'
    | 'UNKNOWN';
  originalText: string;
  normalizedText: string;
  fingerprint: string;
  confidence: number;
  warnings: string[];
};

export type ParsedCardEntry = ParsedBase & {
  kind: 'CARD_ENTRY';
  personName?: string;
  customerCode?: string;
  phone?: string;
  bankName?: string;
  cards: InstantCardDraft[];
  deliveryAmount?: InstantAmount;
  notes?: string;
};

export type ParsedCustomerDelivery = ParsedBase & {
  kind: 'CUSTOMER_DELIVERY';
  personName?: string;
  cardLast4?: string;
  amount?: InstantAmount;
};

export type ParsedCardWithdrawal = ParsedBase & {
  kind: 'CARD_WITHDRAWAL';
  cardLast4?: string;
  amount?: InstantAmount;
  quantity: number;
  totalAmount?: InstantAmount;
};

export type ParsedCardFinalSettlement = ParsedBase & {
  kind: 'CARD_FINAL_SETTLEMENT';
  cardLast4?: string;
};

export type ParsedCardStatus = ParsedBase & {
  kind: 'CARD_STATUS';
  cardLast4?: string;
  status: 'STOPPED' | 'REJECTED';
  reason?: string;
};

export type ParsedWalletMovement = ParsedBase & {
  kind: 'WALLET_MOVEMENT';
  personName?: string;
  side: 'US' | 'THEM';
  amount?: InstantAmount;
};

export type ParsedWalletRepayment = ParsedBase & {
  kind: 'WALLET_REPAYMENT';
  personName?: string;
  amount?: InstantAmount;
};

export type ParsedUnknown = ParsedBase & {
  kind: 'UNKNOWN';
};

export type ParsedInstantMessage =
  | ParsedCardEntry
  | ParsedCustomerDelivery
  | ParsedCardWithdrawal
  | ParsedCardFinalSettlement
  | ParsedCardStatus
  | ParsedWalletMovement
  | ParsedWalletRepayment
  | ParsedUnknown;

const numberSource = String.raw`\d+(?:[\s,،٬]\d{3})*(?:[.]\d+)?|\d+(?:[.,]\d+)?`;
const currencySource = String.raw`\$|USD|usd|دولار|دولارات|د\.?\s*ل|LYD|lyd|دينار|دنانير`;
const amountPattern = new RegExp(String.raw`(${numberSource})\s*(${currencySource})?`, 'gi');

function buildBase<K extends ParsedBase['kind']>(
  kind: K,
  originalText: string,
  normalizedText: string,
): ParsedBase & { kind: K } {
  return {
    kind,
    originalText,
    normalizedText,
    fingerprint: messageFingerprint(normalizedText),
    confidence: 0.4,
    warnings: [],
  };
}

export function normalizeInstantText(value: string) {
  return toEnglishDigits(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ـ]/g, '')
    .replace(/[–—]/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[：]/g, ':')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function messageFingerprint(value: string) {
  const normalized = normalizeInstantText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}#.$]+/gu, ' ')
    .trim();

  return createHash('sha256').update(normalized).digest('hex').slice(0, 20);
}

function cleanLine(line: string) {
  return line
    .replace(/^[^\p{L}\p{N}#+]+/u, '')
    .replace(/[📌📞🏦➕💳💰🤝✅✏️⚠️]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function messageLines(text: string) {
  return text
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean);
}

function parseNumeric(value: string) {
  const clean = toEnglishDigits(value)
    .replace(/[،٬]/g, ',')
    .replace(/\s+/g, '')
    .trim();
  const withoutThousands =
    clean.includes(',') && /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(clean) ? clean.replace(/,/g, '') : clean.replace(',', '.');
  const parsed = Number(withoutThousands);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currencyFromText(value: string | undefined, fallback: InstantCurrencyCode = 'USD'): InstantCurrencyCode {
  const normalized = value || '';
  if (/LYD|lyd|د\.?\s*ل|دينار|دنانير/.test(normalized)) return 'LYD';
  if (/\$|USD|usd|دولار|دولارات/.test(normalized)) return 'USD';
  return fallback;
}

function makeAmount(rawNumber: string, rawCurrency?: string, fallbackCurrency?: InstantCurrencyCode): InstantAmount {
  return {
    value: parseNumeric(rawNumber),
    currencyCode: currencyFromText(rawCurrency, fallbackCurrency),
    raw: `${rawNumber}${rawCurrency ? ` ${rawCurrency}` : ''}`.trim(),
  };
}

function amountsIn(value: string, fallbackCurrency?: InstantCurrencyCode) {
  const matches: InstantAmount[] = [];
  amountPattern.lastIndex = 0;

  for (const match of value.matchAll(amountPattern)) {
    const rawNumber = match[1];
    if (!rawNumber) continue;
    matches.push(makeAmount(rawNumber, match[2], fallbackCurrency));
  }

  return matches;
}

function lastAmount(value: string, fallbackCurrency?: InstantCurrencyCode) {
  const amounts = amountsIn(value, fallbackCurrency);
  return amounts[amounts.length - 1];
}

function extractLabeledAmount(text: string, labels: string[], fallbackCurrency?: InstantCurrencyCode) {
  const labelSource = labels.map((label) => label.replace(/\s+/g, String.raw`\s+`)).join('|');
  const after = new RegExp(String.raw`(?:${labelSource})\s*(?:عليه|له)?\s*[:=]?\s*(${numberSource})\s*(${currencySource})?`, 'i');
  const before = new RegExp(String.raw`(${numberSource})\s*(${currencySource})?\s*(?:${labelSource})`, 'i');
  const afterMatch = text.match(after);
  if (afterMatch?.[1]) return makeAmount(afterMatch[1], afterMatch[2], fallbackCurrency);
  const beforeMatch = text.match(before);
  if (beforeMatch?.[1]) return makeAmount(beforeMatch[1], beforeMatch[2], fallbackCurrency);
  return undefined;
}

function extractPhone(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/(?:\+?218|0)?9\d{8}/);
    if (match) return match[0];
  }
  return undefined;
}

function extractCustomerCode(text: string) {
  const match = text.match(/#\s*[A-Za-z]?\d{1,8}/);
  return match?.[0]?.replace(/\s+/g, '').toUpperCase();
}

function extractLast4(text: string) {
  const explicit = text.match(/(?:آخر\s*4|اخر\s*4|آخر\s*اربع|اخر\s*اربع|بطاقة|كرت)\s*(?:أرقام|ارقام)?\s*[:#-]?\s*(\d{4})/i);
  if (explicit?.[1]) return explicit[1];

  const standalone = text.match(/(?:^|[^\d])(\d{4})(?:[^\d]|$)/);
  return standalone?.[1];
}

function removeAmounts(text: string) {
  amountPattern.lastIndex = 0;
  return text.replace(amountPattern, ' ');
}

function normalizeName(value: string) {
  return value
    .replace(/#\s*[A-Za-z]?\d{1,8}/g, ' ')
    .replace(/\b(?:\+?218|0)?9\d{8}\b/g, ' ')
    .replace(/[:|،,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPhoneLine(line: string) {
  return /^(?:\+?218|0)?9\d{8}$/.test(line.trim());
}

function looksLikeCardTypeLine(line: string) {
  return (
    /بطاقة|مصرف|جمهورية|وحدة|تجاري|صحارى|شمال|يقين|أمان|امان/.test(line) &&
    !/\d{4}/.test(line) &&
    !/(جديدة|بطاقتان|بطاقات|القيمة|المتفق|سحب|تصفية|صافي|مصف|متوقفة|مرفوضة)/.test(line)
  );
}

function extractPersonName(lines: string[], text: string) {
  const code = extractCustomerCode(text);

  for (const line of lines) {
    if (isPhoneLine(line)) continue;
    if (line === code) continue;
    if (/^(?:بطاقة|بطاقتان|بطاقات|النوع|آخر|اخر|القيمة|قيمة|المتفق|الصافي|صافي|استلم|تم|لم|لنا|علينا|سحب|سحبة|تسديد|سداد|دفع|مصف|متوقف|مرفوض)/.test(line)) continue;
    if (looksLikeCardTypeLine(line)) continue;
    if (/\d{4}/.test(line) && /بطاقة|كرت|سحب|القيمة|المتفق/.test(line)) continue;
    const candidate = normalizeName(removeAmounts(line));
    if (candidate.length >= 2) return candidate;
  }

  return undefined;
}

function extractBankName(lines: string[]) {
  const typeLine = lines.find((line) => /(?:^|\s)(?:النوع|نوع)\s*:/.test(line));
  if (typeLine) {
    const value = typeLine.replace(/.*(?:النوع|نوع)\s*:\s*/, '').trim();
    if (value) return value;
  }

  const cardType = lines.find(looksLikeCardTypeLine);
  return cardType?.replace(/^النوع\s*:?\s*/, '').trim();
}

function hasNegatedDelivery(text: string) {
  return /(?:لم\s+(?:أ?ستلم|يستلم|يستلموا|نسجل|أسجل|اسجل)|لم\s+يتم\s+استلام|لم\s+يسلم|لم\s+أسجل|لم\s+اسجل|لا\s+يوجد\s+(?:استلام|مستلم)|شيء|شئ)/.test(
    text,
  );
}

function extractDeliveryAmount(text: string, fallbackCurrency?: InstantCurrencyCode) {
  if (hasNegatedDelivery(text)) return makeAmount('0', undefined, fallbackCurrency);
  return extractLabeledAmount(
    text,
    ['المستلم', 'مستلم', 'استلم', 'استلام', 'تسليمه', 'سلم', 'تم تسليمه', 'تم التسليم'],
    fallbackCurrency,
  );
}

function extractRemainingAmount(text: string, fallbackCurrency?: InstantCurrencyCode) {
  return extractLabeledAmount(text, ['المتبقي', 'متبقي', 'الباقي', 'باقي له', 'باقي'], fallbackCurrency);
}

function lineLooksLikeCardRow(line: string) {
  if (!extractLast4(line) || isPhoneLine(line)) return false;
  return /(?:قيمة|القيمة|الكرت|المتفق|الصافي|صافي|\$|USD|usd|دولار|LYD|lyd|دينار|د\.?\s*ل)/.test(line) || /^\d{4}$/.test(line);
}

function parseCardRow(line: string, fallbackCurrency?: InstantCurrencyCode): InstantCardDraft {
  const cardLast4 = extractLast4(line);
  const valueAmount = extractLabeledAmount(line, ['قيمة البطاقة', 'القيمة', 'قيمة', 'الكرت'], fallbackCurrency);
  const agreedAmount = extractLabeledAmount(line, ['المتفق عليه', 'المتفق', 'صافي المتفق', 'الصافي', 'صافي'], fallbackCurrency);
  const receivedAmount = extractDeliveryAmount(line, agreedAmount?.currencyCode || fallbackCurrency);
  const remainingAmount = extractRemainingAmount(line, agreedAmount?.currencyCode || fallbackCurrency);
  const allAmounts = amountsIn(line, fallbackCurrency).filter((amount) => amount.raw !== cardLast4);
  let inferredValue = valueAmount;
  const ambiguousAmounts: number[] = [];

  if (!inferredValue && agreedAmount && allAmounts.length >= 2) {
    inferredValue = allAmounts.find((amount) => amount.value !== agreedAmount.value);
  } else if (!inferredValue && !agreedAmount && allAmounts.length === 1) {
    ambiguousAmounts.push(allAmounts[0].value);
  }

  return {
    cardLast4,
    valueAmount: inferredValue,
    agreedAmount,
    receivedAmount,
    remainingAmount,
    ambiguousAmounts,
  };
}

function hasCardEntrySignal(text: string) {
  return /بطاقة\s+جديدة|بطاقتان|بطاقات|آخر\s*4|اخر\s*4|قيمة\s*البطاقة|القيمة|المتفق|الصافي|صافي\s*المتفق/.test(text);
}

function inferDefaultCurrency(text: string): InstantCurrencyCode {
  return currencyFromText(text, 'USD');
}

function parseCardEntry(originalText: string, normalizedText: string): ParsedCardEntry {
  const lines = messageLines(normalizedText);
  const base = buildBase('CARD_ENTRY', originalText, normalizedText);
  const fallbackCurrency = inferDefaultCurrency(normalizedText);
  const bankName = extractBankName(lines);
  const globalValue = extractLabeledAmount(normalizedText, ['قيمة البطاقة', 'القيمة', 'قيمة', 'الكرت'], fallbackCurrency);
  const globalAgreed = extractLabeledAmount(
    normalizedText,
    ['المتفق عليه', 'المتفق', 'صافي المتفق', 'الصافي', 'صافي'],
    globalValue?.currencyCode || fallbackCurrency,
  );
  const globalReceived = extractDeliveryAmount(normalizedText, globalAgreed?.currencyCode || fallbackCurrency);
  const globalRemaining = extractRemainingAmount(normalizedText, globalAgreed?.currencyCode || fallbackCurrency);
  const rowLines = lines.filter(lineLooksLikeCardRow);
  const cards = rowLines.length
    ? rowLines.map((line) => parseCardRow(line, globalAgreed?.currencyCode || fallbackCurrency))
    : [
        {
          cardLast4: extractLast4(normalizedText),
          valueAmount: globalValue,
          agreedAmount: globalAgreed,
          receivedAmount: globalReceived,
          remainingAmount: globalRemaining,
        },
      ];

  for (const card of cards) {
    card.bankName ||= bankName;
    card.valueAmount ||= globalValue;
    card.agreedAmount ||= globalAgreed;
    card.receivedAmount ||= globalReceived;
    card.remainingAmount ||= globalRemaining;

    if (!card.receivedAmount && card.agreedAmount && card.remainingAmount && card.agreedAmount.value >= card.remainingAmount.value) {
      card.receivedAmount = {
        value: card.agreedAmount.value - card.remainingAmount.value,
        currencyCode: card.agreedAmount.currencyCode,
        raw: String(card.agreedAmount.value - card.remainingAmount.value),
      };
    }

    if (!card.cardLast4) base.warnings.push('لم يتم تحديد آخر 4 أرقام لإحدى البطاقات.');
    if (!card.agreedAmount) base.warnings.push('لم يتم تحديد المبلغ المتفق عليه لإحدى البطاقات.');
    if (card.ambiguousAmounts?.length) base.warnings.push('لم أستطع تحديد هل الرقم غير المسمى هو قيمة البطاقة أم المتفق.');
  }

  const currencies = new Set(
    cards.flatMap((card) => [card.valueAmount?.currencyCode, card.agreedAmount?.currencyCode, card.receivedAmount?.currencyCode]).filter(Boolean),
  );
  if (currencies.has('USD') && currencies.has('LYD')) {
    base.warnings.push('توجد أكثر من عملة في الرسالة. سيتم حفظ كل مبلغ بعملته ولن يتم جمع USD مع LYD.');
  }

  const personName = extractPersonName(lines, normalizedText);
  if (!personName) base.warnings.push('لم يتم تحديد اسم الزبون.');

  const confidence = cards.length && personName ? 0.82 : 0.58;

  return {
    ...base,
    confidence,
    personName,
    customerCode: extractCustomerCode(normalizedText),
    phone: extractPhone(lines),
    bankName,
    cards,
    deliveryAmount: globalReceived?.value ? globalReceived : undefined,
  };
}

function parseCardWithdrawal(originalText: string, normalizedText: string): ParsedCardWithdrawal {
  const base = buildBase('CARD_WITHDRAWAL', originalText, normalizedText);
  const fallbackCurrency = inferDefaultCurrency(normalizedText);
  const quantityMatch = normalizedText.match(/(?:تنفيذ\s*)?(\d+)\s*(?:سحبات|سحبة|مرات)/);
  const quantity = Math.max(1, Number(quantityMatch?.[1] || 1));
  const amount =
    normalizedText.match(/(?:سحبات|سحبة|سحب)\s*(?:بمبلغ|قيمة)?\s*[:=]?\s*(\d[\d\s,،٬.]*)\s*([^\s\d]+)?/i)
      ? makeAmount(
          normalizedText.match(/(?:سحبات|سحبة|سحب)\s*(?:بمبلغ|قيمة)?\s*[:=]?\s*(\d[\d\s,،٬.]*)\s*([^\s\d]+)?/i)?.[1] || '0',
          normalizedText.match(/(?:سحبات|سحبة|سحب)\s*(?:بمبلغ|قيمة)?\s*[:=]?\s*(\d[\d\s,،٬.]*)\s*([^\s\d]+)?/i)?.[2],
          fallbackCurrency,
        )
      : lastAmount(normalizedText, fallbackCurrency);
  const cardLast4 = extractLast4(normalizedText);

  if (!cardLast4) base.warnings.push('لم يتم تحديد البطاقة.');
  if (!amount || amount.value <= 0) base.warnings.push('لم يتم تحديد مبلغ السحبة.');

  return {
    ...base,
    confidence: cardLast4 && amount ? 0.9 : 0.55,
    cardLast4,
    amount,
    quantity,
    totalAmount: amount
      ? {
          ...amount,
          value: amount.value * quantity,
          raw: `${quantity} x ${amount.raw}`,
        }
      : undefined,
  };
}

function parseCardFinalSettlement(originalText: string, normalizedText: string): ParsedCardFinalSettlement {
  const base = buildBase('CARD_FINAL_SETTLEMENT', originalText, normalizedText);
  const cardLast4 = extractLast4(normalizedText);
  if (!cardLast4) base.warnings.push('لم يتم تحديد البطاقة المراد تصفيتها.');
  return { ...base, confidence: cardLast4 ? 0.9 : 0.55, cardLast4 };
}

function parseCardStatus(originalText: string, normalizedText: string): ParsedCardStatus {
  const base = buildBase('CARD_STATUS', originalText, normalizedText);
  const cardLast4 = extractLast4(normalizedText);
  const status = /مرفوض|رفض|ملغ/.test(normalizedText) ? 'REJECTED' : 'STOPPED';
  const reason =
    normalizedText.match(/(?:بسبب|السبب)\s*[:=]?\s*(.+)$/)?.[1]?.trim() ||
    normalizedText.match(/\d{4}\s*(?:متوقفة|مرفوضة|مرفوض|متوقف)\s+(.+)$/)?.[1]?.trim();

  if (!cardLast4) base.warnings.push('لم يتم تحديد البطاقة.');
  if (!reason) base.warnings.push('لم يتم تحديد سبب الإيقاف أو الرفض.');

  return { ...base, confidence: cardLast4 ? 0.86 : 0.55, cardLast4, status, reason };
}

function parseWalletMovement(originalText: string, normalizedText: string): ParsedWalletMovement {
  const side = normalizedText.startsWith('علينا') ? 'THEM' : 'US';
  const base = buildBase('WALLET_MOVEMENT', originalText, normalizedText);
  const amount = lastAmount(normalizedText, inferDefaultCurrency(normalizedText));
  const namePattern =
    side === 'THEM'
      ? normalizedText.match(/^علينا\s+(?:ل|على)?\s*(.+?)\s+\d/)
      : normalizedText.match(/^لنا\s+(?:على|عليه|ل)?\s*(.+?)\s+\d/);
  const personName = normalizeName(removeAmounts(namePattern?.[1] || ''));

  if (!personName) base.warnings.push('لم يتم تحديد اسم صاحب الدين.');
  if (!amount || amount.value <= 0) base.warnings.push('لم يتم تحديد مبلغ الدين.');

  return {
    ...base,
    confidence: personName && amount ? 0.9 : 0.55,
    side,
    personName: personName || undefined,
    amount,
  };
}

function parseWalletRepayment(originalText: string, normalizedText: string): ParsedWalletRepayment {
  const base = buildBase('WALLET_REPAYMENT', originalText, normalizedText);
  const amount = lastAmount(normalizedText, inferDefaultCurrency(normalizedText));
  let personName = '';

  const amountThenName = normalizedText.match(/(?:تسديد|سداد|تسدد|سداده)\s*(?:دين)?\s*\d[\d\s,،٬.]*\s*(?:\$|USD|usd|دولار|LYD|lyd|د\.?\s*ل|دينار)?\s*(?:ل|من)?\s*(.+)$/);
  const nameThenAmount = normalizedText.match(/^(.+?)\s+(?:دفع|سدد|سدّد|سداد|تسديد)\s+\d/);
  const debtNameBeforeAmount = normalizedText.match(/(?:دين)\s+(.+?)\s+\d/);
  personName = normalizeName(removeAmounts(amountThenName?.[1] || nameThenAmount?.[1] || debtNameBeforeAmount?.[1] || ''));
  personName = personName.replace(/\b(?:من|الدين|دين|تم)\b/g, ' ').replace(/\s+/g, ' ').trim();

  if (!personName) base.warnings.push('لم يتم تحديد صاحب الدين.');
  if (!amount || amount.value <= 0) base.warnings.push('لم يتم تحديد مبلغ السداد.');

  return {
    ...base,
    confidence: personName && amount ? 0.86 : 0.55,
    personName: personName || undefined,
    amount,
  };
}

function parseCustomerDelivery(originalText: string, normalizedText: string): ParsedCustomerDelivery {
  const base = buildBase('CUSTOMER_DELIVERY', originalText, normalizedText);
  const amount = extractDeliveryAmount(normalizedText, inferDefaultCurrency(normalizedText));
  const keyword = normalizedText.match(/(?:استلم|استلام|تسليمه|تم تسليمه|سلم|تم التسليم)/);
  const beforeKeyword = keyword ? normalizedText.slice(0, keyword.index).trim() : normalizedText;
  const personName = normalizeName(removeAmounts(beforeKeyword.replace(/بطاقة\s*\d{4}/, '')));
  const cardLast4 = extractLast4(normalizedText);

  if (!personName && !cardLast4) base.warnings.push('لم يتم تحديد الزبون أو البطاقة.');
  if (!amount || amount.value <= 0) base.warnings.push('لم يتم تحديد المبلغ المستلم.');

  return {
    ...base,
    confidence: amount && (personName || cardLast4) ? 0.82 : 0.5,
    personName: personName || undefined,
    cardLast4,
    amount,
  };
}

export function parseInstantMessage(rawText: string): ParsedInstantMessage {
  const normalizedText = normalizeInstantText(rawText);
  const base = buildBase('UNKNOWN', rawText, normalizedText);

  if (!normalizedText) {
    return { ...base, warnings: ['اكتب رسالة التسجيل أولًا.'], confidence: 0.1 };
  }

  if (/^(?:علينا|لنا)(?:\s|$)/.test(normalizedText)) return parseWalletMovement(rawText, normalizedText);
  if (/(?:تسديد|سداد|سداده|سدد|سدّد)|(?:دفع).*(?:دين|الدين)|(?:دين).*(?:تسديد|سداد|دفع)/.test(normalizedText)) {
    return parseWalletRepayment(rawText, normalizedText);
  }
  if (/(?:صافي\s+بالكامل|مصفى|مصفاة|تصفيتها|تصفية|تمت\s+تصفيتها)/.test(normalizedText)) {
    return parseCardFinalSettlement(rawText, normalizedText);
  }
  if (/(?:متوقفة|متوقف|مرفوضة|مرفوض|رفض)/.test(normalizedText) && extractLast4(normalizedText)) {
    return parseCardStatus(rawText, normalizedText);
  }
  if (/(?:سحب|سحبة|سحبات)/.test(normalizedText) && extractLast4(normalizedText)) {
    return parseCardWithdrawal(rawText, normalizedText);
  }
  if (hasCardEntrySignal(normalizedText)) return parseCardEntry(rawText, normalizedText);
  if (/(?:استلم|استلام|تسليمه|تم تسليمه|سلم|تم التسليم)/.test(normalizedText) && !hasNegatedDelivery(normalizedText)) {
    return parseCustomerDelivery(rawText, normalizedText);
  }

  return {
    ...base,
    warnings: ['لم أستطع فهم نوع العملية من الرسالة.'],
    confidence: 0.2,
  };
}
