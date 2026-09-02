import { Prisma } from '@prisma/client';
import { db } from './db';
import { D } from './money';
import { revalidateFinancePaths } from './revalidate';
import {
  cardBaseAmount,
  cardOperationAmount,
  cardProgressPercent,
  defaultCardDiscountCategories,
  isCardDeductionOperation,
} from './customer-cards';
import { recalculateReceivedCard } from './customer-card-recalculation';
import {
  buildWalletSnapshot,
  normalizeWalletPaymentMethod,
  previewWalletOperation,
  transactionWalletEffect,
  walletAccountAmount,
  type WalletAccountType,
  type WalletSettlementDirection,
} from './customer-wallet';
import {
  parseInstantMessage,
  type InstantAmount,
  type InstantCurrencyCode,
  type ParsedCardFinalSettlement,
  type ParsedCardEntry,
  type ParsedCardStatus,
  type ParsedCardWithdrawal,
  type ParsedCustomerDelivery,
  type ParsedInstantMessage,
  type ParsedWalletMovement,
  type ParsedWalletRepayment,
} from './instant-registration-parser';

type InstantSession = {
  id: string;
  userId?: string | null;
  username?: string | null;
};

type CurrencyRow = {
  id: string;
  code: string;
  name: string;
  symbol: string;
};

type PreviewMatch = {
  person?: {
    id: string;
    customerNo?: string | null;
    fullName: string;
    phone?: string | null;
    existing: boolean;
  } | null;
  card?: {
    id: string;
    cardLast4?: string | null;
    publicCode?: string | null;
    status?: string | null;
    remainingAmount?: string;
    personName?: string;
  } | null;
  currency?: CurrencyRow | null;
  duplicateCards?: string[];
  repaymentTarget?: {
    accountType: WalletAccountType;
    paymentMethod: string;
    balance: number;
    currency: CurrencyRow;
  } | null;
};

export type InstantRegistrationPreview = {
  fingerprint: string;
  kind: ParsedInstantMessage['kind'];
  kindLabel: string;
  actionLabel: string;
  ready: boolean;
  duplicate: boolean;
  warnings: string[];
  blockingIssues: string[];
  summary: string[];
  parsed: ParsedInstantMessage;
  matches: PreviewMatch;
};

type ExecutionResult = {
  message: string;
  fingerprint: string;
  undoAvailable: boolean;
  affectedPaths: string[];
  createdPersonId?: string;
  createdBatchId?: string;
  createdCardIds?: string[];
  createdDeliveryIds?: string[];
  createdCardOperationIds?: string[];
  createdWalletSettlementIds?: string[];
  affectedCardIds?: string[];
  affectedPersonIds?: string[];
};

type WalletStateRow = {
  paymentMethod: string;
  CREDIT: Prisma.Decimal;
  DEBT: Prisma.Decimal;
};

const instantExecuteAction = 'INSTANT_REGISTRATION_EXECUTE';
const instantUndoAction = 'INSTANT_REGISTRATION_UNDO';
const defaultPaymentByCurrency: Record<InstantCurrencyCode, string> = {
  USD: 'USD_CASH',
  LYD: 'LYD_CASH',
};

function jsonValue<T>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T;
}

function amountLabel(amount?: InstantAmount | null) {
  if (!amount) return '';
  const symbol = amount.currencyCode === 'LYD' ? 'د.ل' : '$';
  return `${amount.value.toLocaleString('en-US')} ${symbol}`;
}

function kindLabel(kind: ParsedInstantMessage['kind']) {
  const labels: Record<ParsedInstantMessage['kind'], string> = {
    CARD_ENTRY: 'تسجيل بطاقة',
    CUSTOMER_DELIVERY: 'استلام مبلغ للزبون',
    CARD_WITHDRAWAL: 'سحبة بطاقة',
    CARD_FINAL_SETTLEMENT: 'تصفية بطاقة',
    CARD_STATUS: 'إيقاف أو رفض بطاقة',
    WALLET_MOVEMENT: 'لنا وعلينا',
    WALLET_REPAYMENT: 'تسديد دين',
    UNKNOWN: 'غير واضح',
  };
  return labels[kind];
}

function actionLabel(kind: ParsedInstantMessage['kind']) {
  const labels: Record<ParsedInstantMessage['kind'], string> = {
    CARD_ENTRY: 'تسجيل الآن',
    CUSTOMER_DELIVERY: 'تأكيد الاستلام',
    CARD_WITHDRAWAL: 'تأكيد السحبة',
    CARD_FINAL_SETTLEMENT: 'تأكيد التصفية',
    CARD_STATUS: 'تأكيد الحالة',
    WALLET_MOVEMENT: 'تسجيل الدين',
    WALLET_REPAYMENT: 'تأكيد السداد',
    UNKNOWN: 'تأكيد',
  };
  return labels[kind];
}

function personLabel(person?: { customerNo?: string | null; fullName?: string | null } | null) {
  if (!person) return '';
  return `${person.customerNo ? `${person.customerNo} - ` : ''}${person.fullName || ''}`.trim();
}

function normalizeComparable(value?: string | null) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, '')
    .trim();
}

function cardDisplay(card?: any) {
  if (!card) return '';
  return card.cardLast4 || card.publicCode || `#${card.sequence || ''}`;
}

function createBlockingPreview(parsed: ParsedInstantMessage, blockingIssues: string[], summary: string[] = []): InstantRegistrationPreview {
  return {
    fingerprint: parsed.fingerprint,
    kind: parsed.kind,
    kindLabel: kindLabel(parsed.kind),
    actionLabel: actionLabel(parsed.kind),
    ready: false,
    duplicate: false,
    warnings: [...parsed.warnings],
    blockingIssues,
    summary,
    parsed,
    matches: {},
  };
}

async function currenciesByCode(tx: Prisma.TransactionClient) {
  const currencies = await tx.currency.findMany({
    where: { isActive: true, code: { in: ['USD', 'LYD'] } },
    select: { id: true, code: true, name: true, symbol: true },
  });
  return new Map(currencies.map((currency) => [currency.code as InstantCurrencyCode, currency as CurrencyRow]));
}

function currencyOrThrow(currencies: Map<InstantCurrencyCode, CurrencyRow>, code: InstantCurrencyCode) {
  const currency = currencies.get(code);
  if (!currency) throw new Error('INVALID_CURRENCY');
  return currency;
}

async function nextCustomerNo(tx: Prisma.TransactionClient) {
  const total = await tx.person.count();

  for (let index = total + 1; index < total + 100000; index += 1) {
    const customerNo = `#${String(index).padStart(4, '0')}`;
    const exists = await tx.person.findFirst({ where: { customerNo } });
    if (!exists) return customerNo;
  }

  throw new Error('CUSTOMER_CODE_FAILED');
}

async function nextCardCodes(tx: Prisma.TransactionClient, count: number) {
  const total = await tx.receivedCustomerCard.count();
  const codes: string[] = [];
  let cursor = total + 1;

  while (codes.length < count) {
    const candidateCount = Math.max((count - codes.length) * 2, 100);
    const candidates = Array.from({ length: candidateCount }, (_, offset) => `#C${String(cursor + offset).padStart(4, '0')}`);
    const existing = new Set(
      (
        await tx.receivedCustomerCard.findMany({
          where: { publicCode: { in: candidates } },
          select: { publicCode: true },
        })
      )
        .map((item) => item.publicCode)
        .filter(Boolean),
    );

    for (const candidate of candidates) {
      if (!existing.has(candidate)) codes.push(candidate);
      if (codes.length === count) break;
    }

    cursor += candidateCount;
    if (cursor > total + 100000) throw new Error('CARD_CODE_FAILED');
  }

  return codes;
}

