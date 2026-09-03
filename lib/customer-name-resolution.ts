const arabicDiacritics = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

export type CustomerNameCandidate = {
  id: string;
  fullName?: string | null;
};

export type CustomerNameOptions = {
  foldTaMarbuta?: boolean;
};

export function normalizeCustomerName(value?: string | null, options: CustomerNameOptions = {}) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(arabicDiacritics, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return options.foldTaMarbuta ? normalized.replace(/ة/g, 'ه') : normalized;
}

export function normalizedCustomerNameKey(value?: string | null, options: CustomerNameOptions = {}) {
  return normalizeCustomerName(value, options).replace(/\s+/g, '');
}

export function customerNameWords(value?: string | null) {
  return normalizeCustomerName(value)
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .slice(0, 4);
}

export function exactCustomerNameMatches<T extends CustomerNameCandidate>(
  personName: string | null | undefined,
  candidates: T[],
  options: CustomerNameOptions = {},
) {
  const target = normalizedCustomerNameKey(personName, options);
  if (!target) return [];
  return candidates.filter((candidate) => normalizedCustomerNameKey(candidate.fullName, options) === target);
}

export function leadingCustomerNameMatches<T extends CustomerNameCandidate>(
  personName: string | null | undefined,
  candidates: T[],
  options: CustomerNameOptions = {},
) {
  const target = normalizeCustomerName(personName, options);
  if (!target) return [];
  return candidates.filter((candidate) => {
    const candidateName = normalizeCustomerName(candidate.fullName, options);
    return candidateName === target || candidateName.startsWith(`${target} `);
  });
}
