import { createHash } from 'crypto';
import { toEnglishDigits } from './format';

export type InstantCurrencyCode = 'USD' | 'LYD';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export type InstantAmount = {
  value: number;
  currencyCode: InstantCurrencyCode;
  raw: string;
  inferred?: boolean;
  confidence?: ConfidenceLevel;
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
  sourceLine?: string;
  fieldConfidence?: Partial<
    Record<'cardLast4' | 'valueAmount' | 'agreedAmount' | 'receivedAmount' | 'remainingAmount' | 'status', ConfidenceLevel>
  >;
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
  fieldConfidence?: Record<string, ConfidenceLevel>;
};

type InstantIntent = ParsedBase['kind'];

export type ParsedCardEntry = ParsedBase & {
  kind: 'CARD_ENTRY';
  personName?: string;
  customerCode?: string;
  phone?: string;
  bankName?: string;
  cards: InstantCardDraft[];
  expectedCardCount?: number;
  deliveryAmount?: InstantAmount;
  totalAgreedAmount?: InstantAmount;
  totalReceivedAmount?: InstantAmount;
  totalRemainingAmount?: InstantAmount;
  totalsVerified?: boolean;
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
  personName?: string;
  cardLast4?: string;
  amount?: InstantAmount;
  quantity: number;
  totalAmount?: InstantAmount;
};

export type ParsedCardFinalSettlement = ParsedBase & {
  kind: 'CARD_FINAL_SETTLEMENT';
  personName?: string;
  cardLast4?: string;
};

export type ParsedCardStatus = ParsedBase & {
  kind: 'CARD_STATUS';
  personName?: string;
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

type TextRange = {
  start: number;
  end: number;
};

type AmountMatch = InstantAmount & {
  index: number;
  end: number;
  numberRaw: string;
};

type CardBoundary = {
  last4: string;
  index: number;
  end: number;
  confidence: ConfidenceLevel;
  source: 'explicit' | 'leading' | 'context';
};

type CardSegment = CardBoundary & {
  text: string;
};

const numberSource = String.raw`\d{1,3}(?:[\s,،٬]\d{3})+(?:[.]\d+)?|\d+(?:[.,]\d+)?`;
const currencySource = String.raw`\$|USD|usd|دولار|دولارات|د\.?\s*ل|LYD|lyd|دينار|دنانير`;
const amountTokenSource = String.raw`(?:(${currencySource})\s*)?(${numberSource})\s*(${currencySource})?`;
const amountPattern = new RegExp(amountTokenSource, 'giu');

const cardValueLabels = [
  'قيمة البطاقة',
  'قيمة الكرت',
  'البطاقة بقيمة',
  'الكرت فيه',
  'القيمة',
  'قيمة',
  'فيها',
  'فيه',
];
const cardAgreedLabels = [
  'المتفق عليه',
  'صافي المتفق',
  'الحساب عليه',
  'متفق عليه',
  'المتفق',
  'الصافي',
  'متفق',
  'صافي',
];
const deliveryLabels = [
  'تم استلام',
  'تم تسليمه',
  'تم التسليم',
  'استلم منه',
  'المستلم',
  'استلام',
  'مستلم',
  'استلم',
  'سلمته',
  'سلمت',
  'سلم',
  'أخذ',
  'اخذ',
];
const remainingLabels = ['باقي عند المكتب', 'ما زال له', 'باقي له', 'المتبقي', 'متبقي', 'الباقي', 'باقي'];
const totalAgreedLabels = [
  'إجمالي المتفق',
  'اجمالي المتفق',
  'الإجمالي المتفق',
  'الاجمالي المتفق',
  'مجموع المتفق',
  'المجموع المتفق',
  'إجمالي الصافي',
  'اجمالي الصافي',
  'مجموع الصافي',
  'إجمالي',
  'اجمالي',
  'الإجمالي',
  'الاجمالي',
];
const totalReceivedLabels = [
  'إجمالي المستلم',
  'اجمالي المستلم',
  'الإجمالي المستلم',
  'الاجمالي المستلم',
  'مجموع المستلم',
  'المجموع المستلم',
  'المستلم',
  'مستلم',
];
const totalRemainingLabels = [
  'إجمالي المتبقي',
  'اجمالي المتبقي',
  'الإجمالي المتبقي',
  'الاجمالي المتبقي',
  'مجموع المتبقي',
  'المجموع المتبقي',
  'المتبقي',
  'متبقي',
  'الباقي',
  'باقي',
];
const allAmountLabels = [
  ...cardValueLabels,
  ...cardAgreedLabels,
  ...deliveryLabels,
  ...remainingLabels,
  ...totalAgreedLabels,
  ...totalReceivedLabels,
  ...totalRemainingLabels,
];

const leadingOperationSource = [
  String.raw`زبون\s+جديد`,
  String.raw`عميل\s+جديد`,
  String.raw`البطاقة\s+الجديدة`,
  String.raw`بطاقة\s+جديدة`,
  String.raw`الكرت\s+الجديد`,
  String.raw`كرت\s+جديد`,
  String.raw`أضف\s+بطاقة`,
  String.raw`اضف\s+بطاقة`,
  String.raw`لديه\s+\d+\s+(?:بطاقات|كروت|بطاقة|كرت)`,
  String.raw`عنده\s+\d+\s+(?:بطاقات|كروت|بطاقة|كرت)`,
  String.raw`بطاقتان`,
  String.raw`بطاقتين`,
  String.raw`بطاقات`,
  String.raw`كروت`,
  String.raw`آخر\s*4`,
  String.raw`اخر\s*4`,
  String.raw`البطاقة`,
  String.raw`بطاقة`,
  String.raw`الكرت`,
  String.raw`كرت`,
  String.raw`استلم`,
  String.raw`استلام`,
  String.raw`سحب`,
  String.raw`سحبة`,
  String.raw`سحبات`,
  String.raw`علينا`,
  String.raw`لنا`,
  String.raw`صافي`,
  String.raw`تصفية`,
  String.raw`مصفى`,
  String.raw`مصفاة`,
  String.raw`متوقفة`,
  String.raw`متوقف`,
  String.raw`مرفوضة`,
  String.raw`مرفوض`,
].join('|');

const cardDetailSignalPattern = /(?:فيها|قيمة|القيمة|المتفق|متفق|الصافي|صافي\s+\d|الحساب\s+عليه)/u;
const aggregateSignalPattern = /(?:إجمالي|اجمالي|الإجمالي|الاجمالي|مجموع|المجموع)/u;
const cardSectionPattern = /(?:^|\s)(?:البطاقات|بطاقات|بطاقتان|بطاقتين|الكروت|كروت)(?:\s|:|$)/u;
const failureReasonPattern = /(فشل\s+حمراء|فشلت\s+العملية|رصيد\s+غير\s+كاف|رفض\s+الموقع|لا\s+تعمل|مرفوضة?|متوقفة?|حمراء|فشل)/u;

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
    fieldConfidence: {},
  };
}