async function findMatchingPerson(
  tx: Prisma.TransactionClient,
  criteria: { personName?: string | null; phone?: string | null; customerCode?: string | null },
) {
  const OR: Prisma.PersonWhereInput[] = [];
  const phone = criteria.phone?.trim();
  const customerCode = criteria.customerCode?.trim();
  const personName = criteria.personName?.trim();

  if (phone) OR.push({ phone: { contains: phone } });
  if (customerCode) {
    OR.push({ customerNo: { equals: customerCode, mode: 'insensitive' } });
    OR.push({ externalId: { equals: customerCode, mode: 'insensitive' } });
  }
  if (personName) {
    OR.push({ fullName: { equals: personName, mode: 'insensitive' } });
    OR.push({ fullName: { contains: personName, mode: 'insensitive' } });
  }
  if (!OR.length) return null;

  const people = await tx.person.findMany({
    where: { deletedAt: null, status: 'ACTIVE', OR },
    select: { id: true, customerNo: true, fullName: true, phone: true, externalId: true, createdAt: true },
    take: 8,
  });
  if (!people.length) return null;

  const normalizedName = normalizeComparable(personName);
  const normalizedCode = normalizeComparable(customerCode);
  const exact =
    people.find((person) => phone && normalizeComparable(person.phone) === normalizeComparable(phone)) ||
    people.find((person) => normalizedCode && [person.customerNo, person.externalId].some((value) => normalizeComparable(value) === normalizedCode)) ||
    people.find((person) => normalizedName && normalizeComparable(person.fullName) === normalizedName);

  return exact || people[0];
}

async function findOrCreatePerson(
  tx: Prisma.TransactionClient,
  criteria: { personName?: string | null; phone?: string | null; customerCode?: string | null; notes?: string | null },
  allowCreate: boolean,
) {
  const existing = await findMatchingPerson(tx, criteria);
  if (existing) return { person: existing, created: false };
  if (!allowCreate || !criteria.personName?.trim()) throw new Error('PERSON_NOT_FOUND');

  const person = await tx.person.create({
    data: {
      customerNo: await nextCustomerNo(tx),
      fullName: criteria.personName.trim(),
      phone: criteria.phone?.trim() || null,
      externalId: criteria.customerCode?.trim() || null,
      notes: criteria.notes || null,
      category: 'REGULAR',
    },
    select: { id: true, customerNo: true, fullName: true, phone: true, externalId: true, createdAt: true },
  });

  return { person, created: true };
}

