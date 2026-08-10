type CodedRecord = {
  customerNo?: string | null;
  createdAt?: string | Date | null;
  id?: string | null;
};

type SequencedRecord = {
  sequence?: number | null;
  createdAt?: string | Date | null;
  id?: string | null;
};

function parseCustomerCode(code?: string | null) {
  const raw = String(code || '').trim();
  const match = raw.match(/^#?\s*([A-Za-z]+)?\s*0*(\d+)/);

  return {
    prefix: (match?.[1] || '').toUpperCase(),
    number: match ? Number(match[2]) : Number.POSITIVE_INFINITY,
    raw,
  };
}

function prefixRank(prefix: string) {
  if (prefix === 'A') return 0;
  if (prefix === 'M') return 1;
  if (prefix) return 2;
  return 3;
}

function dateValue(value?: string | Date | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function compareCustomerCodes(leftCode?: string | null, rightCode?: string | null) {
  const left = parseCustomerCode(leftCode);
  const right = parseCustomerCode(rightCode);
  const rankDiff = prefixRank(left.prefix) - prefixRank(right.prefix);
  if (rankDiff !== 0) return rankDiff;

  if (left.prefix !== right.prefix) return left.prefix.localeCompare(right.prefix, 'en');
  if (left.number !== right.number) return left.number - right.number;
  return left.raw.localeCompare(right.raw, 'en');
}

export function compareByCustomerCode<T extends CodedRecord>(left: T, right: T) {
  const codeDiff = compareCustomerCodes(left.customerNo, right.customerNo);
  if (codeDiff !== 0) return codeDiff;

  const dateDiff = dateValue(left.createdAt) - dateValue(right.createdAt);
  if (dateDiff !== 0) return dateDiff;

  return String(left.id || '').localeCompare(String(right.id || ''), 'en');
}

export function sortByCustomerCode<T extends CodedRecord>(items: T[]) {
  return [...items].sort(compareByCustomerCode);
}

export function compareCardsBySequence<T extends SequencedRecord>(left: T, right: T) {
  const leftSequence = Number.isFinite(Number(left.sequence)) ? Number(left.sequence) : Number.POSITIVE_INFINITY;
  const rightSequence = Number.isFinite(Number(right.sequence)) ? Number(right.sequence) : Number.POSITIVE_INFINITY;
  if (leftSequence !== rightSequence) return leftSequence - rightSequence;

  const dateDiff = dateValue(left.createdAt) - dateValue(right.createdAt);
  if (dateDiff !== 0) return dateDiff;

  return String(left.id || '').localeCompare(String(right.id || ''), 'en');
}