export function normalizeArabicInput(value: string) {
  return toEnglishDigits(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[ـ]/g, '')
    .replace(/[*_`~]+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ' ')
    .replace(/[–—−]/g, ' - ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[：]/g, ':')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeInstantText(value: string) {
  return normalizeArabicInput(value);
}

export function messageFingerprint(value: string) {
  const normalized = normalizeInstantText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}#.$]+/gu, ' ')
    .trim();

  return createHash('sha256').update(normalized).digest('hex').slice(0, 20);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelPatternSource(labels: string[]) {
  return labels
    .slice()
    .sort((left, right) => right.length - left.length)
    .map((label) => escapeRegex(label).replace(/\s+/g, String.raw`\s+`))
    .join('|');
}

function cleanLine(line: string) {
  return line
    .replace(/^[^\p{L}\p{N}#+]+/u, '')
    .replace(/[|]+/g, ' ')
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
  const compact = toEnglishDigits(value)
    .replace(/[،٬]/g, ',')
    .replace(/\s+/g, '')
    .trim();
  const withoutThousands =
    compact.includes(',') && /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(compact)
      ? compact.replace(/,/g, '')
      : compact.replace(',', '.');
  const parsed = Number(withoutThousands);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currencyFromText(value: string | undefined, fallback: InstantCurrencyCode = 'USD'): InstantCurrencyCode {
  const normalized = value || '';
  if (/LYD|lyd|د\.?\s*ل|دينار|دنانير/u.test(normalized)) return 'LYD';
  if (/\$|USD|usd|دولار|دولارات/u.test(normalized)) return 'USD';
  return fallback;
}

function makeAmount(
  rawNumber: string,
  rawCurrency?: string,
  fallbackCurrency: InstantCurrencyCode = 'USD',
  options: { inferred?: boolean; confidence?: ConfidenceLevel; raw?: string } = {},
): InstantAmount {
  return {
    value: parseNumeric(rawNumber),
    currencyCode: currencyFromText(rawCurrency, fallbackCurrency),
    raw: options.raw || `${rawNumber}${rawCurrency ? ` ${rawCurrency}` : ''}`.trim(),
    inferred: options.inferred,
    confidence: options.confidence,
  };
}

function makeDerivedAmount(value: number, currencyCode: InstantCurrencyCode, raw: string): InstantAmount {
  return {
    value,
    currencyCode,
    raw,
    inferred: true,
    confidence: 'MEDIUM',
  };
}

function collectRanges(text: string, pattern: RegExp) {
  const ranges: TextRange[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}

function protectedRanges(text: string) {
  return [
    ...collectRanges(text, /(?:\+?218|0)?9\d{8}/gu),
    ...collectRanges(text, /#\s*[A-Za-z]?\d{1,8}/gu),
  ];
}

function overlapsRange(start: number, end: number, ranges: TextRange[]) {
  return ranges.some((range) => start < range.end && end > range.start);
}

function amountFromCaptured(match: RegExpMatchArray, fallbackCurrency?: InstantCurrencyCode): InstantAmount | undefined {
  const currencyBefore = match[1];
  const rawNumber = match[2];
  const currencyAfter = match[3];
  if (!rawNumber) return undefined;
  return makeAmount(rawNumber, currencyBefore || currencyAfter, fallbackCurrency);
}

function amountsIn(value: string, fallbackCurrency?: InstantCurrencyCode, ignoreRanges: TextRange[] = protectedRanges(value)) {
  const matches: AmountMatch[] = [];

  for (const match of value.matchAll(amountPattern)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    if (overlapsRange(index, end, ignoreRanges)) continue;

    const rawNumber = match[2];
    if (!rawNumber) continue;
    matches.push({
      ...makeAmount(rawNumber, match[1] || match[3], fallbackCurrency),
      index,
      end,
      numberRaw: rawNumber,
    });
  }

  return matches;
}

function lastAmount(value: string, fallbackCurrency?: InstantCurrencyCode) {
  const amounts = amountsIn(value, fallbackCurrency);
  return amounts[amounts.length - 1];
}

function extractLabeledAmount(text: string, labels: string[], fallbackCurrency?: InstantCurrencyCode) {
  const labelSource = labelPatternSource(labels);
  const after = new RegExp(
    String.raw`(?:${labelSource})\s*(?:عليه|له|منه|عند\s+المكتب)?\s*[:=]?\s*(?:ب(?:مبلغ|قيمة)?\s*)?${amountTokenSource}`,
    'iu',
  );
  const before = new RegExp(String.raw`${amountTokenSource}\s*(?:${labelSource})`, 'iu');
  const afterMatch = text.match(after);
  if (afterMatch) return amountFromCaptured(afterMatch, fallbackCurrency);
  const beforeMatch = text.match(before);
  if (beforeMatch) return amountFromCaptured(beforeMatch, fallbackCurrency);
  return undefined;
}

function extractAfterLabeledAmount(text: string, labels: string[], fallbackCurrency?: InstantCurrencyCode) {
  const labelSource = labelPatternSource(labels);
  const after = new RegExp(
    String.raw`(?:${labelSource})\s*(?:عليه|له|منه|عند\s+المكتب)?\s*[:=]?\s*(?:ب(?:مبلغ|قيمة)?\s*)?${amountTokenSource}`,
    'iu',
  );
  const afterMatch = text.match(after);
  return afterMatch ? amountFromCaptured(afterMatch, fallbackCurrency) : undefined;
}

function extractLooseLabeledAmount(text: string, labels: string[], fallbackCurrency?: InstantCurrencyCode) {
  const labelSource = labelPatternSource(labels);
  const after = new RegExp(String.raw`(?:${labelSource})(?:\s*(?:عليه|له|منه))?[^\d\n]{0,70}${amountTokenSource}`, 'iu');
  const before = new RegExp(String.raw`${amountTokenSource}[^\p{L}\p{N}\n]{0,20}(?:${labelSource})`, 'iu');
  const afterMatch = text.match(after);
  if (afterMatch) return amountFromCaptured(afterMatch, fallbackCurrency);
  const beforeMatch = text.match(before);
  if (beforeMatch) return amountFromCaptured(beforeMatch, fallbackCurrency);
  return undefined;
}

export function extractPhone(input: string | string[]) {
  const text = Array.isArray(input) ? input.join('\n') : input;
  const match = text.match(/(?:\+?218|0)?9\d{8}/u);
  return match?.[0];
}

export function extractCustomerCode(text: string) {
  const match = text.match(/#\s*([A-Za-z]?\d{1,8})/u);
  return match?.[1]?.replace(/\s+/g, '').toUpperCase();
}

function explicitLast4Matches(text: string) {
  const boundaries: CardBoundary[] = [];
  const patterns = [
    /(?:آخر\s*4|اخر\s*4|آخر\s*اربع|اخر\s*اربع)\s*(?:أرقام|ارقام)?\s*[:#-]?\s*(\d{4})/giu,
    /(?:رقم\s*)?(?:البطاقة|بطاقة|الكرت|كرت)\s*(?:الجديدة|جديدة|جديد)?\s*[:#-]?\s*(\d{4})/giu,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const matchStart = match.index ?? 0;
      const digitOffset = match[0].lastIndexOf(match[1]);
      const index = matchStart + digitOffset;
      const before = text.slice(Math.max(0, matchStart - 25), matchStart);
      if (/(?:قيمة|القيمة|فيها|بقيمة)\s*$/u.test(before)) continue;
      boundaries.push({
        last4: match[1],
        index,
        end: index + 4,
        confidence: 'HIGH',
        source: 'explicit',
      });
    }
  }

  return boundaries;
}

function extractLeadingLast4(text: string) {
  const match = text.match(/^\s*(\d{4})(?=$|[^\d])/u);
  if (!match?.[1]) return undefined;
  const after = text.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 12);
  if (/^\s*(?:\$|USD|usd|دولار|LYD|lyd|د\.?\s*ل|دينار)/u.test(after)) return undefined;
  return match[1];
}

function lineBoundsAt(text: string, index: number) {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const nextNewline = text.indexOf('\n', index);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;
  return { lineStart, lineEnd };
}

function lineAt(text: string, index: number) {
  const bounds = lineBoundsAt(text, index);
  return text.slice(bounds.lineStart, bounds.lineEnd);
}

function nextMeaningfulText(text: string, index: number, length = 140) {
  return text.slice(index, Math.min(text.length, index + length));
}

function previousMeaningfulText(text: string, index: number, length = 90) {
  return text.slice(Math.max(0, index - length), index);
}

function hasAmountLabelImmediatelyBefore(text: string, index: number) {
  const before = previousMeaningfulText(text, index, 55);
  const labelSource = labelPatternSource(allAmountLabels);
  return new RegExp(String.raw`(?:${labelSource})(?:\s*(?:عليه|له|منه|عند\s+المكتب))?\s*[:=]?\s*$`, 'iu').test(before);
}

function hasCurrencyNeighbor(text: string, index: number, end: number) {
  const before = previousMeaningfulText(text, index, 8);
  const after = nextMeaningfulText(text, end, 15);
  return (
    /(?:\$|USD|usd|دولار|LYD|lyd|د\.?[ \t]*ل|دينار)[ \t]*$/u.test(before) ||
    /^[ \t]*(?:\$|USD|usd|دولار|LYD|lyd|د\.?[ \t]*ل|دينار)/u.test(after)
  );
}

function isAggregateLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  return (
    /^(?:إجمالي|اجمالي|الإجمالي|الاجمالي|مجموع|المجموع|المستلم|مستلم|المتبقي|متبقي|الباقي|باقي)(?:\s|:|$)/u.test(
      trimmed,
    ) ||
    /(?:إجمالي|اجمالي|الإجمالي|الاجمالي|مجموع|المجموع).*(?:المتفق|متفق|الصافي|بطاقات|البطاقات|كروت|الكروت|القيمة)/u.test(
      trimmed,
    )
  );
}

function hasCardRowAmountSignal(line: string) {
  return cardDetailSignalPattern.test(line);
}

function lineAfterHasCardDetails(text: string, lineEnd: number) {
  const rest = text
    .slice(lineEnd)
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
  return hasCardRowAmountSignal(rest) || hasNegatedDelivery(rest) || hasFullDelivery(rest);
}

function afterLooksLikeCardDetails(after: string) {
  if (
    new RegExp(
      String.raw`^\s*(?:[:#-]\s*)?(?:${labelPatternSource([...cardValueLabels, ...cardAgreedLabels, ...deliveryLabels, ...remainingLabels])})`,
      'iu',
    ).test(after)
  ) {
    return true;
  }
  if (/^\s*(?:-|:|\|)\s*/u.test(after) && amountsIn(after.slice(0, 80)).length >= 2) return true;
  if (/^\s*(?:صافي\s+بالكامل|مصفى|مصفاة|متوقفة|متوقف|مرفوضة|مرفوض|فشل|سحب|تم\s+سحب)/u.test(after)) return true;
  return false;
}

function isAtSegmentStart(text: string, index: number) {
  const bounds = lineBoundsAt(text, index);
  const prefix = text.slice(bounds.lineStart, index);
  const lastHardSeparator = Math.max(
    prefix.lastIndexOf('،'),
    prefix.lastIndexOf(','),
    prefix.lastIndexOf(';'),
    prefix.lastIndexOf('؛'),
    prefix.lastIndexOf('.'),
  );
  const sinceSeparator = prefix.slice(lastHardSeparator + 1).trim();
  return sinceSeparator === '' || /(?:بطاقات|كروت)\s*$/u.test(sinceSeparator);
}

function hasCardSectionBefore(text: string, index: number) {
  const before = previousMeaningfulText(text, index, 160);
  if (aggregateSignalPattern.test(before) && !cardSectionPattern.test(before)) return false;
  return cardSectionPattern.test(before);
}

function isStandaloneFourDigits(text: string, index: number, end: number) {
  const previous = index > 0 ? text[index - 1] : '';
  const next = end < text.length ? text[end] : '';
  return !/\d/u.test(previous) && !/\d/u.test(next);
}

function isLikelyCardBoundary(text: string, last4: string, index: number, end: number, explicit = false) {
  if (!isStandaloneFourDigits(text, index, end)) return false;
  if (overlapsRange(index, end, protectedRanges(text))) return false;

  const currentLine = lineAt(text, index);
  const bounds = lineBoundsAt(text, index);
  const prefixInLine = currentLine.slice(0, index - bounds.lineStart);
  const lastHardSeparator = Math.max(
    prefixInLine.lastIndexOf('،'),
    prefixInLine.lastIndexOf(','),
    prefixInLine.lastIndexOf(';'),
    prefixInLine.lastIndexOf('؛'),
    prefixInLine.lastIndexOf('.'),
  );
  if (isAggregateLine(prefixInLine.slice(lastHardSeparator + 1))) return false;

  const before = previousMeaningfulText(text, index);
  const after = nextMeaningfulText(text, end);
  if (!explicit && (hasAmountLabelImmediatelyBefore(text, index) || hasCurrencyNeighbor(text, index, end))) return false;
  if (explicit) return true;

  const trimmedLine = currentLine.trim();
  if (trimmedLine === last4 && lineAfterHasCardDetails(text, bounds.lineEnd)) return true;
  if (index <= currentLine.search(/\S/u) + bounds.lineStart && afterLooksLikeCardDetails(after)) return true;
  if (isAtSegmentStart(text, index) && afterLooksLikeCardDetails(after)) return true;
  if (hasCardSectionBefore(text, index) && (afterLooksLikeCardDetails(after) || trimmedLine === last4)) return true;
  if (/[-:|]\s*$/u.test(before) && afterLooksLikeCardDetails(after)) return true;
  return false;
}

export function segmentCards(text: string) {
  const normalizedText = normalizeInstantText(text);
  const explicit = explicitLast4Matches(normalizedText);
  const explicitByIndex = new Map(explicit.map((boundary) => [boundary.index, boundary]));
  const boundaries: CardBoundary[] = [];

  for (const match of normalizedText.matchAll(/\d{4}/gu)) {
    const index = match.index ?? 0;
    const end = index + 4;
    const explicitBoundary = explicitByIndex.get(index);
    if (!isLikelyCardBoundary(normalizedText, match[0], index, end, Boolean(explicitBoundary))) continue;
    boundaries.push(
      explicitBoundary || {
        last4: match[0],
        index,
        end,
        confidence: index === 0 || isAtSegmentStart(normalizedText, index) ? 'HIGH' : 'MEDIUM',
        source: index === 0 ? 'leading' : 'context',
      },
    );
  }

  const unique = boundaries
    .sort((left, right) => left.index - right.index)
    .filter((boundary, index, list) => index === 0 || boundary.index !== list[index - 1].index);

  return unique.map((boundary, index): CardSegment => {
    const segmentEnd = unique[index + 1]?.index ?? normalizedText.length;
    const rawSegment = normalizedText.slice(boundary.index, segmentEnd).trim();
    return {
      ...boundary,
      text: cutAggregateTail(rawSegment),
    };
  });
}

function cutAggregateTail(segmentText: string) {
  const aggregateIndex = segmentText.search(/(?:^|[\n،,;؛.]\s*)(?:إجمالي|اجمالي|الإجمالي|الاجمالي|مجموع|المجموع)(?=\s|:|$)/u);
  if (aggregateIndex <= 0) return segmentText;
  return segmentText.slice(0, aggregateIndex).trim();
}

function extractLast4(text: string) {
  const normalizedText = normalizeInstantText(text);
  const explicit = explicitLast4Matches(normalizedText)[0];
  if (explicit) return explicit.last4;
  const leading = extractLeadingLast4(normalizedText);
  if (leading) return leading;
  const segmented = segmentCards(normalizedText)[0]?.last4;
  if (segmented) return segmented;

  for (const match of normalizedText.matchAll(/\d{4}/gu)) {
    const index = match.index ?? 0;
    const end = index + 4;
    if (!isStandaloneFourDigits(normalizedText, index, end)) continue;
    if (overlapsRange(index, end, protectedRanges(normalizedText))) continue;
    if (isAggregateLine(lineAt(normalizedText, index))) continue;
    if (hasAmountLabelImmediatelyBefore(normalizedText, index) || hasCurrencyNeighbor(normalizedText, index, end)) continue;
    return match[0];
  }

  return undefined;
}

function removeAmounts(text: string) {
  return text.replace(amountPattern, ' ');
}

function normalizeName(value: string) {
  return value
    .replace(/#\s*[A-Za-z]?\d{1,8}/gu, ' ')
    .replace(/\b(?:\+?218|0)?9\d{8}\b/gu, ' ')
    .replace(/[:|،,.؛]+/g, ' ')
    .replace(/\b(?:رقم|الهاتف|هاتف|تلفون|موبايل|جوال)\b/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCardAndAmountLanguage(value: string) {
  const cardLabelSource = labelPatternSource([
    ...cardValueLabels,
    ...cardAgreedLabels,
    ...deliveryLabels,
    ...remainingLabels,
    'رقم الهاتف',
    'الهاتف',
    'هاتف',
    'لديه',
    'عنده',
    'البطاقة الجديدة',
    'بطاقة جديدة',
    'الكرت الجديد',
    'كرت جديد',
    'رقم البطاقة',
    'رقم الكرت',
    'البطاقة',
    'بطاقة',
    'الكرت',
    'كرت',
    'البطاقات',
    'بطاقات',
    'الكروت',
    'كروت',
    'النوع',
  ]);
  return value
    .replace(new RegExp(String.raw`(?:${cardLabelSource}).*$`, 'iu'), ' ')
    .replace(/\d{4}/gu, ' ')
    .replace(/\s+/g, ' ');
}

function cleanPersonCandidate(value: string) {
  const candidate = normalizeName(stripCardAndAmountLanguage(removeAmounts(value)))
    .replace(/\s+ال$/u, '')
    .trim();
  if (!/\p{L}/u.test(candidate)) return '';
  return candidate;
}

function extractExplicitPersonName(text: string) {
  const explicit = text.match(
    /(?:اسم\s+)?(?:الزبون|العميل)\s*[:：]?\s*(.+?)(?=\s+(?:#|(?:رقم\s*)?(?:الهاتف|هاتف|تلفون|جوال)|لديه|عنده|بطاقة|كرت|القيمة|قيمة|المتفق|الصافي|استلم|سحب|صافي\s+بالكامل)|$)/u,
  );
  const candidate = cleanPersonCandidate(explicit?.[1] || '');
  return candidate || undefined;
}

function extractLeadingPersonName(text: string) {
  const firstLine = cleanLine(text.split(/\n+/).find((line) => cleanLine(line)) || text);
  const operationMatch = firstLine.match(new RegExp(String.raw`^(.+?)\s+(?:${leadingOperationSource})(?=\s|:|$)`, 'u'));
  const codeOrPhoneIndex = [
    firstLine.search(/#\s*[A-Za-z]?\d{1,8}/u),
    firstLine.search(/(?:\+?218|0)?9\d{8}/u),
  ].filter((index) => index >= 0);
  const earliestCodeOrPhone = codeOrPhoneIndex.length ? Math.min(...codeOrPhoneIndex) : -1;
  const candidateText =
    operationMatch?.[1] || (earliestCodeOrPhone > 0 ? firstLine.slice(0, earliestCodeOrPhone) : firstLine);
  const candidate = cleanPersonCandidate(candidateText);
  const wordCount = candidate ? candidate.split(/\s+/).length : 0;
  return wordCount && wordCount <= 5 ? candidate : undefined;
}

function hasLeadingWalletMovement(text: string) {
  const match = text.match(/^(.+?)\s+(?:علينا|لنا)(?:\s|$)/u);
  return Boolean(match?.[1] && !/\d/u.test(match[1]) && cleanPersonCandidate(match[1]));
}

function isPhoneLine(line: string) {
  return /^(?:\+?218|0)?9\d{8}$/u.test(line.trim());
}

function looksLikeCardTypeLine(line: string) {
  return (
    /بطاقة|مصرف|جمهورية|وحدة|تجاري|صحارى|شمال|يقين|أمان|امان/u.test(line) &&
    !/\d{4}/u.test(line) &&
    !/(جديدة|بطاقتان|بطاقات|القيمة|قيمة|المتفق|سحب|تصفية|صافي|مصف|متوقفة|مرفوضة)/u.test(line)
  );
}

export function extractCustomer(text: string) {
  const normalizedText = normalizeInstantText(text);
  const lines = messageLines(normalizedText);
  const code = extractCustomerCode(normalizedText);
  const phone = extractPhone(normalizedText);
  const explicitName = extractExplicitPersonName(normalizedText);
  const leadingName = extractLeadingPersonName(normalizedText);
  let personName = explicitName || leadingName;

  if (!personName) {
    for (const line of lines) {
      if (isPhoneLine(line)) continue;
      if (line === code) continue;
      if (
        /^(?:بطاقة|بطاقتان|بطاقات|كرت|كروت|النوع|آخر|اخر|القيمة|قيمة|المتفق|الصافي|صافي|استلم|تم|لم|لنا|علينا|سحب|سحبة|تسديد|سداد|دفع|مصف|متوقف|مرفوض|المتبقي|الباقي)/u.test(
          line,
        )
      ) {
        continue;
      }
      if (looksLikeCardTypeLine(line)) continue;
      if (/\d{4}/u.test(line) && /بطاقة|كرت|سحب|القيمة|قيمة|المتفق/u.test(line)) continue;
      const candidate = cleanPersonCandidate(line);
      if (candidate.length >= 2) {
        personName = candidate;
        break;
      }
    }
  }

  return {
    personName,
    customerCode: code,
    phone,
    fieldConfidence: {
      personName: personName ? (explicitName || leadingName ? 'HIGH' : 'MEDIUM') : 'UNKNOWN',
      customerCode: code ? 'HIGH' : 'UNKNOWN',
      phone: phone ? 'HIGH' : 'UNKNOWN',
    } satisfies Record<string, ConfidenceLevel>,
  };
}

function extractBankName(lines: string[]) {
  const typeLine = lines.find((line) => /(?:^|\s)(?:النوع|نوع)\s*:/u.test(line));
  if (typeLine) {
    const value = typeLine.replace(/.*(?:النوع|نوع)\s*:\s*/u, '').trim();
    if (value) return value;
  }

  const cardType = lines.find(looksLikeCardTypeLine);
  return cardType?.replace(/^النوع\s*:?\s*/u, '').trim();
}

function hasNegatedDelivery(text: string) {
  return /(?:لم\s+(?:أ?ستلم|استلم|يستلم|يستلموا|نسجل|أسجل|اسجل)|لم\s+يتم\s+استلام|لم\s+يسلم|لم\s+أسجل|لم\s+اسجل|لا\s+يوجد\s+(?:استلام|مستلم)|شيء|شئ)/u.test(
    text,
  );
}

function hasFullDelivery(text: string) {
  return /(?:تم\s+)?استلام\s+كامل\s+المبلغ|استلم\s+كامل\s+المبلغ|تم\s+تسليم(?:ه)?\s+كامل\s+المبلغ|المبلغ\s+كامل\s+(?:مستلم|تم\s+استلامه)/u.test(
    text,
  );
}

function hasSettledPhrase(text: string) {
  if (/(?:صافي\s+بالكامل|مصفى|مصفاة|تمت?\s+التصفية|خالص\s+بالكامل|خالص)/u.test(text)) return true;
  return /(?:^|\s)صافي(?:\s|$)/u.test(text) && !new RegExp(String.raw`صافي\s*(?:المتفق|${numberSource})`, 'u').test(text);
}

function parseStatus(text: string): Pick<InstantCardDraft, 'status' | 'reason'> {
  const failure = text.match(failureReasonPattern);
  if (failure?.[1]) {
    const labeledReason = text.match(/(?:بسبب|السبب|سبب)\s*[:=]?\s*(.+)$/u)?.[1]?.trim();
    const rejected = /فشل|حمراء|مرفوض|رفض|رصيد\s+غير\s+كاف/u.test(failure[1]);
    return {
      status: rejected ? 'REJECTED' : 'STOPPED',
      reason: labeledReason || failure[1].trim(),
    };
  }
  if (hasSettledPhrase(text)) return { status: 'SETTLED' };
  return { status: 'ACTIVE' };
}

function extractDeliveryAmount(text: string, fallbackCurrency?: InstantCurrencyCode) {
  if (hasNegatedDelivery(text)) return makeAmount('0', undefined, fallbackCurrency, { confidence: 'HIGH', raw: 'لم يستلم شيء' });
  return extractLabeledAmount(text, deliveryLabels, fallbackCurrency);
}

function extractRemainingAmount(text: string, fallbackCurrency?: InstantCurrencyCode) {
  return extractLabeledAmount(text, remainingLabels, fallbackCurrency);
}

function inferDefaultCurrency(text: string): InstantCurrencyCode {
  return currencyFromText(text, 'USD');
}

function textWithoutAggregateLines(text: string) {
  return messageLines(text)
    .filter((line) => !isAggregateLine(line))
    .join('\n');
}

function extractFirstTotalAmount(text: string, labels: string[], fallbackCurrency?: InstantCurrencyCode) {
  for (const line of messageLines(text)) {
    const amount = extractLooseLabeledAmount(line, labels, fallbackCurrency);
    if (amount) return amount;
  }
  return extractLooseLabeledAmount(text, labels, fallbackCurrency);
}

export function extractTotals(text: string, firstCardIndex = -1, fallbackCurrency?: InstantCurrencyCode) {
  const normalizedText = normalizeInstantText(text);
  const prefix = firstCardIndex >= 0 ? normalizedText.slice(0, firstCardIndex) : normalizedText;
  const aggregateLines = messageLines(normalizedText)
    .filter(isAggregateLine)
    .join('\n');
  const totalSource = `${prefix}\n${aggregateLines}`.trim();
  const totalAgreedAmount = extractFirstTotalAmount(totalSource, totalAgreedLabels, fallbackCurrency);
  const totalReceivedAmount = extractFirstTotalAmount(
    totalSource,
    totalReceivedLabels,
    totalAgreedAmount?.currencyCode || fallbackCurrency,
  );
  const totalRemainingAmount = extractFirstTotalAmount(
    totalSource,
    totalRemainingLabels,
    totalAgreedAmount?.currencyCode || totalReceivedAmount?.currencyCode || fallbackCurrency,
  );

  return { totalAgreedAmount, totalReceivedAmount, totalRemainingAmount };
}

function amountValuesEqual(left: number, right: number) {
  return Math.abs(left - right) < 0.000001;
}

function amountSymbol(currencyCode: InstantCurrencyCode) {
  return currencyCode === 'LYD' ? 'د.ل' : '$';
}

function amountText(value: number, currencyCode: InstantCurrencyCode) {
  return `${value.toLocaleString('en-US')} ${amountSymbol(currencyCode)}`;
}

function amountCurrencyForDerived(card: InstantCardDraft, fallbackCurrency: InstantCurrencyCode) {
  return card.agreedAmount?.currencyCode || card.receivedAmount?.currencyCode || card.remainingAmount?.currencyCode || fallbackCurrency;
}

function positionalAmounts(segmentText: string, last4: string, fallbackCurrency?: InstantCurrencyCode) {
  const withoutLast4 = segmentText.replace(new RegExp(String.raw`(^|[^\d])${escapeRegex(last4)}(?=$|[^\d])`, 'u'), '$1 ');
  return amountsIn(withoutLast4, fallbackCurrency);
}

export function parseAmounts(segmentText: string, last4: string, fallbackCurrency?: InstantCurrencyCode) {
  const valueAmount = extractLabeledAmount(segmentText, cardValueLabels, fallbackCurrency);
  const agreedAmount = extractLabeledAmount(segmentText, cardAgreedLabels, valueAmount?.currencyCode || fallbackCurrency);
  const receivedAmount = extractDeliveryAmount(segmentText, agreedAmount?.currencyCode || valueAmount?.currencyCode || fallbackCurrency);
  const remainingAmount = extractRemainingAmount(segmentText, agreedAmount?.currencyCode || valueAmount?.currencyCode || fallbackCurrency);
  const amounts = positionalAmounts(segmentText, last4, fallbackCurrency);
  const ambiguousAmounts: number[] = [];
  let inferredValue = valueAmount;
  let inferredAgreed = agreedAmount;

  if ((!inferredValue || !inferredAgreed) && amounts.length >= 2 && /^\s*\d{4}\s*(?:-|:|\|)/u.test(segmentText)) {
    inferredValue ||= { ...amounts[0], confidence: 'MEDIUM' };
    inferredAgreed ||= { ...amounts[1], confidence: 'MEDIUM' };
  } else if (!inferredValue && inferredAgreed && amounts.length >= 2) {
    const candidate = amounts.find((amount) => !amountValuesEqual(amount.value, inferredAgreed?.value || Number.NaN));
    if (candidate) inferredValue = { ...candidate, confidence: 'MEDIUM' };
  } else if (!inferredValue && !inferredAgreed && amounts.length === 1) {
    ambiguousAmounts.push(amounts[0].value);
  }

  return {
    valueAmount: inferredValue,
    agreedAmount: inferredAgreed,
    receivedAmount,
    remainingAmount,
    ambiguousAmounts,
  };
}

export function parseCard(segment: CardSegment, fallbackCurrency?: InstantCurrencyCode): InstantCardDraft {
  const amounts = parseAmounts(segment.text, segment.last4, fallbackCurrency);
  const status = parseStatus(segment.text);

  return {
    cardLast4: segment.last4,
    valueAmount: amounts.valueAmount,
    agreedAmount: amounts.agreedAmount,
    receivedAmount: amounts.receivedAmount,
    remainingAmount: amounts.remainingAmount,
    status: status.status,
    reason: status.reason,
    ambiguousAmounts: amounts.ambiguousAmounts,
    sourceLine: segment.text,
    fieldConfidence: {
      cardLast4: segment.confidence,
      valueAmount: amounts.valueAmount ? amounts.valueAmount.confidence || 'HIGH' : 'UNKNOWN',
      agreedAmount: amounts.agreedAmount ? amounts.agreedAmount.confidence || 'HIGH' : 'UNKNOWN',
      receivedAmount: amounts.receivedAmount ? amounts.receivedAmount.confidence || 'HIGH' : 'UNKNOWN',
      remainingAmount: amounts.remainingAmount ? amounts.remainingAmount.confidence || 'HIGH' : 'UNKNOWN',
      status: status.status === 'ACTIVE' ? 'MEDIUM' : 'HIGH',
    },
  };
}

function resolveDerivedCardValues(card: InstantCardDraft, contextText: string, fallbackCurrency: InstantCurrencyCode) {
  const statusFromContext = parseStatus(contextText);
  if ((!card.status || card.status === 'ACTIVE') && statusFromContext.status !== 'ACTIVE') {
    card.status = statusFromContext.status;
    card.reason ||= statusFromContext.reason;
    card.fieldConfidence = { ...card.fieldConfidence, status: 'HIGH' };
  }

  const hasFullReceipt = hasFullDelivery(contextText);
  const isSettled = card.status === 'SETTLED';
  const currency = amountCurrencyForDerived(card, fallbackCurrency);

  if ((hasFullReceipt || isSettled) && card.agreedAmount && !card.receivedAmount) {
    card.receivedAmount = makeDerivedAmount(card.agreedAmount.value, card.agreedAmount.currencyCode, 'تم استلام كامل المبلغ');
    card.fieldConfidence = { ...card.fieldConfidence, receivedAmount: hasFullReceipt ? 'HIGH' : 'MEDIUM' };
  }

  if ((hasFullReceipt || isSettled) && !card.remainingAmount) {
    card.remainingAmount = makeDerivedAmount(0, currency, 'صافي بالكامل');
    card.fieldConfidence = { ...card.fieldConfidence, remainingAmount: 'HIGH' };
  }

  if (hasFullReceipt && card.status !== 'REJECTED' && card.status !== 'STOPPED') {
    card.status = 'SETTLED';
    card.fieldConfidence = { ...card.fieldConfidence, status: 'HIGH' };
  }

  if (!card.receivedAmount && card.agreedAmount && card.remainingAmount && card.agreedAmount.value >= card.remainingAmount.value) {
    card.receivedAmount = makeDerivedAmount(
      card.agreedAmount.value - card.remainingAmount.value,
      card.agreedAmount.currencyCode,
      `${card.agreedAmount.value} - ${card.remainingAmount.value}`,
    );
    card.fieldConfidence = { ...card.fieldConfidence, receivedAmount: 'MEDIUM' };
  }

  if (!card.remainingAmount && card.agreedAmount && card.receivedAmount) {
    card.remainingAmount = makeDerivedAmount(
      Math.max(card.agreedAmount.value - card.receivedAmount.value, 0),
      card.agreedAmount.currencyCode,
      `${card.agreedAmount.value} - ${card.receivedAmount.value}`,
    );
    card.fieldConfidence = { ...card.fieldConfidence, remainingAmount: 'MEDIUM' };
  }
}

function extractExpectedCardCount(text: string) {
  if (/(?:بطاقتان|بطاقتين|كرتين)(?=\s|:|،|,|$)/u.test(text)) return 2;
  const explicit = text.match(/(?:لديه|لديها|عنده|عندها|معاه|معها|معه|عدد)?\s*(\d{1,3})\s*(?:بطاقات|كروت)(?=\s|:|،|,|$)/u);
  if (explicit?.[1]) return Number(explicit[1]);
  const one = text.match(/(?:بطاقة|كرت)\s+(?:واحدة|واحد)(?=\s|:|،|,|$)/u);
  if (one) return 1;
  return undefined;
}

function validateCardEntryTotals(
  warnings: string[],
  cards: InstantCardDraft[],
  totalAgreedAmount?: InstantAmount,
  totalReceivedAmount?: InstantAmount,
  totalRemainingAmount?: InstantAmount,
) {
  let checked = false;
  let valid = true;
  const agreedAmounts = cards.map((card) => card.agreedAmount).filter((amount): amount is InstantAmount => Boolean(amount));

  if (
    totalAgreedAmount &&
    cards.length > 0 &&
    agreedAmounts.length === cards.length &&
    agreedAmounts.every((amount) => amount.currencyCode === totalAgreedAmount.currencyCode)
  ) {
    checked = true;
    const agreedSum = agreedAmounts.reduce((sum, amount) => sum + amount.value, 0);
    if (!amountValuesEqual(agreedSum, totalAgreedAmount.value)) {
      valid = false;
      warnings.push(
        `تعارض حسابي: إجمالي المتفق ${amountText(totalAgreedAmount.value, totalAgreedAmount.currencyCode)} لا يساوي مجموع متفق البطاقات ${amountText(agreedSum, totalAgreedAmount.currencyCode)}.`,
      );
    }
  }

  if (
    totalAgreedAmount &&
    totalReceivedAmount &&
    totalRemainingAmount &&
    totalAgreedAmount.currencyCode === totalReceivedAmount.currencyCode &&
    totalAgreedAmount.currencyCode === totalRemainingAmount.currencyCode
  ) {
    checked = true;
    const expectedRemaining = totalAgreedAmount.value - totalReceivedAmount.value;
    if (!amountValuesEqual(expectedRemaining, totalRemainingAmount.value)) {
      valid = false;
      warnings.push(
        `تعارض حسابي: إجمالي المتفق ناقص المستلم يساوي ${amountText(expectedRemaining, totalAgreedAmount.currencyCode)} وليس ${amountText(totalRemainingAmount.value, totalRemainingAmount.currencyCode)}.`,
      );
    }
  }

  return checked ? valid : undefined;
}

export function validateParsedData(parsed: ParsedCardEntry) {
  const warnings = [...parsed.warnings];
  if (parsed.expectedCardCount && parsed.cards.length < parsed.expectedCardCount) {
    warnings.push(`تم ذكر ${parsed.expectedCardCount} بطاقات لكن تم التعرف على ${parsed.cards.length} فقط.`);
  }

  for (const card of parsed.cards) {
    if (!card.cardLast4) warnings.push('لم يتم تحديد آخر 4 أرقام لإحدى البطاقات.');
    if (!card.agreedAmount) warnings.push(`البطاقة ${card.cardLast4 || ''} بدون مبلغ متفق واضح.`);
    if (card.ambiguousAmounts?.length) warnings.push('رقم مبهم: لم أستطع تحديد هل الرقم غير المسمى هو قيمة البطاقة أم المتفق.');
    if (card.agreedAmount && card.receivedAmount && card.remainingAmount) {
      const expectedRemaining = card.agreedAmount.value - card.receivedAmount.value;
      if (!amountValuesEqual(Math.max(expectedRemaining, 0), card.remainingAmount.value)) {
        warnings.push(`تعارض حسابي: البطاقة ${card.cardLast4 || ''} المتفق ناقص المستلم لا يطابق المتبقي.`);
      }
    }
    if (card.status === 'SETTLED' && card.remainingAmount && card.remainingAmount.value > 0) {
      warnings.push(`تعارض حسابي: البطاقة ${card.cardLast4 || ''} مكتوبة صافي بالكامل لكن المتبقي أكبر من صفر.`);
    }
  }

  return warnings;
}

function hasCardEntrySignal(text: string) {
  if (/(?:زبون|عميل)\s+جديد|(?:بطاقة|كرت)\s+جديد|أضف\s+بطاقة|اضف\s+بطاقة/u.test(text)) return true;
  if (extractExpectedCardCount(text)) return true;
  if ((extractAfterLabeledAmount(text, cardValueLabels) || extractAfterLabeledAmount(text, cardAgreedLabels)) && segmentCards(text).length) {
    return true;
  }
  if (/(?:سحب|سحبة|سحبات)/u.test(text)) return false;
  if (hasSettledPhrase(text) && !extractAfterLabeledAmount(text, cardValueLabels) && !extractAfterLabeledAmount(text, cardAgreedLabels)) return false;
  return segmentCards(text).some((segment) => positionalAmounts(segment.text, segment.last4).length >= 2);
}

export function detectIntent(text: string): InstantIntent {
  const normalizedText = normalizeInstantText(text);
  const cardEntry = hasCardEntrySignal(normalizedText);
  const hasLast4 = Boolean(extractLast4(normalizedText));
  const hasWithdrawal = /(?:سحب|سحبة|سحبات)/u.test(normalizedText) && hasLast4;

  if (/^(?:علينا|لنا)(?:\s|$)/u.test(normalizedText) || hasLeadingWalletMovement(normalizedText)) return 'WALLET_MOVEMENT';
  if (/(?:تسديد|سداد|سداده|سدد|سدّد)|(?:دفع).*(?:دين|الدين)|(?:دين).*(?:تسديد|سداد|دفع)/u.test(normalizedText)) {
    return 'WALLET_REPAYMENT';
  }
  if (hasWithdrawal && !extractAfterLabeledAmount(normalizedText, cardValueLabels) && !extractAfterLabeledAmount(normalizedText, cardAgreedLabels)) {
    return 'CARD_WITHDRAWAL';
  }
  if (cardEntry) return 'CARD_ENTRY';
  if (/(?:متوقفة|متوقف|مرفوضة|مرفوض|رفض|فشل|حمراء|لا\s+تعمل|رصيد\s+غير\s+كاف)/u.test(normalizedText) && hasLast4) {
    return 'CARD_STATUS';
  }
  if (hasWithdrawal) return 'CARD_WITHDRAWAL';
  if (hasSettledPhrase(normalizedText) && hasLast4) return 'CARD_FINAL_SETTLEMENT';
  if (/(?:استلم|استلام|تسليمه|تم\s+تسليمه|سلم|تم\s+التسليم)/u.test(normalizedText) && !hasNegatedDelivery(normalizedText)) {
    return 'CUSTOMER_DELIVERY';
  }

  return 'UNKNOWN';
}

function parseCardEntry(originalText: string, normalizedText: string): ParsedCardEntry {
  const lines = messageLines(normalizedText);
  const base = buildBase('CARD_ENTRY', originalText, normalizedText);
  const fallbackCurrency = inferDefaultCurrency(normalizedText);
  const bankName = extractBankName(lines);
  const segments = segmentCards(normalizedText);
  const firstCardIndex = segments[0]?.index ?? -1;
  const totals = extractTotals(normalizedText, firstCardIndex, fallbackCurrency);
  const cardDetailText = textWithoutAggregateLines(normalizedText);
  const prefixText = firstCardIndex >= 0 ? normalizedText.slice(0, firstCardIndex) : normalizedText;
  const expectedCardCount = extractExpectedCardCount(normalizedText);
  const globalValue = extractLabeledAmount(cardDetailText, cardValueLabels, fallbackCurrency);
  const globalAgreed = extractLabeledAmount(cardDetailText, cardAgreedLabels, globalValue?.currencyCode || fallbackCurrency);
  const globalReceived = extractDeliveryAmount(cardDetailText, globalAgreed?.currencyCode || fallbackCurrency);
  const globalRemaining = extractRemainingAmount(cardDetailText, globalAgreed?.currencyCode || fallbackCurrency);
  const sharedValue = extractLabeledAmount(prefixText, cardValueLabels, fallbackCurrency);
  const sharedAgreed = extractLabeledAmount(prefixText, cardAgreedLabels, sharedValue?.currencyCode || fallbackCurrency);
  const sharedReceived = extractDeliveryAmount(prefixText, sharedAgreed?.currencyCode || fallbackCurrency);
  const sharedRemaining = extractRemainingAmount(prefixText, sharedAgreed?.currencyCode || fallbackCurrency);
  const fallbackCardLast4 = extractLast4(cardDetailText);
  const fallbackCard: InstantCardDraft = {
    cardLast4: fallbackCardLast4,
    valueAmount: globalValue,
    agreedAmount: globalAgreed || totals.totalAgreedAmount,
    receivedAmount: globalReceived || totals.totalReceivedAmount,
    remainingAmount: globalRemaining || totals.totalRemainingAmount,
    fieldConfidence: {
      cardLast4: fallbackCardLast4 ? 'MEDIUM' : 'UNKNOWN',
      valueAmount: globalValue ? 'HIGH' : 'UNKNOWN',
      agreedAmount: globalAgreed || totals.totalAgreedAmount ? 'HIGH' : 'UNKNOWN',
      receivedAmount: globalReceived || totals.totalReceivedAmount ? 'MEDIUM' : 'UNKNOWN',
      remainingAmount: globalRemaining || totals.totalRemainingAmount ? 'MEDIUM' : 'UNKNOWN',
    },
  };
  const hasFallbackCardData = Boolean(
    fallbackCard.cardLast4 || fallbackCard.valueAmount || fallbackCard.agreedAmount || fallbackCard.receivedAmount || fallbackCard.remainingAmount,
  );
  const cards = segments.length ? segments.map((segment) => parseCard(segment, fallbackCurrency)) : hasFallbackCardData ? [fallbackCard] : [];
  const hasMultipleCards = cards.length > 1;

  for (const card of cards) {
    card.bankName ||= bankName;
    card.valueAmount ||= hasMultipleCards ? sharedValue : globalValue || sharedValue;
    card.agreedAmount ||= hasMultipleCards ? sharedAgreed : globalAgreed || sharedAgreed || totals.totalAgreedAmount;

    if (hasMultipleCards) {
      if (!card.receivedAmount && sharedReceived?.value === 0) card.receivedAmount = sharedReceived;
      if (!card.remainingAmount && sharedRemaining?.value === 0) card.remainingAmount = sharedRemaining;
    } else {
      card.receivedAmount ||= globalReceived || sharedReceived || totals.totalReceivedAmount;
      card.remainingAmount ||= globalRemaining || sharedRemaining || totals.totalRemainingAmount;
    }

    resolveDerivedCardValues(card, hasMultipleCards ? card.sourceLine || '' : normalizedText, fallbackCurrency);
  }

  const customer = extractCustomer(normalizedText);
  if (!customer.personName) base.warnings.push('لم يتم تحديد اسم الزبون.');

  const currencies = new Set(
    cards
      .flatMap((card) => [
        card.valueAmount?.currencyCode,
        card.agreedAmount?.currencyCode,
        card.receivedAmount?.currencyCode,
        card.remainingAmount?.currencyCode,
      ])
      .concat([totals.totalAgreedAmount?.currencyCode, totals.totalReceivedAmount?.currencyCode, totals.totalRemainingAmount?.currencyCode])
      .filter(Boolean),
  );
  if (currencies.has('USD') && currencies.has('LYD')) {
    base.warnings.push('توجد أكثر من عملة في الرسالة. سيتم حفظ كل مبلغ بعملته ولن يتم جمع USD مع LYD.');
  }

  const entryShell: ParsedCardEntry = {
    ...base,
    personName: customer.personName,
    customerCode: customer.customerCode,
    phone: customer.phone,
    bankName,
    cards,
    expectedCardCount,
    totalAgreedAmount: totals.totalAgreedAmount,
    totalReceivedAmount: totals.totalReceivedAmount,
    totalRemainingAmount: totals.totalRemainingAmount,
  };
  const warnings = validateParsedData(entryShell);
  base.warnings.splice(0, base.warnings.length, ...warnings);

  const totalsVerified = validateCardEntryTotals(
    base.warnings,
    cards,
    totals.totalAgreedAmount,
    totals.totalReceivedAmount,
    totals.totalRemainingAmount,
  );
  const deliveryAmount =
    totals.totalReceivedAmount ||
    globalReceived ||
    (cards.length && cards.every((card) => card.receivedAmount && card.receivedAmount.currencyCode === cards[0].receivedAmount?.currencyCode)
      ? {
          ...(cards[0].receivedAmount as InstantAmount),
          value: cards.reduce((sum, card) => sum + (card.receivedAmount?.value || 0), 0),
          raw: 'مجموع المستلم من البطاقات',
          inferred: true,
          confidence: 'MEDIUM' as ConfidenceLevel,
        }
      : undefined);
  const hasBlockingWarning = base.warnings.some((warning) => /^(?:تعارض حسابي|تحليل غير آمن|تم ذكر|رقم مبهم)/u.test(warning));
  const confidence =
    hasBlockingWarning || !customer.personName || !cards.length
      ? 0.55
      : totalsVerified && customer.personName
        ? 0.92
        : customer.personName && cards.every((card) => card.cardLast4 && card.agreedAmount)
          ? 0.86
          : 0.68;

  return {
    ...base,
    confidence,
    fieldConfidence: {
      ...base.fieldConfidence,
      ...customer.fieldConfidence,
      expectedCardCount: expectedCardCount ? 'HIGH' : 'UNKNOWN',
    },
    personName: customer.personName,
    customerCode: customer.customerCode,
    phone: customer.phone,
    bankName,
    cards,
    expectedCardCount,
    deliveryAmount: deliveryAmount?.value ? deliveryAmount : undefined,
    totalAgreedAmount: totals.totalAgreedAmount,
    totalReceivedAmount: totals.totalReceivedAmount,
    totalRemainingAmount: totals.totalRemainingAmount,
    totalsVerified,
  };
}

function parseCardWithdrawal(originalText: string, normalizedText: string): ParsedCardWithdrawal {
  const base = buildBase('CARD_WITHDRAWAL', originalText, normalizedText);
  const fallbackCurrency = inferDefaultCurrency(normalizedText);
  const personName = extractLeadingPersonName(normalizedText);
  const quantityMatch = normalizedText.match(/(?:تنفيذ\s*)?(\d+)\s*(?:سحبات|سحبة|مرات)/u);
  const quantity = Math.max(1, Number(quantityMatch?.[1] || 1));
  const withdrawalAmountMatch = normalizedText.match(
    new RegExp(String.raw`(?:سحبات|سحبة|سحب)\s*(?:بمبلغ|قيمة)?\s*[:=]?\s*${amountTokenSource}`, 'iu'),
  );
  const amount = withdrawalAmountMatch ? amountFromCaptured(withdrawalAmountMatch, fallbackCurrency) : lastAmount(normalizedText, fallbackCurrency);
  const cardLast4 = extractLast4(normalizedText);

  if (!cardLast4) base.warnings.push('لم يتم تحديد البطاقة.');
  if (!amount || amount.value <= 0) base.warnings.push('لم يتم تحديد مبلغ السحبة.');

  return {
    ...base,
    confidence: cardLast4 && amount ? 0.9 : 0.55,
    personName,
    cardLast4,
    amount,
    quantity,
    totalAmount: amount
      ? {
          ...amount,
          value: amount.value * quantity,
          raw: `${quantity} x ${amount.raw}`,
          inferred: quantity > 1,
        }
      : undefined,
  };
}

function parseCardFinalSettlement(originalText: string, normalizedText: string): ParsedCardFinalSettlement {
  const base = buildBase('CARD_FINAL_SETTLEMENT', originalText, normalizedText);
  const personName = extractLeadingPersonName(normalizedText);
  const cardLast4 = extractLast4(normalizedText);
  if (!cardLast4) base.warnings.push('لم يتم تحديد البطاقة المراد تصفيتها.');
  return { ...base, confidence: cardLast4 ? 0.9 : 0.55, personName, cardLast4 };
}

function parseCardStatusMessage(originalText: string, normalizedText: string): ParsedCardStatus {
  const base = buildBase('CARD_STATUS', originalText, normalizedText);
  const personName = extractLeadingPersonName(normalizedText);
  const cardLast4 = extractLast4(normalizedText);
  const parsedStatus = parseStatus(normalizedText);
  const reason =
    normalizedText.match(/(?:بسبب|السبب)\s*[:=]?\s*(.+)$/u)?.[1]?.trim() ||
    normalizedText.match(/\d{4}\s*(?:متوقفة|مرفوضة|مرفوض|متوقف)\s+(.+)$/u)?.[1]?.trim() ||
    parsedStatus.reason;
  const status = parsedStatus.status === 'REJECTED' ? 'REJECTED' : 'STOPPED';

  if (!cardLast4) base.warnings.push('لم يتم تحديد البطاقة.');
  if (!reason) base.warnings.push('لم يتم تحديد سبب الإيقاف أو الرفض.');

  return { ...base, confidence: cardLast4 ? 0.86 : 0.55, personName, cardLast4, status, reason };
}

function parseWalletMovement(originalText: string, normalizedText: string): ParsedWalletMovement {
  const side = /(?:^|\s)علينا(?:\s|$)/u.test(normalizedText) ? 'THEM' : 'US';
  const base = buildBase('WALLET_MOVEMENT', originalText, normalizedText);
  const amount = lastAmount(normalizedText, inferDefaultCurrency(normalizedText));
  const namePattern =
    side === 'THEM'
      ? normalizedText.match(/^علينا\s+(?:ل|على)?\s*(.+?)\s+\d/u)
      : normalizedText.match(/^لنا\s+(?:على|عليه|ل)?\s*(.+?)\s+\d/u);
  const directName = normalizeName(removeAmounts(namePattern?.[1] || ''));
  const personName = directName || extractLeadingPersonName(normalizedText);

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

  const amountThenName = normalizedText.match(
    /(?:تسديد|سداد|تسدد|سداده)\s*(?:دين)?\s*\d[\d\s,،٬.]*\s*(?:\$|USD|usd|دولار|LYD|lyd|د\.?\s*ل|دينار)?\s*(?:ل|من)?\s*(.+)$/u,
  );
  const nameThenAmount = normalizedText.match(/^(.+?)\s+(?:دفع|سدد|سدّد|سداد|تسديد)\s+\d/u);
  const debtNameBeforeAmount = normalizedText.match(/(?:دين)\s+(.+?)\s+\d/u);
  personName = normalizeName(removeAmounts(amountThenName?.[1] || nameThenAmount?.[1] || debtNameBeforeAmount?.[1] || ''));
  personName = personName.replace(/\b(?:من|الدين|دين|تم)\b/gu, ' ').replace(/\s+/g, ' ').trim();

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
  const keyword = normalizedText.match(/(?:استلم|استلام|تسليمه|تم\s+تسليمه|سلم|تم\s+التسليم)/u);
  const beforeKeyword = keyword ? normalizedText.slice(0, keyword.index).trim() : normalizedText;
  const personName = normalizeName(removeAmounts(beforeKeyword.replace(/(?:بطاقة|كرت)\s*\d{4}/u, '')));
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

  const intent = detectIntent(normalizedText);
  if (intent === 'CARD_ENTRY') return parseCardEntry(rawText, normalizedText);
  if (intent === 'CUSTOMER_DELIVERY') return parseCustomerDelivery(rawText, normalizedText);
  if (intent === 'CARD_WITHDRAWAL') return parseCardWithdrawal(rawText, normalizedText);
  if (intent === 'CARD_FINAL_SETTLEMENT') return parseCardFinalSettlement(rawText, normalizedText);
  if (intent === 'CARD_STATUS') return parseCardStatusMessage(rawText, normalizedText);
  if (intent === 'WALLET_MOVEMENT') return parseWalletMovement(rawText, normalizedText);
  if (intent === 'WALLET_REPAYMENT') return parseWalletRepayment(rawText, normalizedText);

  return {
    ...base,
    warnings: ['لم أستطع فهم نوع العملية من الرسالة.'],
    confidence: 0.2,
  };
}
