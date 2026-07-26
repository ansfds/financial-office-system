type CurrencyLike = {
  code?: string | null;
  symbol?: string | null;
  name?: string | null;
};

export function numberValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 0;
  const raw = typeof value === 'object' && value && 'toString' in value ? String(value) : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toEnglishDigits(value: string) {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';

  return value
    .replace(/[٠-٩]/g, (digit) => String(eastern.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)));
}

export function normalizeNumberInput(value: string) {
  return toEnglishDigits(value).replace(',', '.');
}

export function formatNumber(
  value: unknown,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 0 },
) {
  return numberValue(value).toLocaleString('en-US', {
    maximumFractionDigits: 0,
    ...options,
  });
}

export function formatMoney(value: unknown, currency?: CurrencyLike | string | null) {
  const symbol = typeof currency === 'string' ? currency : currency?.symbol || currency?.name || '';
  return `${formatNumber(value)} ${symbol}`.trim();
}

export function formatRate(value: unknown) {
  return formatNumber(value, { maximumFractionDigits: 8 });
}

export function formatDateTime(value: string | Date) {
  return new Date(value).toLocaleString('en-GB');
}

export function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString('en-GB');
}