async function findCardsByLast4(tx: Prisma.TransactionClient, cardLast4?: string | null) {
  if (!cardLast4) return [];
  return tx.receivedCustomerCard.findMany({
    where: { deletedAt: null, cardLast4 },
    include: {
      batch: { include: { person: true, currency: true } },
      settlementCurrency: true,
      operations: {
        where: { deletedAt: null },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: 20,
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 8,
  });
}

async function findSingleCard(tx: Prisma.TransactionClient, cardLast4?: string | null) {
  const cards = await findCardsByLast4(tx, cardLast4);
  if (!cards.length) throw new Error('CARD_NOT_FOUND');
  if (cards.length > 1) throw new Error('CARD_AMBIGUOUS');
  return cards[0];
}

function currentCardRemaining(card: any) {
  if (card.remainingAmount !== undefined && card.remainingAmount !== null) return D(card.remainingAmount);
  const base = cardBaseAmount(card.valueUsd, card.agreedAmount);
  const deducted = D(card.totalDeducted ?? card.receivedAmount ?? 0);
  const remaining = base.sub(deducted);
  return remaining.gt(0) ? remaining : D(0);
}

function operationPlanForWithdrawal(amount: InstantAmount, quantity: number) {
  const category = defaultCardDiscountCategories.find(
    (item) => Math.abs(Number(item.deductionAmount) - amount.value) < 0.000001,
  );
  if (category) {
    return {
      operationType: 'GIFT_CARD',
      categoryCode: category.code,
      quantity,
      amount: D(Number(category.deductionAmount) * quantity),
      unitAmount: D(category.deductionAmount),
    };
  }

  return {
    operationType: 'INVOICE',
    categoryCode: null,
    quantity: 1,
    amount: D(amount.value * quantity),
    unitAmount: D(amount.value),
  };
}

function ensureWalletStateRow(state: Map<string, WalletStateRow>, paymentMethod: string) {
  const existing = state.get(paymentMethod);
  if (existing) return existing;

  const row = {
    paymentMethod,
    CREDIT: D(0),
    DEBT: D(0),
  };
  state.set(paymentMethod, row);
  return row;
}

function totalWalletSide(state: Map<string, WalletStateRow>, accountType: WalletAccountType) {
  let total = D(0);
  for (const row of state.values()) total = total.add(row[accountType]);
  return total;
}

function decimalMin(left: Prisma.Decimal, right: Prisma.Decimal) {
  return left.lt(right) ? left : right;
}

async function buildCurrencyWalletState(tx: Prisma.TransactionClient, personId: string, currencyId: string) {
  const [transactions, settlements] = await Promise.all([
    tx.financialTransaction.findMany({
      where: { personId, deletedAt: null },
      include: { currency: true },
    }),
    tx.customerWalletSettlement.findMany({
      where: { personId, deletedAt: null },
      include: { currency: true },
    }),
  ]);
  const state = new Map<string, WalletStateRow>();

  for (const transaction of transactions) {
    const effect = transactionWalletEffect(transaction);
    if (!effect || effect.currencyId !== currencyId) continue;
    const row = ensureWalletStateRow(state, effect.paymentMethod);
    row[effect.accountType] = row[effect.accountType].add(effect.amount);
  }

  for (const settlement of settlements) {
    if (settlement.deletedAt || settlement.currencyId !== currencyId) continue;
    const row = ensureWalletStateRow(state, settlement.paymentMethod);
    const accountType = settlement.accountType as WalletAccountType;
    row[accountType] =
      settlement.direction === 'ADD' ? row[accountType].add(D(settlement.amount)) : row[accountType].sub(D(settlement.amount));
  }

  return { state, transactions, settlements };
}

async function createAuditEntry(
  tx: Prisma.TransactionClient,
  session: InstantSession,
  input: {
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    description: string;
    oldValue?: unknown;
    newValue?: unknown;
  },
) {
  return tx.auditLog.create({
    data: {
      userId: session.userId || null,
      username: session.username || null,
      sessionId: session.id,
      action: input.action,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      oldValue: input.oldValue === undefined ? undefined : (jsonValue(input.oldValue) as any),
      newValue: input.newValue === undefined ? undefined : (jsonValue(input.newValue) as any),
      description: input.description,
    },
  });
}

async function createWalletMovement(
  tx: Prisma.TransactionClient,
  session: InstantSession,
  input: {
    personId: string;
    currency: CurrencyRow;
    paymentMethod?: string | null;
    accountType: WalletAccountType;
    direction: WalletSettlementDirection;
    amount: Prisma.Decimal;
    reason: string;
    note?: string | null;
    movementKind?: string;
    effectMode?: 'NORMAL' | 'OFFSET';
  },
) {
  const paymentMethod = normalizeWalletPaymentMethod(
    input.paymentMethod || defaultPaymentByCurrency[input.currency.code as InstantCurrencyCode],
    input.currency.code,
  );
  const { state, transactions, settlements } = await buildCurrencyWalletState(tx, input.personId, input.currency.id);
  const debtBeforeTotal = totalWalletSide(state, 'DEBT');
  const creditBeforeTotal = totalWalletSide(state, 'CREDIT');
  const legacyBalanceBefore = walletAccountAmount(
    transactions,
    settlements,
    input.currency.id,
    paymentMethod,
    input.accountType,
  );

  previewWalletOperation({
    debtBefore: debtBeforeTotal,
    creditBefore: creditBeforeTotal,
    amount: input.amount,
    accountType: input.accountType,
    direction: input.direction,
    effectMode: input.effectMode || 'OFFSET',
  });

  async function createMovement(data: {
    accountType: WalletAccountType;
    direction: WalletSettlementDirection;
    amount: Prisma.Decimal;
    paymentMethod: string;
    reason: string;
    note?: string | null;
    movementKind: string;
    settlementMethod?: string | null;
    linkedSettlementId?: string | null;
  }) {
    if (data.amount.lte(0)) throw new Error('INVALID_WALLET_AMOUNT');

    const row = ensureWalletStateRow(state, data.paymentMethod);
    const balanceBefore = row[data.accountType];
    const balanceAfter = data.direction === 'ADD' ? balanceBefore.add(data.amount) : balanceBefore.sub(data.amount);
    if (balanceAfter.lt(0)) throw new Error('NEGATIVE_WALLET_BALANCE');

    const created = await tx.customerWalletSettlement.create({
      data: {
        personId: input.personId,
        currencyId: input.currency.id,
        paymentMethod: data.paymentMethod,
        accountType: data.accountType,
        direction: data.direction,
        amount: data.amount,
        balanceBefore,
        balanceAfter,
        reason: data.reason,
        note: data.note || null,
        movementKind: data.movementKind,
        linkedSettlementId: data.linkedSettlementId || null,
        settlementMethod: data.settlementMethod || null,
        userId: session.userId || null,
        username: session.username || null,
      },
      include: { currency: true, person: true },
    });

    row[data.accountType] = balanceAfter;
    return created;
  }

  const created = await createMovement({
    accountType: input.accountType,
    direction: input.direction,
    amount: input.amount,
    paymentMethod,
    reason: input.reason,
    note: input.note || null,
    movementKind: input.movementKind || 'ADJUSTMENT',
    settlementMethod: input.effectMode === 'OFFSET' ? 'OFFSET' : null,
  });

  if ((input.movementKind || 'ADJUSTMENT') === 'REPAYMENT') {
    await tx.customerAccountRepayment.create({
      data: {
        settlementId: created.id,
        personId: input.personId,
        currencyId: input.currency.id,
        paymentMethod,
        accountType: input.accountType,
        amount: input.amount,
        balanceBefore: created.balanceBefore,
        balanceAfter: created.balanceAfter,
        reason: input.reason,
        note: input.note || null,
        userId: session.userId || null,
        username: session.username || null,
      },
    });
  }

  const linkedSettlements: Awaited<ReturnType<typeof createMovement>>[] = [];
  if ((input.effectMode || 'OFFSET') === 'OFFSET') {
    const offsetAmount = decimalMin(totalWalletSide(state, 'DEBT'), totalWalletSide(state, 'CREDIT'));

    async function subtractAcross(accountType: WalletAccountType, amount: Prisma.Decimal) {
      let remaining = amount;
      const rows = Array.from(state.values())
        .filter((row) => row[accountType].gt(0))
        .sort((left, right) => {
          if (left.paymentMethod === paymentMethod) return -1;
          if (right.paymentMethod === paymentMethod) return 1;
          return right[accountType].cmp(left[accountType]);
        });

      for (const row of rows) {
        if (remaining.lte(0)) break;
        const amountToSubtract = decimalMin(row[accountType], remaining);
        linkedSettlements.push(
          await createMovement({
            accountType,
            direction: 'SUBTRACT',
            amount: amountToSubtract,
            paymentMethod: row.paymentMethod,
            reason: 'تسوية تلقائية من التسجيل الفوري',
            note: input.note || null,
            movementKind: 'AUTO_OFFSET',
            linkedSettlementId: created.id,
            settlementMethod: 'OFFSET',
          }),
        );
        remaining = remaining.sub(amountToSubtract);
      }

      if (remaining.gt(0)) throw new Error('NEGATIVE_WALLET_BALANCE');
    }

    if (offsetAmount.gt(0)) {
      await subtractAcross('DEBT', offsetAmount);
      await subtractAcross('CREDIT', offsetAmount);
    }
  }

  await createAuditEntry(tx, session, {
    action: 'CUSTOMER_WALLET_SETTLEMENT_CREATE',
    entityType: 'CustomerWalletSettlement',
    entityId: created.id,
    oldValue: {
      personId: input.personId,
      currencyId: input.currency.id,
      paymentMethod,
      accountType: input.accountType,
      balance: legacyBalanceBefore.toString(),
      debtTotal: debtBeforeTotal.toString(),
      creditTotal: creditBeforeTotal.toString(),
    },
    newValue: { created, linkedSettlements },
    description: `${input.reason} عن طريق التسجيل الفوري`,
  });

  return { created, linkedSettlements };
}

async function customerDeliveryBalance(tx: Prisma.TransactionClient, personId: string, currencyId: string) {
  const [cards, deliveries] = await Promise.all([
    tx.receivedCustomerCard.findMany({
      where: {
        deletedAt: null,
        status: { not: 'CANCELLED' },
        batch: { personId },
      },
      include: { batch: true },
    }),
    tx.customerCardDelivery.findMany({
      where: { personId, currencyId, deletedAt: null },
    }),
  ]);

  const totalAgreed = cards.reduce((sum, card) => {
    const cardCurrencyId = card.settlementCurrencyId || card.batch.currencyId;
    if (cardCurrencyId !== currencyId) return sum;
    return sum.add(card.agreedAmount);
  }, D(0));
  const delivered = deliveries.reduce((sum, delivery) => sum.add(delivery.amount), D(0));

  return {
    totalAgreed,
    delivered,
    remaining: totalAgreed.sub(delivered),
  };
}

async function createCustomerDelivery(
  tx: Prisma.TransactionClient,
  session: InstantSession,
  input: {
    personId: string;
    currency: CurrencyRow;
    amount: Prisma.Decimal;
    paymentMethod?: string | null;
    note?: string | null;
  },
) {
  const balance = await customerDeliveryBalance(tx, input.personId, input.currency.id);
  const balanceAfter = balance.remaining.sub(input.amount);
  if (input.amount.lte(0)) throw new Error('INVALID_DELIVERY_AMOUNT');
  if (balanceAfter.lt(0)) throw new Error('DELIVERY_OVER_REMAINING');

  const delivery = await tx.customerCardDelivery.create({
    data: {
      personId: input.personId,
      currencyId: input.currency.id,
      paymentMethod: input.paymentMethod || null,
      amount: input.amount,
      balanceBefore: balance.remaining,
      balanceAfter,
      reason: 'CUSTOMER_CARD_DELIVERY',
      note: input.note || 'التسجيل الفوري',
      userId: session.userId || null,
      username: session.username || null,
    },
    include: { person: true, currency: true },
  });

  await createAuditEntry(tx, session, {
    action: 'CUSTOMER_CARD_DELIVERY_CREATE',
    entityType: 'CustomerCardDelivery',
    entityId: delivery.id,
    newValue: delivery,
    description: 'تسجيل تسليم مبلغ للزبون عن طريق التسجيل الفوري',
  });

  return delivery;
}

async function assertFingerprintUnused(tx: Prisma.TransactionClient, fingerprint: string) {
  const existing = await tx.auditLog.findFirst({
    where: { action: instantExecuteAction, description: { contains: `fingerprint:${fingerprint}` } },
    select: { id: true },
  });
  if (existing) throw new Error('INSTANT_DUPLICATE');
}

async function duplicateAudit(tx: Prisma.TransactionClient, fingerprint: string) {
  return tx.auditLog.findFirst({
    where: { action: instantExecuteAction, description: { contains: `fingerprint:${fingerprint}` } },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function previewRepaymentTarget(
  tx: Prisma.TransactionClient,
  personId: string,
  currencyCode?: InstantCurrencyCode,
  amount?: InstantAmount,
) {
  const [person, currencies] = await Promise.all([
    tx.person.findUnique({
      where: { id: personId },
      include: {
        transactions: { where: { deletedAt: null }, include: { currency: true } },
        walletSettlements: { where: { deletedAt: null }, include: { currency: true } },
      },
    }),
    tx.currency.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, symbol: true } }),
  ]);
  if (!person) return { target: null, blockingIssue: 'الزبون غير موجود.' };

  const snapshot = buildWalletSnapshot(person.transactions, person.walletSettlements, currencies);
  const candidates = snapshot.rows.flatMap((row) => {
    if (currencyCode && row.currency.code !== currencyCode) return [];
    const rows: Array<{ accountType: WalletAccountType; paymentMethod: string; balance: number; currency: CurrencyRow }> = [];
    if (row.debt > 0) rows.push({ accountType: 'DEBT', paymentMethod: row.paymentMethod, balance: row.debt, currency: row.currency as CurrencyRow });
    if (row.credit > 0) rows.push({ accountType: 'CREDIT', paymentMethod: row.paymentMethod, balance: row.credit, currency: row.currency as CurrencyRow });
    return rows;
  });

  if (!candidates.length) return { target: null, blockingIssue: 'لا يوجد دين مفتوح لهذا الزبون بنفس العملة.' };

  const exact = amount ? candidates.filter((candidate) => Math.abs(candidate.balance - amount.value) < 0.000001) : [];
  const narrowed = exact.length === 1 ? exact : candidates;
  if (narrowed.length > 1) return { target: null, blockingIssue: 'يوجد أكثر من دين مفتوح. حدد العملة أو المبلغ بشكل أوضح.' };
  if (amount && amount.value > narrowed[0].balance) return { target: narrowed[0], blockingIssue: 'مبلغ السداد أكبر من الدين الحالي.' };

  return { target: narrowed[0], blockingIssue: '' };
}

async function buildCardEntryPreview(tx: Prisma.TransactionClient, parsed: ParsedCardEntry, duplicate: boolean) {
  const person = await findMatchingPerson(tx, parsed);
  const blockingIssues: string[] = [];
  const warnings = [...parsed.warnings];
  const summary: string[] = [];
  const duplicateCards: string[] = [];

  if (!parsed.personName && !person) blockingIssues.push('لم يتم تحديد اسم الزبون.');
  if (!parsed.cards.length) blockingIssues.push('لم يتم العثور على بيانات بطاقة.');

  const last4s = parsed.cards.map((card) => card.cardLast4).filter((value): value is string => Boolean(value));
  const duplicateInside = last4s.find((value, index) => last4s.indexOf(value) !== index);
  if (duplicateInside) blockingIssues.push(`آخر 4 أرقام مكررة داخل نفس الرسالة: ${duplicateInside}.`);

  for (const card of parsed.cards) {
    if (!card.cardLast4) blockingIssues.push('إحدى البطاقات بدون آخر 4 أرقام.');
    if (!card.agreedAmount || card.agreedAmount.value <= 0) blockingIssues.push(`البطاقة ${card.cardLast4 || ''} بدون مبلغ متفق واضح.`);
  }

  if (person && last4s.length) {
    const existingCards = await tx.receivedCustomerCard.findMany({
      where: { deletedAt: null, cardLast4: { in: last4s }, batch: { personId: person.id } },
      select: { cardLast4: true },
    });
    duplicateCards.push(...existingCards.map((card) => card.cardLast4).filter(Boolean) as string[]);
    if (duplicateCards.length) blockingIssues.push(`هذه البطاقة/العملية تبدو مسجلة مسبقًا: ${duplicateCards.join(', ')}.`);
  }

  summary.push(person ? `تم العثور على زبون موجود: ${personLabel(person)}.` : `سيتم إنشاء زبون جديد: ${parsed.personName || 'بدون اسم'}.`);
  if (parsed.phone) summary.push(`الهاتف: ${parsed.phone}.`);
  if (parsed.customerCode) summary.push(`الكود: ${parsed.customerCode}.`);
  if (parsed.bankName) summary.push(`النوع: ${parsed.bankName}.`);
  summary.push(`${parsed.cards.length} بطاقة.`);
  for (const card of parsed.cards) {
    const received = card.receivedAmount ? amountLabel(card.receivedAmount) : '0 $';
    const remaining =
      card.agreedAmount && card.receivedAmount
        ? amountLabel({ ...card.agreedAmount, value: Math.max(card.agreedAmount.value - card.receivedAmount.value, 0) })
        : '';
    summary.push(
      `${card.cardLast4 || 'آخر 4 غير محددة'} | القيمة ${amountLabel(card.valueAmount) || 'غير محددة'} | المتفق ${amountLabel(card.agreedAmount) || 'غير محدد'} | المستلم ${received}${remaining ? ` | المتبقي ${remaining}` : ''}`,
    );
  }

  if (duplicate) blockingIssues.push('هذه الرسالة تم تنفيذها سابقًا.');

  return {
    fingerprint: parsed.fingerprint,
    kind: parsed.kind,
    kindLabel: kindLabel(parsed.kind),
    actionLabel: actionLabel(parsed.kind),
    ready: blockingIssues.length === 0,
    duplicate,
    warnings,
    blockingIssues,
    summary,
    parsed,
    matches: {
      person: person ? { ...person, existing: true } : null,
      duplicateCards,
    },
  } satisfies InstantRegistrationPreview;
}

async function buildCardLookupPreview(
  tx: Prisma.TransactionClient,
  parsed: ParsedCardWithdrawal | ParsedCardFinalSettlement | ParsedCardStatus,
  duplicate: boolean,
) {
  const blockingIssues: string[] = [];
  const warnings = [...parsed.warnings];
  const summary: string[] = [];
  const cards = await findCardsByLast4(tx, parsed.cardLast4);
  const card = cards.length === 1 ? cards[0] : null;

  if (!parsed.cardLast4) blockingIssues.push('لم يتم تحديد البطاقة.');
  if (!cards.length && parsed.cardLast4) blockingIssues.push(`لم يتم العثور على بطاقة ${parsed.cardLast4}.`);
  if (cards.length > 1) blockingIssues.push(`يوجد أكثر من بطاقة بنفس آخر 4 أرقام (${parsed.cardLast4}). افتح الزبون وحدد البطاقة يدويًا.`);
  if (duplicate) blockingIssues.push('هذه الرسالة تم تنفيذها سابقًا.');

  if (card) {
    summary.push(`الزبون: ${personLabel(card.batch?.person)}.`);
    summary.push(`البطاقة: ${cardDisplay(card)}.`);
    summary.push(`المتبقي الحالي: ${currentCardRemaining(card).toString()} $.`);
  }

  if (parsed.kind === 'CARD_WITHDRAWAL') {
    if (!parsed.amount || parsed.amount.value <= 0) blockingIssues.push('لم يتم تحديد مبلغ السحبة.');
    if (parsed.amount) {
      const plan = operationPlanForWithdrawal(parsed.amount, parsed.quantity);
      summary.push(`سحبة جديدة: ${amountLabel(parsed.amount)}${parsed.quantity > 1 ? ` × ${parsed.quantity} = ${plan.amount.toString()} $` : ''}.`);
      if (card && plan.amount.gt(currentCardRemaining(card))) blockingIssues.push('مبلغ السحب أكبر من المتبقي في البطاقة.');
      if (
        card?.operations?.some(
          (operation: any) =>
            operation.operationType === plan.operationType &&
            String(operation.categoryCode || '') === String(plan.categoryCode || '') &&
            Number(operation.quantity || 1) === plan.quantity &&
            D(operation.amount || 0).equals(plan.amount),
        )
      ) {
        blockingIssues.push('هذه السحبة تبدو مسجلة مسبقًا على نفس البطاقة.');
      }
    }
  }

  if (parsed.kind === 'CARD_FINAL_SETTLEMENT') {
    summary.push('الحالة الجديدة: مصفاة بالكامل.');
    if (card && ['SETTLED', 'COMPLETED'].includes(card.status)) blockingIssues.push('هذه البطاقة مصفاة بالفعل.');
  }

  if (parsed.kind === 'CARD_STATUS') {
    summary.push(`الحالة الجديدة: ${parsed.status === 'REJECTED' ? 'مرفوضة' : 'متوقفة'}.`);
    if (parsed.reason) summary.push(`السبب: ${parsed.reason}.`);
    if (!parsed.reason) blockingIssues.push('اكتب سبب الإيقاف أو الرفض.');
  }

  return {
    fingerprint: parsed.fingerprint,
    kind: parsed.kind,
    kindLabel: kindLabel(parsed.kind),
    actionLabel: actionLabel(parsed.kind),
    ready: blockingIssues.length === 0,
    duplicate,
    warnings,
    blockingIssues,
    summary,
    parsed,
    matches: {
      card: card
        ? {
            id: card.id,
            cardLast4: card.cardLast4,
            publicCode: card.publicCode,
            status: card.status,
            remainingAmount: currentCardRemaining(card).toString(),
            personName: card.batch?.person?.fullName,
          }
        : null,
    },
  } satisfies InstantRegistrationPreview;
}

async function buildDeliveryPreview(tx: Prisma.TransactionClient, parsed: ParsedCustomerDelivery, duplicate: boolean) {
  const blockingIssues: string[] = [];
  const warnings = [...parsed.warnings];
  const summary: string[] = [];
  let person = parsed.personName ? await findMatchingPerson(tx, parsed) : null;
  let card: any = null;

  if (!person && parsed.cardLast4) {
    const cards = await findCardsByLast4(tx, parsed.cardLast4);
    if (cards.length === 1) {
      card = cards[0];
      person = card.batch?.person || null;
    } else if (cards.length > 1) {
      blockingIssues.push(`يوجد أكثر من بطاقة بنفس آخر 4 أرقام (${parsed.cardLast4}).`);
    }
  }

  if (!person) blockingIssues.push('لم يتم العثور على الزبون.');
  if (!parsed.amount || parsed.amount.value <= 0) blockingIssues.push('لم يتم تحديد المبلغ المستلم.');
  if (duplicate) blockingIssues.push('هذه الرسالة تم تنفيذها سابقًا.');

  summary.push(person ? `تم العثور على ${personLabel(person)}.` : `الزبون: ${parsed.personName || 'غير محدد'}.`);
  if (card) summary.push(`من بطاقة: ${cardDisplay(card)}.`);
  if (parsed.amount) summary.push(`إضافة مبلغ مستلم: ${amountLabel(parsed.amount)}.`);

  if (person && parsed.amount) {
    const currencies = await currenciesByCode(tx);
    const currency = currencies.get(parsed.amount.currencyCode);
    if (currency) {
      const balance = await customerDeliveryBalance(tx, person.id, currency.id);
      summary.push(`المتبقي قبل الاستلام: ${balance.remaining.toString()} ${currency.symbol || currency.code}.`);
      if (D(parsed.amount.value).gt(balance.remaining)) blockingIssues.push('المبلغ المستلم أكبر من المتبقي لهذا الزبون.');
    }
  }

  return {
    fingerprint: parsed.fingerprint,
    kind: parsed.kind,
    kindLabel: kindLabel(parsed.kind),
    actionLabel: actionLabel(parsed.kind),
    ready: blockingIssues.length === 0,
    duplicate,
    warnings,
    blockingIssues,
    summary,
    parsed,
    matches: {
      person: person ? { ...person, existing: true } : null,
      card: card
        ? {
            id: card.id,
            cardLast4: card.cardLast4,
            publicCode: card.publicCode,
            status: card.status,
            remainingAmount: currentCardRemaining(card).toString(),
            personName: card.batch?.person?.fullName,
          }
        : null,
    },
  } satisfies InstantRegistrationPreview;
}

async function buildWalletMovementPreview(tx: Prisma.TransactionClient, parsed: ParsedWalletMovement, duplicate: boolean) {
  const blockingIssues: string[] = [];
  const warnings = [...parsed.warnings];
  const person = await findMatchingPerson(tx, parsed);
  const summary: string[] = [];

  if (!parsed.personName) blockingIssues.push('لم يتم تحديد اسم صاحب الدين.');
  if (!parsed.amount || parsed.amount.value <= 0) blockingIssues.push('لم يتم تحديد مبلغ الدين.');
  if (duplicate) blockingIssues.push('هذه الرسالة تم تنفيذها سابقًا.');

  summary.push(person ? `تم العثور على زبون موجود: ${personLabel(person)}.` : `سيتم إنشاء زبون جديد: ${parsed.personName || 'غير محدد'}.`);
  summary.push(parsed.side === 'US' ? 'القسم: لنا.' : 'القسم: علينا.');
  if (parsed.amount) summary.push(`المبلغ: ${amountLabel(parsed.amount)}.`);

  return {
    fingerprint: parsed.fingerprint,
    kind: parsed.kind,
    kindLabel: kindLabel(parsed.kind),
    actionLabel: actionLabel(parsed.kind),
    ready: blockingIssues.length === 0,
    duplicate,
    warnings,
    blockingIssues,
    summary,
    parsed,
    matches: {
      person: person ? { ...person, existing: true } : null,
    },
  } satisfies InstantRegistrationPreview;
}

async function buildWalletRepaymentPreview(tx: Prisma.TransactionClient, parsed: ParsedWalletRepayment, duplicate: boolean) {
  const blockingIssues: string[] = [];
  const warnings = [...parsed.warnings];
  const person = await findMatchingPerson(tx, parsed);
  const summary: string[] = [];
  let repaymentTarget: PreviewMatch['repaymentTarget'] = null;

  if (!person) blockingIssues.push('لم يتم العثور على صاحب الدين.');
  if (!parsed.amount || parsed.amount.value <= 0) blockingIssues.push('لم يتم تحديد مبلغ السداد.');
  if (duplicate) blockingIssues.push('هذه الرسالة تم تنفيذها سابقًا.');

  if (person && parsed.amount) {
    const { target, blockingIssue } = await previewRepaymentTarget(tx, person.id, parsed.amount.currencyCode, parsed.amount);
    repaymentTarget = target;
    if (blockingIssue) blockingIssues.push(blockingIssue);
  }

  summary.push(person ? `تم العثور على ${personLabel(person)}.` : `صاحب الدين: ${parsed.personName || 'غير محدد'}.`);
  if (repaymentTarget) {
    summary.push(`الدين الحالي: ${repaymentTarget.balance.toLocaleString('en-US')} ${repaymentTarget.currency.symbol || repaymentTarget.currency.code}.`);
    summary.push(`القسم: ${repaymentTarget.accountType === 'DEBT' ? 'لنا' : 'علينا'}.`);
  }
  if (parsed.amount) summary.push(`المبلغ المدفوع: ${amountLabel(parsed.amount)}.`);

  return {
    fingerprint: parsed.fingerprint,
    kind: parsed.kind,
    kindLabel: kindLabel(parsed.kind),
    actionLabel: actionLabel(parsed.kind),
    ready: blockingIssues.length === 0,
    duplicate,
    warnings,
    blockingIssues,
    summary,
    parsed,
    matches: {
      person: person ? { ...person, existing: true } : null,
      repaymentTarget,
    },
  } satisfies InstantRegistrationPreview;
}

export async function buildInstantRegistrationPreview(text: string): Promise<InstantRegistrationPreview> {
  const parsed = parseInstantMessage(text);
  if (parsed.kind === 'UNKNOWN') return createBlockingPreview(parsed, ['لم أستطع فهم نوع العملية من الرسالة.']);

  return db.$transaction(async (tx) => {
    const duplicate = Boolean(await duplicateAudit(tx, parsed.fingerprint));

    if (parsed.kind === 'CARD_ENTRY') return buildCardEntryPreview(tx, parsed, duplicate);
    if (parsed.kind === 'CUSTOMER_DELIVERY') return buildDeliveryPreview(tx, parsed, duplicate);
    if (parsed.kind === 'CARD_WITHDRAWAL' || parsed.kind === 'CARD_FINAL_SETTLEMENT' || parsed.kind === 'CARD_STATUS') {
      return buildCardLookupPreview(tx, parsed, duplicate);
    }
    if (parsed.kind === 'WALLET_MOVEMENT') return buildWalletMovementPreview(tx, parsed, duplicate);
    if (parsed.kind === 'WALLET_REPAYMENT') return buildWalletRepaymentPreview(tx, parsed, duplicate);

    return createBlockingPreview(parsed, ['لم أستطع فهم نوع العملية من الرسالة.']);
  });
}

async function executeCardEntry(tx: Prisma.TransactionClient, session: InstantSession, parsed: ParsedCardEntry) {
  const currencies = await currenciesByCode(tx);
  const { person, created } = await findOrCreatePerson(tx, parsed, true);
  const last4s = parsed.cards.map((card) => card.cardLast4).filter((value): value is string => Boolean(value));
  if (!last4s.length) throw new Error('PREVIEW_NOT_READY');

  const duplicateInside = last4s.find((value, index) => last4s.indexOf(value) !== index);
  if (duplicateInside) throw new Error('DUPLICATE_LAST4_IN_BATCH');

  const duplicateCards = await tx.receivedCustomerCard.findMany({
    where: { deletedAt: null, cardLast4: { in: last4s }, batch: { personId: person.id } },
    select: { cardLast4: true },
  });
  if (duplicateCards.length) throw new Error('CARD_ALREADY_EXISTS');

  const firstCard = parsed.cards[0];
  const firstCurrency = currencyOrThrow(
    currencies,
    firstCard.agreedAmount?.currencyCode || firstCard.valueAmount?.currencyCode || 'USD',
  );
  const receivedAt = new Date();
  const publicCodes = await nextCardCodes(tx, parsed.cards.length);

  const preparedCards = parsed.cards.map((card, index) => {
    if (!card.cardLast4 || !card.agreedAmount || card.agreedAmount.value <= 0) throw new Error('PREVIEW_NOT_READY');
    const currency = currencyOrThrow(currencies, card.agreedAmount.currencyCode || firstCurrency.code as InstantCurrencyCode);
    const valueUsd = D(card.valueAmount?.value ?? 2000);
    const agreedAmount = D(card.agreedAmount.value);
    const baseAmount = cardBaseAmount(valueUsd, agreedAmount);

    return {
      sequence: index + 1,
      publicCode: publicCodes[index],
      cardLast4: card.cardLast4,
      bankName: card.bankName || parsed.bankName || null,
      valueUsd,
      agreedAmount,
      baseAmount,
      currency,
      notes: card.notes || null,
    };
  });

  const totalOriginalAmount = preparedCards.reduce((sum, card) => sum.add(card.baseAmount), D(0));
  const totalAgreedAmount = preparedCards.reduce((sum, card) => sum.add(card.agreedAmount), D(0));

  const entryTransaction = await tx.customerCardEntryTransaction.create({
    data: {
      personId: person.id,
      currencyId: firstCurrency.id,
      cardCount: preparedCards.length,
      totalOriginalAmount,
      totalAgreedAmount,
      duplicateWarnings: [],
      notes: `التسجيل الفوري fingerprint:${parsed.fingerprint}`,
      userId: session.userId || null,
      username: session.username || null,
      occurredAt: receivedAt,
    },
  });

  const batch = await tx.receivedCardBatch.create({
    data: {
      personId: person.id,
      currencyId: firstCurrency.id,
      entryTransactionId: entryTransaction.id,
      receivedAt,
      cardCount: preparedCards.length,
      agreedAmountPerCard: preparedCards[0].agreedAmount,
      totalOriginalAmount,
      totalAgreedAmount,
      notes: `التسجيل الفوري fingerprint:${parsed.fingerprint}`,
      createdByUserId: session.userId || null,
      createdByUsername: session.username || null,
    },
  });

  await tx.receivedCustomerCard.createMany({
    data: preparedCards.map((card) => ({
      batchId: batch.id,
      sequence: card.sequence,
      publicCode: card.publicCode,
      bankName: card.bankName,
      cardLast4: card.cardLast4,
      valueUsd: card.valueUsd,
      agreedAmount: card.agreedAmount,
      settlementCurrencyId: card.currency.id,
      settlementPaymentMethod: null,
      receivedAmount: D(0),
      totalDeducted: D(0),
      remainingAmount: card.baseAmount,
      progressPercent: cardProgressPercent(card.baseAmount, 0),
      status: 'RECEIVED',
      verificationReceived: false,
      notes: card.notes,
    })),
  });

  const createdCards = await tx.receivedCustomerCard.findMany({
    where: { batchId: batch.id },
    select: { id: true, cardLast4: true, publicCode: true },
    orderBy: { sequence: 'asc' },
  });

  const deliveryIds: string[] = [];
  const deliveryAmount = parsed.deliveryAmount || parsed.cards.find((card) => card.receivedAmount && card.receivedAmount.value > 0)?.receivedAmount;
  if (deliveryAmount && deliveryAmount.value > 0) {
    const deliveryCurrency = currencyOrThrow(currencies, deliveryAmount.currencyCode);
    const delivery = await createCustomerDelivery(tx, session, {
      personId: person.id,
      currency: deliveryCurrency,
      amount: D(deliveryAmount.value),
      note: `استلام مبلغ من التسجيل الفوري fingerprint:${parsed.fingerprint}`,
    });
    deliveryIds.push(delivery.id);
  }

  if (created) {
    await createAuditEntry(tx, session, {
      action: 'PERSON_CREATE',
      entityType: 'Person',
      entityId: person.id,
      newValue: person,
      description: `تم إنشاء الزبون ${person.fullName} عن طريق التسجيل الفوري`,
    });
  }

  await createAuditEntry(tx, session, {
    action: 'RECEIVED_CARD_BATCH_CREATE',
    entityType: 'ReceivedCardBatch',
    entityId: batch.id,
    newValue: { batch, cards: createdCards },
    description: `تم إضافة ${createdCards.length} بطاقة عن طريق التسجيل الفوري`,
  });

  return {
    message: created
      ? 'تم تسجيل الزبون والبطاقة بنجاح'
      : `تم إضافة البيانات إلى الزبون الموجود: ${person.fullName}`,
    fingerprint: parsed.fingerprint,
    undoAvailable: true,
    affectedPaths: ['/people', `/people/${person.id}`, '/inventory/received-cards', '/dashboard'],
    createdPersonId: created ? person.id : undefined,
    createdBatchId: batch.id,
    createdCardIds: createdCards.map((card) => card.id),
    createdDeliveryIds: deliveryIds,
    affectedPersonIds: [person.id],
  } satisfies ExecutionResult;
}

async function executeCustomerDelivery(tx: Prisma.TransactionClient, session: InstantSession, parsed: ParsedCustomerDelivery) {
  const currencies = await currenciesByCode(tx);
  let person = parsed.personName ? await findMatchingPerson(tx, parsed) : null;
  if (!person && parsed.cardLast4) {
    const card = await findSingleCard(tx, parsed.cardLast4);
    person = card.batch?.person || null;
  }
  if (!person || !parsed.amount) throw new Error('PREVIEW_NOT_READY');

  const currency = currencyOrThrow(currencies, parsed.amount.currencyCode);
  const delivery = await createCustomerDelivery(tx, session, {
    personId: person.id,
    currency,
    amount: D(parsed.amount.value),
    note: `استلام مبلغ من التسجيل الفوري fingerprint:${parsed.fingerprint}`,
  });

  return {
    message: 'تم تسجيل المبلغ المستلم بنجاح',
    fingerprint: parsed.fingerprint,
    undoAvailable: true,
    affectedPaths: ['/people', `/people/${person.id}`, '/dashboard'],
    createdDeliveryIds: [delivery.id],
    affectedPersonIds: [person.id],
  } satisfies ExecutionResult;
}

async function createCardOperation(
  tx: Prisma.TransactionClient,
  session: InstantSession,
  input: {
    card: any;
    operationType: string;
    amount?: Prisma.Decimal;
    categoryCode?: string | null;
    quantity?: number;
    note?: string | null;
    reason?: string | null;
  },
) {
  const card = input.card;
  const currentRemaining = currentCardRemaining(card);
  const categoryCode = input.categoryCode || defaultCardDiscountCategories[0].code;
  const dbCategory =
    input.operationType === 'GIFT_CARD'
      ? await tx.cardDiscountCategory.findFirst({ where: { code: categoryCode, isActive: true } })
      : null;
  const category = dbCategory || (input.operationType === 'GIFT_CARD' ? defaultCardDiscountCategories.find((item) => item.code === categoryCode) : null);
  const amount = cardOperationAmount({
    operationType: input.operationType,
    amount: input.amount,
    quantity: input.quantity || 1,
    category,
    currentRemaining,
  });
  if (isCardDeductionOperation(input.operationType) && amount.lte(0)) throw new Error('INVALID_OPERATION_AMOUNT');
  if (isCardDeductionOperation(input.operationType) && amount.gt(currentRemaining)) throw new Error('CARD_OPERATION_OVER_REMAINING');
  if (input.operationType === 'REJECT' && !(input.reason || input.note)) throw new Error('REJECT_REASON_REQUIRED');

  const balanceAfter = isCardDeductionOperation(input.operationType) ? currentRemaining.sub(amount) : currentRemaining;
  const operation = await tx.receivedCardOperation.create({
    data: {
      cardId: card.id,
      operationType: input.operationType as any,
      categoryCode: input.operationType === 'GIFT_CARD' ? categoryCode : null,
      categoryFaceValue: category && 'faceValue' in category ? D(category.faceValue) : null,
      quantity: input.operationType === 'GIFT_CARD' ? input.quantity || 1 : 1,
      amount,
      balanceBefore: currentRemaining,
      balanceAfter,
      note: input.note || null,
      reason: input.reason || null,
      userId: session.userId || null,
      username: session.username || null,
    },
  });

  await tx.receivedCardStageLog.create({
    data: {
      cardId: card.id,
      stage: card.currentStage || 0,
      direction: input.operationType,
      amount,
      note: input.note || input.reason || null,
      userId: session.userId || null,
      username: session.username || null,
    },
  });

  const updated = await recalculateReceivedCard(tx, card.id);

  await createAuditEntry(tx, session, {
    action: 'RECEIVED_CARD_OPERATION_CREATE',
    entityType: 'ReceivedCardOperation',
    entityId: operation.id,
    oldValue: card,
    newValue: { operation, card: updated },
    description: `تم تسجيل عملية بطاقة ${card.cardLast4 || card.publicCode} عن طريق التسجيل الفوري`,
  });

  return { operation, updated };
}

async function executeCardWithdrawal(tx: Prisma.TransactionClient, session: InstantSession, parsed: ParsedCardWithdrawal) {
  if (!parsed.amount) throw new Error('PREVIEW_NOT_READY');
  const card = await findSingleCard(tx, parsed.cardLast4);
  const plan = operationPlanForWithdrawal(parsed.amount, parsed.quantity);
  const duplicate = card.operations?.some(
    (operation: any) =>
      operation.operationType === plan.operationType &&
      String(operation.categoryCode || '') === String(plan.categoryCode || '') &&
      Number(operation.quantity || 1) === plan.quantity &&
      D(operation.amount || 0).equals(plan.amount),
  );
  if (duplicate) throw new Error('CARD_OPERATION_ALREADY_EXISTS');

  const { operation } = await createCardOperation(tx, session, {
    card,
    operationType: plan.operationType,
    categoryCode: plan.categoryCode,
    quantity: plan.quantity,
    amount: plan.amount,
    note: `سحبة من التسجيل الفوري fingerprint:${parsed.fingerprint}`,
  });

  return {
    message: `تم تسجيل سحبة ${plan.amount.toString()}$ للبطاقة ${cardDisplay(card)}`,
    fingerprint: parsed.fingerprint,
    undoAvailable: true,
    affectedPaths: ['/people', `/people/${card.batch.personId}`, '/inventory/received-cards', '/dashboard'],
    createdCardOperationIds: [operation.id],
    affectedCardIds: [card.id],
    affectedPersonIds: [card.batch.personId],
  } satisfies ExecutionResult;
}

async function executeCardFinalSettlement(tx: Prisma.TransactionClient, session: InstantSession, parsed: ParsedInstantMessage) {
  if (parsed.kind !== 'CARD_FINAL_SETTLEMENT') throw new Error('PREVIEW_NOT_READY');
  const card = await findSingleCard(tx, parsed.cardLast4);
  if (['SETTLED', 'COMPLETED'].includes(card.status)) throw new Error('CARD_ALREADY_SETTLED');
  const { operation } = await createCardOperation(tx, session, {
    card,
    operationType: 'FINAL_SETTLEMENT',
    note: `تصفية من التسجيل الفوري fingerprint:${parsed.fingerprint}`,
  });

  return {
    message: `تمت تصفية البطاقة ${cardDisplay(card)} بنجاح`,
    fingerprint: parsed.fingerprint,
    undoAvailable: true,
    affectedPaths: ['/people', `/people/${card.batch.personId}`, '/inventory/received-cards', '/dashboard'],
    createdCardOperationIds: [operation.id],
    affectedCardIds: [card.id],
    affectedPersonIds: [card.batch.personId],
  } satisfies ExecutionResult;
}

async function executeCardStatus(tx: Prisma.TransactionClient, session: InstantSession, parsed: ParsedCardStatus) {
  const card = await findSingleCard(tx, parsed.cardLast4);
  const reason = parsed.reason || 'إيقاف من التسجيل الفوري';
  const { operation } = await createCardOperation(tx, session, {
    card,
    operationType: 'REJECT',
    reason,
    note: `تغيير حالة من التسجيل الفوري fingerprint:${parsed.fingerprint}`,
  });

  return {
    message: `تم تحديث حالة البطاقة ${cardDisplay(card)} بنجاح`,
    fingerprint: parsed.fingerprint,
    undoAvailable: true,
    affectedPaths: ['/people', `/people/${card.batch.personId}`, '/inventory/received-cards', '/dashboard'],
    createdCardOperationIds: [operation.id],
    affectedCardIds: [card.id],
    affectedPersonIds: [card.batch.personId],
  } satisfies ExecutionResult;
}

async function executeWalletMovement(tx: Prisma.TransactionClient, session: InstantSession, parsed: ParsedWalletMovement) {
  if (!parsed.personName || !parsed.amount) throw new Error('PREVIEW_NOT_READY');
  const currencies = await currenciesByCode(tx);
  const currency = currencyOrThrow(currencies, parsed.amount.currencyCode);
  const { person, created } = await findOrCreatePerson(tx, parsed, true);
  const accountType: WalletAccountType = parsed.side === 'US' ? 'DEBT' : 'CREDIT';
  const wallet = await createWalletMovement(tx, session, {
    personId: person.id,
    currency,
    accountType,
    direction: 'ADD',
    amount: D(parsed.amount.value),
    reason: parsed.side === 'US' ? 'لنا من التسجيل الفوري' : 'علينا من التسجيل الفوري',
    note: `fingerprint:${parsed.fingerprint}`,
    movementKind: 'ADJUSTMENT',
    effectMode: 'OFFSET',
  });
  const settlementIds = [wallet.created.id, ...wallet.linkedSettlements.map((settlement) => settlement.id)];

  if (created) {
    await createAuditEntry(tx, session, {
      action: 'PERSON_CREATE',
      entityType: 'Person',
      entityId: person.id,
      newValue: person,
      description: `تم إنشاء الزبون ${person.fullName} عن طريق التسجيل الفوري`,
    });
  }

  return {
    message: 'تم تسجيل الدين بنجاح',
    fingerprint: parsed.fingerprint,
    undoAvailable: true,
    affectedPaths: ['/accounts', '/people', `/people/${person.id}`, '/dashboard'],
    createdPersonId: created ? person.id : undefined,
    createdWalletSettlementIds: settlementIds,
    affectedPersonIds: [person.id],
  } satisfies ExecutionResult;
}

async function executeWalletRepayment(tx: Prisma.TransactionClient, session: InstantSession, parsed: ParsedWalletRepayment) {
  if (!parsed.personName || !parsed.amount) throw new Error('PREVIEW_NOT_READY');
  const person = await findMatchingPerson(tx, parsed);
  if (!person) throw new Error('PERSON_NOT_FOUND');
  const { target, blockingIssue } = await previewRepaymentTarget(tx, person.id, parsed.amount.currencyCode, parsed.amount);
  if (!target || blockingIssue) throw new Error('PREVIEW_NOT_READY');

  const wallet = await createWalletMovement(tx, session, {
    personId: person.id,
    currency: target.currency,
    paymentMethod: target.paymentMethod,
    accountType: target.accountType,
    direction: 'SUBTRACT',
    amount: D(parsed.amount.value),
    reason: target.accountType === 'DEBT' ? 'سداد دين لنا من التسجيل الفوري' : 'سداد دين علينا من التسجيل الفوري',
    note: `fingerprint:${parsed.fingerprint}`,
    movementKind: 'REPAYMENT',
    effectMode: 'OFFSET',
  });
  const settlementIds = [wallet.created.id, ...wallet.linkedSettlements.map((settlement) => settlement.id)];

  return {
    message: 'تم تسجيل سداد الدين بنجاح',
    fingerprint: parsed.fingerprint,
    undoAvailable: true,
    affectedPaths: ['/accounts', '/people', `/people/${person.id}`, '/dashboard'],
    createdWalletSettlementIds: settlementIds,
    affectedPersonIds: [person.id],
  } satisfies ExecutionResult;
}

export async function executeInstantRegistration(text: string, session: InstantSession) {
  const parsed = parseInstantMessage(text);
  if (parsed.kind === 'UNKNOWN') throw new Error('PREVIEW_NOT_READY');

  const result = await db.$transaction(async (tx) => {
    await assertFingerprintUnused(tx, parsed.fingerprint);

    const executed =
      parsed.kind === 'CARD_ENTRY'
        ? await executeCardEntry(tx, session, parsed)
        : parsed.kind === 'CUSTOMER_DELIVERY'
          ? await executeCustomerDelivery(tx, session, parsed)
          : parsed.kind === 'CARD_WITHDRAWAL'
            ? await executeCardWithdrawal(tx, session, parsed)
            : parsed.kind === 'CARD_FINAL_SETTLEMENT'
              ? await executeCardFinalSettlement(tx, session, parsed)
              : parsed.kind === 'CARD_STATUS'
                ? await executeCardStatus(tx, session, parsed)
                : parsed.kind === 'WALLET_MOVEMENT'
                  ? await executeWalletMovement(tx, session, parsed)
                  : parsed.kind === 'WALLET_REPAYMENT'
                    ? await executeWalletRepayment(tx, session, parsed)
                    : null;

    if (!executed) throw new Error('PREVIEW_NOT_READY');

    await createAuditEntry(tx, session, {
      action: instantExecuteAction,
      entityType: 'InstantRegistration',
      entityId: parsed.fingerprint,
      description: `تنفيذ التسجيل الفوري fingerprint:${parsed.fingerprint}`,
      newValue: {
        fingerprint: parsed.fingerprint,
        parsed,
        result: executed,
      },
    });

    return executed;
  });

  revalidateFinancePaths(result.affectedPaths);
  return result;
}

async function recalculateWalletGroup(
  tx: Prisma.TransactionClient,
  personId: string,
  group: { currencyId: string; paymentMethod: string; accountType: WalletAccountType },
) {
  const [transactions, settlements] = await Promise.all([
    tx.financialTransaction.findMany({
      where: { personId, deletedAt: null },
      include: { currency: true },
    }),
    tx.customerWalletSettlement.findMany({
      where: {
        personId,
        currencyId: group.currencyId,
        paymentMethod: group.paymentMethod,
        accountType: group.accountType,
        deletedAt: null,
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  let balance = D(0);
  for (const transaction of transactions) {
    const effect = transactionWalletEffect(transaction);
    if (
      effect &&
      effect.currencyId === group.currencyId &&
      effect.paymentMethod === group.paymentMethod &&
      effect.accountType === group.accountType
    ) {
      balance = balance.add(effect.amount);
    }
  }

  for (const settlement of settlements) {
    const balanceBefore = balance;
    balance = settlement.direction === 'ADD' ? balance.add(D(settlement.amount)) : balance.sub(D(settlement.amount));
    if (balance.lt(0)) throw new Error('NEGATIVE_WALLET_BALANCE');
    await tx.customerWalletSettlement.update({
      where: { id: settlement.id },
      data: { balanceBefore, balanceAfter: balance },
    });
  }
}

export async function undoInstantRegistration(fingerprint: string, session: InstantSession) {
  const result = await db.$transaction(async (tx) => {
    const executeLog = await tx.auditLog.findFirst({
      where: { action: instantExecuteAction, description: { contains: `fingerprint:${fingerprint}` } },
      orderBy: { createdAt: 'desc' },
    });
    if (!executeLog) throw new Error('INSTANT_EXECUTION_NOT_FOUND');

    const undoLog = await tx.auditLog.findFirst({
      where: { action: instantUndoAction, description: { contains: `fingerprint:${fingerprint}` } },
      select: { id: true },
    });
    if (undoLog) throw new Error('INSTANT_ALREADY_UNDONE');

    const value = executeLog.newValue as any;
    const execution = value?.result as ExecutionResult | undefined;
    if (!execution) throw new Error('INSTANT_EXECUTION_NOT_FOUND');

    const now = new Date();
    const affectedPaths = new Set(execution.affectedPaths || ['/dashboard', '/people', '/accounts', '/inventory/received-cards']);

    if (execution.createdCardOperationIds?.length) {
      const operations = await tx.receivedCardOperation.findMany({
        where: { id: { in: execution.createdCardOperationIds }, deletedAt: null },
        select: { id: true, cardId: true },
      });
      await tx.receivedCardOperation.updateMany({
        where: { id: { in: operations.map((operation) => operation.id) } },
        data: {
          deletedAt: now,
          deletedBy: session.username || 'system',
          deleteReason: 'تراجع عن التسجيل الفوري',
        },
      });
      for (const cardId of new Set(operations.map((operation) => operation.cardId))) {
        const card = await recalculateReceivedCard(tx, cardId);
        if (card.batch?.personId) affectedPaths.add(`/people/${card.batch.personId}`);
      }
    }

    if (execution.createdCardIds?.length) {
      await tx.receivedCustomerCard.updateMany({
        where: { id: { in: execution.createdCardIds }, deletedAt: null },
        data: {
          deletedAt: now,
          status: 'CANCELLED',
        },
      });
    }

    if (execution.createdBatchId) {
      await tx.customerCardEntryTransaction.updateMany({
        where: { batch: { id: execution.createdBatchId } },
        data: { status: 'CANCELLED' },
      });
    }

    if (execution.createdDeliveryIds?.length) {
      await tx.customerCardDelivery.updateMany({
        where: { id: { in: execution.createdDeliveryIds }, deletedAt: null },
        data: {
          deletedAt: now,
          deletedBy: session.username || 'system',
          deleteReason: 'تراجع عن التسجيل الفوري',
        },
      });
    }

    if (execution.createdWalletSettlementIds?.length) {
      const settlements = await tx.customerWalletSettlement.findMany({
        where: { id: { in: execution.createdWalletSettlementIds }, deletedAt: null },
        select: { id: true, personId: true, currencyId: true, paymentMethod: true, accountType: true },
      });
      await tx.customerWalletSettlement.updateMany({
        where: { id: { in: settlements.map((settlement) => settlement.id) } },
        data: {
          deletedAt: now,
          deletedBy: session.username || 'system',
          deleteReason: 'تراجع عن التسجيل الفوري',
        },
      });
      await tx.customerAccountRepayment.updateMany({
        where: { settlementId: { in: settlements.map((settlement) => settlement.id) }, deletedAt: null },
        data: {
          deletedAt: now,
          deletedBy: session.username || 'system',
          deleteReason: 'تراجع عن التسجيل الفوري',
        },
      });

      for (const settlement of settlements) {
        await recalculateWalletGroup(tx, settlement.personId, {
          currencyId: settlement.currencyId,
          paymentMethod: settlement.paymentMethod,
          accountType: settlement.accountType as WalletAccountType,
        });
        affectedPaths.add(`/people/${settlement.personId}`);
      }
    }

    if (execution.createdPersonId) {
      const hasOtherData = await Promise.all([
        tx.receivedCardBatch.count({ where: { personId: execution.createdPersonId, id: { not: execution.createdBatchId || '' } } }),
        tx.customerWalletSettlement.count({
          where: {
            personId: execution.createdPersonId,
            deletedAt: null,
            id: { notIn: execution.createdWalletSettlementIds || [] },
          },
        }),
        tx.customerCardDelivery.count({
          where: {
            personId: execution.createdPersonId,
            deletedAt: null,
            id: { notIn: execution.createdDeliveryIds || [] },
          },
        }),
        tx.financialTransaction.count({ where: { personId: execution.createdPersonId, deletedAt: null } }),
      ]);

      if (hasOtherData.every((count) => count === 0)) {
        await tx.person.update({
          where: { id: execution.createdPersonId },
          data: {
            deletedAt: now,
            status: 'ARCHIVED',
          },
        });
      }
    }

    await createAuditEntry(tx, session, {
      action: instantUndoAction,
      entityType: 'InstantRegistration',
      entityId: fingerprint,
      oldValue: executeLog.newValue,
      newValue: { fingerprint, undoneAt: now, execution },
      description: `تراجع عن التسجيل الفوري fingerprint:${fingerprint}`,
    });

    return {
      message: 'تم التراجع عن التسجيل الفوري بنجاح',
      affectedPaths: Array.from(affectedPaths),
    };
  });

  revalidateFinancePaths(result.affectedPaths);
  return result;
}

export async function instantRegistrationHistory(limit = 12) {
  return db.auditLog.findMany({
    where: {
      action: { in: [instantExecuteAction, instantUndoAction] },
    },
    select: {
      id: true,
      action: true,
      description: true,
      newValue: true,
      username: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
