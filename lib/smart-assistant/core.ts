import OpenAI from 'openai';
import type { Person, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { z } from 'zod';
import { audit, clientMeta } from '@/lib/auth';
import { cardOperationAmount, defaultCardDiscountCategories, isCardDeductionOperation } from '@/lib/customer-cards';
import { recalculateReceivedCard } from '@/lib/customer-card-recalculation';
import {
  buildWalletSnapshot,
  normalizeWalletPaymentMethod,
  previewWalletOperation,
  transactionWalletEffect,
  walletAccountAmount,
  type WalletAccountType,
  type WalletSettlementDirection,
} from '@/lib/customer-wallet';
import { db } from '@/lib/db';
import { D } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import {
  assistantIntentSchema,
  isAssistantWriteIntent,
  type AssistantIntent,
  type AssistantPreview,
  type AssistantResponse,
} from './schema';
import { createAssistantConfirmationToken, verifyAssistantConfirmationToken } from './security';

type SessionLike = {
  id: string;
  userId?: string | null;
  username?: string | null;
};

type Tx = Prisma.TransactionClient;
type PreparedAssistantCardInput = {
  cardLast4?: string;
  bankName?: string;
  valueUsd?: number;
  agreedAmount?: number;
  notes?: string;
};

const textModel = () => process.env.OPENAI_TEXT_MODEL?.trim() || 'gpt-5.6-luna';
const requestTimeoutMs = 25_000;

const modelIntentOutputSchema = z.object({
  intent: assistantIntentSchema,
  reply: z.string().trim().max(900).optional(),
});

function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function displayAmount(value: unknown, currencyCode?: string | null) {
  const amount = D(value || 0).toString();
  return currencyCode ? `${amount} ${currencyCode}` : amount;
}

function normalizeCustomerCode(code?: string | null) {
  const trimmed = code?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function idempotencyKeyFor(session: SessionLike, command: string, intent: AssistantIntent) {
  return createHash('sha256')
    .update(`${session.id}:${command.trim()}:${JSON.stringify(intent)}`)
    .digest('hex')
    .slice(0, 40);
}

function previewTokenFor(session: SessionLike, preview: AssistantPreview, transcript?: string) {
  return createAssistantConfirmationToken({
    version: 1,
    idempotencyKey: preview.idempotencyKey,
    originalCommand: preview.originalCommand,
    transcript,
    intent: preview.intent,
    preview,
    sessionId: session.id,
    expiresAt: Date.now() + 10 * 60_000,
  });
}

function responsePreview(preview: AssistantPreview, session: SessionLike, transcript?: string): AssistantResponse {
  return {
    type: 'preview',
    message: 'راجعت الأمر وجهزت معاينة آمنة. التنفيذ يحتاج تأكيدك.',
    preview,
    confirmationToken: previewTokenFor(session, preview, transcript),
  };
}

function clarify(message: string, missingFields: string[] = []): AssistantResponse {
  return {
    type: 'clarify',
    message,
    missingFields,
  };
}

function setupRequired(): AssistantResponse {
  return {
    type: 'setup_required',
    message:
      'المساعد جاهز داخل المنظومة، لكن مفتاح OpenAI غير مضبوط على الخادم. أضف OPENAI_API_KEY في Vercel ثم أعد المحاولة.',
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = requestTimeoutMs): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('OPENAI_TIMEOUT')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('ASSISTANT_EMPTY_OUTPUT');
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('ASSISTANT_JSON_OUTPUT_REQUIRED');
  return JSON.parse(match[0]);
}

async function searchCustomersForTool(args: any) {
  const query = String(args?.query || '').trim();
  const code = normalizeCustomerCode(args?.customerCode);
  if (!query && !code) return { customers: [] };

  const people = await db.person.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      OR: [
        ...(code ? [{ customerNo: code }] : []),
        ...(query
          ? [
              { fullName: { contains: query, mode: 'insensitive' as const } },
              { phone: { contains: query, mode: 'insensitive' as const } },
              { customerNo: { contains: query, mode: 'insensitive' as const } },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      customerNo: true,
      fullName: true,
      phone: true,
      cardBatches: {
        select: {
          cards: {
            where: { deletedAt: null },
            select: { publicCode: true, cardLast4: true, remainingAmount: true, progressPercent: true, status: true },
            take: 6,
          },
        },
        take: 4,
      },
    },
    take: 8,
  });

  return {
    customers: people.map((person) => ({
      id: person.id,
      code: person.customerNo,
      name: person.fullName,
      phone: person.phone,
      cards: person.cardBatches.flatMap((batch) => batch.cards),
    })),
  };
}

async function getCustomerSnapshotForTool(args: any) {
  const code = normalizeCustomerCode(args?.customerCode);
  const id = String(args?.personId || '').trim();
  if (!code && !id) return { error: 'CUSTOMER_REFERENCE_REQUIRED' };

  const person = await db.person.findFirst({
    where: { deletedAt: null, status: 'ACTIVE', ...(id ? { id } : { customerNo: code }) },
    include: {
      cardBatches: {
        include: {
          currency: true,
          cards: {
            where: { deletedAt: null },
            select: {
              id: true,
              publicCode: true,
              cardLast4: true,
              bankName: true,
              valueUsd: true,
              agreedAmount: true,
              settlementCurrencyId: true,
              totalDeducted: true,
              remainingAmount: true,
              progressPercent: true,
              status: true,
            },
            orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
            take: 80,
          },
        },
        orderBy: { receivedAt: 'desc' },
        take: 20,
      },
      transactions: {
        where: { deletedAt: null },
        include: { currency: true },
        orderBy: { transactionAt: 'desc' },
        take: 25,
      },
      walletSettlements: {
        where: { deletedAt: null },
        include: { currency: true },
        orderBy: { occurredAt: 'desc' },
        take: 60,
      },
      cardDeliveries: {
        where: { deletedAt: null },
        include: { currency: true },
        orderBy: { occurredAt: 'desc' },
        take: 25,
      },
    },
  });
  if (!person) return { error: 'CUSTOMER_NOT_FOUND' };

  const currencies = await db.currency.findMany({ where: { isActive: true } });
  const wallet = buildWalletSnapshot(person.transactions, person.walletSettlements, currencies);

  return {
    customer: {
      id: person.id,
      code: person.customerNo,
      name: person.fullName,
      phone: person.phone,
    },
    cards: person.cardBatches.flatMap((batch) =>
      batch.cards.map((card) => ({
        publicCode: card.publicCode,
        cardLast4: card.cardLast4,
        bankName: card.bankName,
        valueUsd: card.valueUsd.toString(),
        agreedAmount: card.agreedAmount.toString(),
        deducted: card.totalDeducted.toString(),
        remaining: card.remainingAmount.toString(),
        progressPercent: card.progressPercent.toString(),
        status: card.status,
        currencyCode: card.settlementCurrencyId ? undefined : batch.currency?.code,
      })),
    ),
    wallet: wallet.rows
      .filter((row) => row.credit || row.debt)
      .map((row) => ({
        paymentMethod: row.paymentMethod,
        label: row.label,
        currencyCode: row.currency.code,
        علينا: row.credit,
        لنا: row.debt,
      })),
    deliveries: person.cardDeliveries.map((delivery) => ({
      amount: delivery.amount.toString(),
      currencyCode: delivery.currency.code,
      balanceBefore: delivery.balanceBefore.toString(),
      balanceAfter: delivery.balanceAfter.toString(),
      occurredAt: delivery.occurredAt,
    })),
  };
}

async function readRecentAuditLogsForTool(args: any) {
  const query = String(args?.query || '').trim();
  const code = normalizeCustomerCode(args?.customerCode);
  const person = code
    ? await db.person.findFirst({ where: { customerNo: code, deletedAt: null }, select: { id: true, customerNo: true, fullName: true } })
    : null;

  const logs = await db.auditLog.findMany({
    where: {
      OR: [
        ...(person ? [{ entityId: person.id }, { description: { contains: person.fullName, mode: 'insensitive' as const } }] : []),
        ...(query
          ? [
              { action: { contains: query, mode: 'insensitive' as const } },
              { description: { contains: query, mode: 'insensitive' as const } },
              { entityId: { contains: query, mode: 'insensitive' as const } },
            ]
          : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return {
    logs: logs.map((log) => ({
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      description: log.description,
      username: log.username,
      createdAt: log.createdAt,
      oldValue: log.oldValue,
      newValue: log.newValue,
    })),
  };
}

const assistantTools = [
  {
    type: 'function',
    name: 'search_customers',
    description: 'ابحث عن زبون نشط بالكود أو الاسم أو الهاتف. يرجع حقولا مختصرة فقط.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        customerCode: { type: 'string' },
      },
      required: ['query', 'customerCode'],
    },
  },
  {
    type: 'function',
    name: 'get_customer_snapshot',
    description: 'اقرأ ملخص زبون واحد وبطاقاته وأرصدة لنا وعلينا. لا يغير البيانات.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        personId: { type: 'string' },
        customerCode: { type: 'string' },
      },
      required: ['personId', 'customerCode'],
    },
  },
  {
    type: 'function',
    name: 'read_recent_audit_logs',
    description: 'اقرأ آخر سجلات التدقيق المرتبطة بزبون أو استعلام مختصر. لا يغير البيانات.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        customerCode: { type: 'string' },
      },
      required: ['query', 'customerCode'],
    },
  },
] as const;

async function runReadOnlyTool(name: string, args: unknown) {
  if (name === 'search_customers') return searchCustomersForTool(args);
  if (name === 'get_customer_snapshot') return getCustomerSnapshotForTool(args);
  if (name === 'read_recent_audit_logs') return readRecentAuditLogsForTool(args);
  return { error: 'UNKNOWN_TOOL' };
}

function assistantInstructions() {
  return `
أنت مساعد عربي داخل منظومة مالية. افهم العربية واللهجة الليبية وحول كلام المستخدم إلى intent JSON فقط.
لا تنفذ كتابة. الكتابة دائما معاينة ثم تأكيد من المستخدم.
استخدم أدوات القراءة فقط عند الحاجة للبحث عن زبون أو بطاقة أو سجل تدقيق.
إذا تكرر الاسم أو نقص كود الزبون في أمر يحتاج زبونا موجودا، اسأل عن الكود ولا تخمن.
لا تطلب أو تعرض CVV أو أسرار. لا تقترح SQL ولا أسماء جداول ولا حذف نهائي.
قواعد البطاقات: القيمة الأصلية الافتراضية 2000 USD منفصلة عن السعر المتفق عليه. كرت 100 يخصم 101، كرت 300 يخصم 292، كرت 500 يخصم 476. الفاتورة تخصم المبلغ المكتوب. التصفية تخصم المتبقي أو المبلغ المحدد.
لنا = DEBT، علينا = CREDIT. "تم السداد" يعني SUBTRACT وحركة REPAYMENT من الجانب الحالي.
أعد JSON فقط بهذا الشكل: {"intent": {...}, "reply": "جملة عربية قصيرة اختيارية"}.
أنواع intent المسموحة:
- ASK_CLARIFICATION: question, missingFields
- QUERY_CUSTOMER: customerCode أو customerName, includeCards, includeWallet
- EXPLAIN_AUDIT: query أو customerCode أو transactionNumber أو entityId
- CREATE_CUSTOMER_WITH_CARDS: customerName, phone, currencyCode, agreedAmountPerCard, valueUsdPerCard, cards أو cardCount
- ADD_CARD_OPERATION: customerCode أو customerName, cardPublicCode أو cardLast4, operationType, categoryCode, quantity, amount, note, reason
- RECORD_CUSTOMER_DELIVERY: customerCode أو customerName, amount, currencyCode, paymentMethod, note
- ADD_WALLET_SETTLEMENT: customerCode أو customerName, accountType, direction, amount, currencyCode, paymentMethod, reason, note, movementKind, effectMode
`.trim();
}

async function runOpenAIIntent(command: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = []) {
  if (!hasOpenAIKey()) throw new Error('OPENAI_API_KEY_MISSING');

  const client = new OpenAI();
  const input: any[] = [
    ...history.slice(-6).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: 'user', content: command },
  ];

  let response: any = await withTimeout(
    client.responses.create({
      model: textModel(),
      instructions: assistantInstructions(),
      input,
      tools: assistantTools as any,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      max_output_tokens: 1400,
      reasoning: { effort: 'low' } as any,
    } as any),
  );

  for (let turn = 0; turn < 3; turn += 1) {
    const calls = (response.output || []).filter((item: any) => item.type === 'function_call');
    if (!calls.length) break;

    const toolOutputs = [];
    for (const call of calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        args = {};
      }
      toolOutputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(await runReadOnlyTool(call.name, args)),
      });
    }

    response = await withTimeout(
      client.responses.create({
        model: textModel(),
        instructions: assistantInstructions(),
        previous_response_id: response.id,
        input: toolOutputs,
        tools: assistantTools as any,
        tool_choice: 'auto',
        parallel_tool_calls: false,
        max_output_tokens: 1400,
        reasoning: { effort: 'low' } as any,
      } as any),
    );
  }

  const raw = response.output_text || '';
  const parsed = modelIntentOutputSchema.safeParse(extractJson(raw));
  if (!parsed.success) throw new Error('ASSISTANT_INTENT_INVALID');
  return parsed.data;
}

async function findCurrency(tx: Tx, code?: string) {
  if (!code) return null;
  return tx.currency.findFirst({ where: { code, isActive: true } });
}

async function resolvePerson(
  tx: Tx,
  reference: { customerCode?: string; customerName?: string },
): Promise<
  | { ok: true; person: Person }
  | { ok: false; message: string; missingFields: string[]; matches?: Array<{ code?: string | null; name: string }> }
> {
  const code = normalizeCustomerCode(reference.customerCode);
  if (code) {
    const person = await tx.person.findFirst({ where: { customerNo: code, deletedAt: null, status: 'ACTIVE' } });
    if (!person) return { ok: false, message: `لم أجد زبونًا بالكود ${code}.`, missingFields: ['customerCode'] };
    return { ok: true, person };
  }

  const name = reference.customerName?.trim();
  if (!name) return { ok: false, message: 'أحتاج كود الزبون حتى أحدد السجل الصحيح.', missingFields: ['customerCode'] };

  const matches = await tx.person.findMany({
    where: { fullName: { contains: name, mode: 'insensitive' }, deletedAt: null, status: 'ACTIVE' },
    orderBy: [{ customerNo: 'asc' }, { createdAt: 'asc' }],
    take: 8,
  });

  if (matches.length === 1) return { ok: true, person: matches[0] };
  if (matches.length > 1) {
    return {
      ok: false,
      message: 'وجدت أكثر من زبون بهذا الاسم. أرسل كود الزبون المطلوب.',
      missingFields: ['customerCode'],
      matches: matches.map((person) => ({ code: person.customerNo, name: person.fullName })),
    };
  }

  return { ok: false, message: 'لم أجد زبونًا بهذا الاسم. أرسل الكود أو تأكد من الاسم.', missingFields: ['customerCode'] };
}

async function resolveCardForPerson(
  tx: Tx,
  personId: string,
  reference: { cardPublicCode?: string; cardLast4?: string },
): Promise<
  | { ok: true; card: Prisma.ReceivedCustomerCardGetPayload<{ include: { batch: true } }> }
  | { ok: false; message: string; missingFields: string[] }
> {
  const where: Prisma.ReceivedCustomerCardWhereInput = {
    deletedAt: null,
    batch: { personId },
  };

  if (reference.cardPublicCode) where.publicCode = reference.cardPublicCode.trim();
  else if (reference.cardLast4) where.cardLast4 = reference.cardLast4.trim();
  else return { ok: false, message: 'أحتاج رقم البطاقة أو آخر 4 أرقام.', missingFields: ['cardLast4'] };

  const cards = await tx.receivedCustomerCard.findMany({
    where,
    include: { batch: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 5,
  });

  if (cards.length === 1) return { ok: true, card: cards[0] };
  if (cards.length > 1) {
    return {
      ok: false,
      message: 'وجدت أكثر من بطاقة بنفس المرجع لهذا الزبون. أرسل كود البطاقة الداخلي مثل #C0001.',
      missingFields: ['cardPublicCode'],
    };
  }

  return { ok: false, message: 'لم أجد البطاقة المطلوبة لهذا الزبون.', missingFields: ['cardLast4'] };
}

async function deliveryBalance(tx: Tx, personId: string, currencyId: string) {
  const [cards, deliveries] = await Promise.all([
    tx.receivedCustomerCard.findMany({
      where: { deletedAt: null, status: { not: 'CANCELLED' }, batch: { personId } },
      include: { batch: true },
    }),
    tx.customerCardDelivery.findMany({ where: { personId, currencyId, deletedAt: null } }),
  ]);

  const totalAgreed = cards.reduce((sum, card) => {
    const cardCurrencyId = card.settlementCurrencyId || card.batch.currencyId;
    return cardCurrencyId === currencyId ? sum.add(card.agreedAmount) : sum;
  }, D(0));
  const delivered = deliveries.reduce((sum, item) => sum.add(item.amount), D(0));
  return { totalAgreed, delivered, remaining: totalAgreed.sub(delivered) };
}

async function walletTotals(tx: Tx, personId: string, currencyId: string) {
  const [transactions, settlements] = await Promise.all([
    tx.financialTransaction.findMany({ where: { personId, deletedAt: null }, include: { currency: true } }),
    tx.customerWalletSettlement.findMany({ where: { personId, deletedAt: null }, include: { currency: true } }),
  ]);

  let debt = D(0);
  let credit = D(0);

  for (const transaction of transactions) {
    const effect = transactionWalletEffect(transaction);
    if (!effect || effect.currencyId !== currencyId) continue;
    if (effect.accountType === 'DEBT') debt = debt.add(effect.amount);
    else credit = credit.add(effect.amount);
  }

  for (const settlement of settlements) {
    if (settlement.currencyId !== currencyId) continue;
    const amount = D(settlement.amount);
    if (settlement.accountType === 'DEBT') {
      debt = settlement.direction === 'ADD' ? debt.add(amount) : debt.sub(amount);
    } else {
      credit = settlement.direction === 'ADD' ? credit.add(amount) : credit.sub(amount);
    }
  }

  return { transactions, settlements, debt, credit };
}

async function buildCreateCustomerPreview(tx: Tx, intent: Extract<AssistantIntent, { type: 'CREATE_CUSTOMER_WITH_CARDS' }>, command: string, session: SessionLike) {
  const missing = [];
  if (!intent.customerName) missing.push('customerName');
  if (!intent.currencyCode) missing.push('currencyCode');
  if (!intent.agreedAmountPerCard) missing.push('agreedAmountPerCard');
  if (!intent.cards?.length && !intent.cardCount) missing.push('cards');
  if (missing.length) return clarify('أحتاج بيانات إضافية قبل تجهيز إضافة الزبون والبطاقات.', missing);

  const currency = await findCurrency(tx, intent.currencyCode);
  if (!currency) return clarify('العملة غير موجودة أو غير مفعلة.', ['currencyCode']);

  const cards: PreparedAssistantCardInput[] = intent.cards?.length
    ? intent.cards
    : Array.from({ length: intent.cardCount || 1 }, () => ({ valueUsd: intent.valueUsdPerCard || 2000 }));
  const last4Values = cards.map((card) => card.cardLast4).filter(Boolean) as string[];
  const repeatedLast4 = last4Values.find((value, index) => last4Values.indexOf(value) !== index);
  if (repeatedLast4) return clarify(`آخر 4 أرقام مكرر داخل نفس الأمر: ${repeatedLast4}.`, ['cards']);

  const idempotencyKey = idempotencyKeyFor(session, command, intent);
  const warnings = [];
  const possibleDuplicates = await tx.person.findMany({
    where: { fullName: { equals: intent.customerName!, mode: 'insensitive' }, deletedAt: null, status: 'ACTIVE' },
    select: { customerNo: true, fullName: true },
    take: 4,
  });
  if (possibleDuplicates.length) warnings.push('يوجد زبون أو أكثر بنفس الاسم. سيتم إنشاء زبون جديد فقط بعد التأكيد.');

  const totalOriginal = cards.reduce((sum, card) => sum.add(D(card.valueUsd || intent.valueUsdPerCard || 2000)), D(0));
  const totalAgreed = D(intent.agreedAmountPerCard).mul(cards.length);

  const preview: AssistantPreview = {
    idempotencyKey,
    action: 'CREATE_CUSTOMER_WITH_CARDS',
    actionLabel: 'إضافة زبون وبطاقات',
    originalCommand: command,
    customer: { name: intent.customerName!, phone: intent.phone || null },
    cards: cards.map((card, index) => ({
      cardLast4: card.cardLast4 || null,
      bankName: card.bankName || null,
      valueUsd: displayAmount(card.valueUsd || intent.valueUsdPerCard || 2000, 'USD'),
      agreedAmount: displayAmount(card.agreedAmount || intent.agreedAmountPerCard, currency.code),
      publicCode: `بطاقة ${index + 1}`,
    })),
    amount: { value: totalAgreed.toString(), currencyCode: currency.code, paymentMethod: null },
    lines: [
      { label: 'عدد البطاقات', value: String(cards.length) },
      { label: 'إجمالي القيمة الأصلية', value: displayAmount(totalOriginal, 'USD') },
      { label: 'إجمالي السعر المتفق عليه', value: displayAmount(totalAgreed, currency.code) },
      { label: 'القيمة الأصلية الافتراضية', value: displayAmount(intent.valueUsdPerCard || 2000, 'USD') },
    ],
    warnings,
    missingFields: [],
    intent,
  };

  return responsePreview(preview, session);
}

async function buildCardOperationPreview(tx: Tx, intent: Extract<AssistantIntent, { type: 'ADD_CARD_OPERATION' }>, command: string, session: SessionLike) {
  const personResult = await resolvePerson(tx, intent);
  if (!personResult.ok) return clarify(personResult.message, personResult.missingFields);

  const cardResult = await resolveCardForPerson(tx, personResult.person.id, intent);
  if (!cardResult.ok) return clarify(cardResult.message, cardResult.missingFields);
  const card = cardResult.card;

  if (card.status === 'CANCELLED') {
    return clarify('البطاقة مرفوضة أو ملغاة ولا تقبل عمليات جديدة قبل إعادة التنشيط.', ['cardPublicCode']);
  }
  if (intent.operationType === 'REJECT' && !(intent.reason || intent.note)) {
    return clarify('اكتب سبب رفض البطاقة قبل تجهيز العملية.', ['reason']);
  }
  if ((intent.operationType === 'INVOICE' || intent.operationType === 'FINAL_SETTLEMENT') && !intent.amount) {
    if (intent.operationType === 'INVOICE') return clarify('أحتاج مبلغ الفاتورة.', ['amount']);
  }

  const currentRemaining = D(card.remainingAmount || 0);
  const categoryCode = intent.categoryCode || '100';
  const category = intent.operationType === 'GIFT_CARD' ? defaultCardDiscountCategories.find((item) => item.code === categoryCode) : null;
  const amount = cardOperationAmount({
    operationType: intent.operationType,
    amount: intent.amount,
    quantity: intent.quantity,
    category,
    currentRemaining,
  });
  if (isCardDeductionOperation(intent.operationType) && amount.gt(currentRemaining)) {
    return clarify('لا يمكن تنفيذ عملية أكبر من المتبقي في البطاقة.', ['amount']);
  }

  const balanceAfter = isCardDeductionOperation(intent.operationType) ? currentRemaining.sub(amount) : currentRemaining;
  const preview: AssistantPreview = {
    idempotencyKey: idempotencyKeyFor(session, command, intent),
    action: 'ADD_CARD_OPERATION',
    actionLabel: 'تسجيل عملية بطاقة',
    originalCommand: command,
    customer: {
      id: personResult.person.id,
      code: personResult.person.customerNo,
      name: personResult.person.fullName,
      phone: personResult.person.phone,
    },
    cards: [
      {
        id: card.id,
        publicCode: card.publicCode,
        cardLast4: card.cardLast4,
        bankName: card.bankName,
        amount: displayAmount(amount, 'USD'),
        balanceBefore: displayAmount(currentRemaining, 'USD'),
        balanceAfter: displayAmount(balanceAfter, 'USD'),
      },
    ],
    balances: [{ label: 'رصيد البطاقة', before: currentRemaining.toString(), after: balanceAfter.toString(), currencyCode: 'USD' }],
    lines: [
      { label: 'نوع العملية', value: intent.operationType },
      { label: 'المبلغ المخصوم', value: displayAmount(amount, 'USD') },
      { label: 'الرصيد قبل العملية', value: displayAmount(currentRemaining, 'USD') },
      { label: 'الرصيد بعد العملية', value: displayAmount(balanceAfter, 'USD') },
    ],
    warnings: [],
    missingFields: [],
    intent,
  };

  return responsePreview(preview, session);
}

async function buildDeliveryPreview(tx: Tx, intent: Extract<AssistantIntent, { type: 'RECORD_CUSTOMER_DELIVERY' }>, command: string, session: SessionLike) {
  const missing = [];
  if (!intent.amount) missing.push('amount');
  if (!intent.currencyCode) missing.push('currencyCode');
  if (missing.length) return clarify('أحتاج مبلغ التسليم والعملة.', missing);

  const personResult = await resolvePerson(tx, intent);
  if (!personResult.ok) return clarify(personResult.message, personResult.missingFields);
  const currency = await findCurrency(tx, intent.currencyCode);
  if (!currency) return clarify('العملة غير موجودة أو غير مفعلة.', ['currencyCode']);

  const before = await deliveryBalance(tx, personResult.person.id, currency.id);
  const after = before.remaining.sub(D(intent.amount));
  if (after.lt(0)) return clarify('قيمة التسليم أكبر من المتبقي على الزبون.', ['amount']);

  const preview: AssistantPreview = {
    idempotencyKey: idempotencyKeyFor(session, command, intent),
    action: 'RECORD_CUSTOMER_DELIVERY',
    actionLabel: 'تسجيل تسليم مبلغ للزبون',
    originalCommand: command,
    customer: {
      id: personResult.person.id,
      code: personResult.person.customerNo,
      name: personResult.person.fullName,
      phone: personResult.person.phone,
    },
    amount: {
      value: D(intent.amount).toString(),
      currencyCode: currency.code,
      paymentMethod: intent.paymentMethod || null,
    },
    balances: [{ label: 'المتبقي على الزبون', before: before.remaining.toString(), after: after.toString(), currencyCode: currency.code }],
    lines: [
      { label: 'المبلغ', value: displayAmount(intent.amount, currency.code) },
      { label: 'قبل التسليم', value: displayAmount(before.remaining, currency.code) },
      { label: 'بعد التسليم', value: displayAmount(after, currency.code) },
    ],
    warnings: [],
    missingFields: [],
    intent,
  };

  return responsePreview(preview, session);
}

async function buildWalletPreview(tx: Tx, intent: Extract<AssistantIntent, { type: 'ADD_WALLET_SETTLEMENT' }>, command: string, session: SessionLike) {
  const missing = [];
  if (!intent.accountType) missing.push('accountType');
  if (!intent.direction) missing.push('direction');
  if (!intent.amount) missing.push('amount');
  if (!intent.currencyCode) missing.push('currencyCode');
  if (missing.length) return clarify('أحتاج نوع الحساب والاتجاه والمبلغ والعملة.', missing);

  const personResult = await resolvePerson(tx, intent);
  if (!personResult.ok) return clarify(personResult.message, personResult.missingFields);
  const currency = await findCurrency(tx, intent.currencyCode);
  if (!currency) return clarify('العملة غير موجودة أو غير مفعلة.', ['currencyCode']);

  const accountType = intent.accountType;
  const direction = intent.direction;
  const amount = intent.amount;
  if (!accountType || !direction || !amount) return clarify('أحتاج نوع الحساب والاتجاه والمبلغ والعملة.', missing);

  const totals = await walletTotals(tx, personResult.person.id, currency.id);
  const preview = previewWalletOperation({
    debtBefore: totals.debt,
    creditBefore: totals.credit,
    amount,
    accountType,
    direction,
    effectMode: intent.effectMode || 'NORMAL',
  });

  const paymentMethod = normalizeWalletPaymentMethod(intent.paymentMethod, currency.code);
  const beforeBucket = walletAccountAmount(
    totals.transactions,
    totals.settlements,
    currency.id,
    paymentMethod,
    accountType,
  );
  const afterBucket = direction === 'ADD' ? beforeBucket.add(D(amount)) : beforeBucket.sub(D(amount));
  if (afterBucket.lt(0)) return clarify('لا يمكن خصم مبلغ أكبر من الرصيد الحالي.', ['amount']);

  const assistantPreview: AssistantPreview = {
    idempotencyKey: idempotencyKeyFor(session, command, intent),
    action: 'ADD_WALLET_SETTLEMENT',
    actionLabel: intent.movementKind === 'REPAYMENT' ? 'تسجيل سداد دين' : 'إضافة حركة لنا وعلينا',
    originalCommand: command,
    customer: {
      id: personResult.person.id,
      code: personResult.person.customerNo,
      name: personResult.person.fullName,
      phone: personResult.person.phone,
    },
    amount: { value: D(amount).toString(), currencyCode: currency.code, paymentMethod },
    balances: [
      { label: 'إجمالي لنا', before: totals.debt.toString(), after: preview.debtAfter.toString(), currencyCode: currency.code },
      { label: 'إجمالي علينا', before: totals.credit.toString(), after: preview.creditAfter.toString(), currencyCode: currency.code },
      { label: accountType === 'DEBT' ? 'رصيد لنا لهذا النوع' : 'رصيد علينا لهذا النوع', before: beforeBucket.toString(), after: afterBucket.toString(), currencyCode: currency.code },
    ],
    lines: [
      { label: 'الحساب', value: accountType === 'DEBT' ? 'لنا' : 'علينا' },
      { label: 'الاتجاه', value: direction === 'ADD' ? 'إضافة' : 'خصم' },
      { label: 'طريقة التأثير', value: intent.effectMode === 'OFFSET' ? 'خصم القيمة من الإجمالي' : 'إضافة عادية' },
      { label: 'المبلغ', value: displayAmount(amount, currency.code) },
    ],
    warnings: [],
    missingFields: [],
    intent,
  };

  return responsePreview(assistantPreview, session);
}

export async function buildAssistantPreviewFromIntent(intent: AssistantIntent, command: string, session: SessionLike, transcript?: string): Promise<AssistantResponse> {
  if (intent.type === 'ASK_CLARIFICATION') return clarify(intent.question, intent.missingFields);

  if (!isAssistantWriteIntent(intent)) {
    return buildReadOnlyAnswer(intent);
  }

  return db.$transaction(async (tx) => {
    if (intent.type === 'CREATE_CUSTOMER_WITH_CARDS') return buildCreateCustomerPreview(tx, intent, command, session);
    if (intent.type === 'ADD_CARD_OPERATION') return buildCardOperationPreview(tx, intent, command, session);
    if (intent.type === 'RECORD_CUSTOMER_DELIVERY') return buildDeliveryPreview(tx, intent, command, session);
    if (intent.type === 'ADD_WALLET_SETTLEMENT') return buildWalletPreview(tx, intent, command, session);
    return clarify('هذا النوع من الأوامر غير مدعوم بعد.', []);
  }).then((response) => {
    if (response.type !== 'preview') return response;
    return responsePreview(response.preview, session, transcript);
  });
}

async function buildReadOnlyAnswer(intent: AssistantIntent): Promise<AssistantResponse> {
  if (intent.type === 'QUERY_CUSTOMER') {
    const snapshot = await db.$transaction(async (tx) => {
      const personResult = await resolvePerson(tx, intent);
      if (!personResult.ok) return personResult;
      return getCustomerSnapshotForTool({ personId: personResult.person.id, customerCode: '' });
    });

    if ('ok' in snapshot && !snapshot.ok) return clarify(snapshot.message, snapshot.missingFields);
    return {
      type: 'answer',
      message: 'هذا ملخص الزبون والبطاقات والأرصدة الحالية.',
      answer: snapshot,
    };
  }

  if (intent.type === 'EXPLAIN_AUDIT') {
    const answer = await readRecentAuditLogsForTool(intent);
    return {
      type: 'answer',
      message: 'هذه آخر السجلات المرتبطة بالاستعلام.',
      answer,
    };
  }

  return clarify('أحتاج توضيحًا أكثر للأمر المطلوب.', []);
}

export async function handleAssistantCommand(input: {
  command: string;
  transcript?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  session: SessionLike;
}) {
  if (!hasOpenAIKey()) return setupRequired();

  try {
    const modelOutput = await runOpenAIIntent(input.command, input.history);
    await audit('ASSISTANT_COMMAND_PREVIEW', {
      entityType: 'AssistantCommand',
      entityId: undefined,
      newValue: {
        originalCommand: input.command,
        transcript: input.transcript || null,
        intent: modelOutput.intent,
        model: textModel(),
      } as any,
      description: 'معاينة أمر من المساعد الذكي',
    });
    return buildAssistantPreviewFromIntent(modelOutput.intent, input.command, input.session, input.transcript);
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'OPENAI_API_KEY_MISSING') return setupRequired();
    if (message === 'OPENAI_TIMEOUT') return clarify('انتهت مهلة المساعد قبل فهم الأمر. حاول بأمر أقصر.', []);
    return clarify('لم أستطع تحويل الأمر إلى عملية آمنة. أعد صياغته مع كود الزبون والمبلغ والعملة.', []);
  }
}

async function nextCustomerNo(tx: Tx) {
  const total = await tx.person.count();
  for (let index = total + 1; index < total + 100000; index += 1) {
    const customerNo = `#${String(index).padStart(4, '0')}`;
    const exists = await tx.person.findFirst({ where: { customerNo } });
    if (!exists) return customerNo;
  }
  throw new Error('CUSTOMER_CODE_FAILED');
}

async function nextCardCodes(tx: Tx, count: number) {
  const total = await tx.receivedCustomerCard.count();
  const codes: string[] = [];
  let cursor = total + 1;

  while (codes.length < count) {
    const candidateCount = Math.max((count - codes.length) * 2, 50);
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
  }

  return codes;
}

async function executeCreateCustomerWithCards(tx: Tx, intent: Extract<AssistantIntent, { type: 'CREATE_CUSTOMER_WITH_CARDS' }>, session: SessionLike) {
  const currency = await findCurrency(tx, intent.currencyCode);
  if (!currency || !intent.customerName || !intent.agreedAmountPerCard) throw new Error('ASSISTANT_PREVIEW_STALE');

  const cards: PreparedAssistantCardInput[] = intent.cards?.length
    ? intent.cards
    : Array.from({ length: intent.cardCount || 1 }, () => ({ valueUsd: intent.valueUsdPerCard || 2000 }));
  const person = await tx.person.create({
    data: {
      customerNo: await nextCustomerNo(tx),
      fullName: intent.customerName,
      phone: intent.phone || null,
      address: intent.address || null,
      notes: intent.notes || null,
      category: intent.category || 'REGULAR',
    },
  });

  const totalOriginalAmount = cards.reduce((sum, card) => sum.add(D(card.valueUsd || intent.valueUsdPerCard || 2000)), D(0));
  const totalAgreedAmount = cards.reduce((sum, card) => sum.add(D(card.agreedAmount || intent.agreedAmountPerCard)), D(0));

  const entryTransaction = await tx.customerCardEntryTransaction.create({
    data: {
      personId: person.id,
      currencyId: currency.id,
      cardCount: cards.length,
      totalOriginalAmount,
      totalAgreedAmount,
      notes: intent.notes || null,
      userId: session.userId || null,
      username: session.username || null,
    },
  });

  const batch = await tx.receivedCardBatch.create({
    data: {
      personId: person.id,
      currencyId: currency.id,
      entryTransactionId: entryTransaction.id,
      cardCount: cards.length,
      agreedAmountPerCard: D(intent.agreedAmountPerCard),
      totalOriginalAmount,
      totalAgreedAmount,
      notes: intent.notes || null,
      createdByUserId: session.userId || null,
      createdByUsername: session.username || null,
    },
  });

  const publicCodes = await nextCardCodes(tx, cards.length);
  await tx.receivedCustomerCard.createMany({
    data: cards.map((card, index) => {
      const valueUsd = D(card.valueUsd || intent.valueUsdPerCard || 2000);
      return {
        batchId: batch.id,
        sequence: index + 1,
        publicCode: publicCodes[index],
        cardLast4: card.cardLast4 || null,
        bankName: card.bankName || null,
        valueUsd,
        agreedAmount: D(card.agreedAmount || intent.agreedAmountPerCard),
        settlementCurrencyId: currency.id,
        remainingAmount: valueUsd,
        progressPercent: D(0),
        totalDeducted: D(0),
        status: 'RECEIVED',
        notes: card.notes || null,
      };
    }),
  });

  return { personId: person.id, batchId: batch.id, cardCount: cards.length };
}

async function executeCardOperation(tx: Tx, intent: Extract<AssistantIntent, { type: 'ADD_CARD_OPERATION' }>, session: SessionLike) {
  const personResult = await resolvePerson(tx, intent);
  if (!personResult.ok) throw new Error('ASSISTANT_PREVIEW_STALE');
  const cardResult = await resolveCardForPerson(tx, personResult.person.id, intent);
  if (!cardResult.ok) throw new Error('ASSISTANT_PREVIEW_STALE');
  const card = cardResult.card;
  const currentRemaining = D(card.remainingAmount || 0);
  const categoryCode = intent.categoryCode || '100';
  const category = intent.operationType === 'GIFT_CARD' ? defaultCardDiscountCategories.find((item) => item.code === categoryCode) : null;
  const amount = cardOperationAmount({
    operationType: intent.operationType,
    amount: intent.amount,
    quantity: intent.quantity,
    category,
    currentRemaining,
  });
  if (isCardDeductionOperation(intent.operationType) && amount.gt(currentRemaining)) throw new Error('ASSISTANT_PREVIEW_STALE');

  const balanceAfter = isCardDeductionOperation(intent.operationType) ? currentRemaining.sub(amount) : currentRemaining;
  const operation = await tx.receivedCardOperation.create({
    data: {
      cardId: card.id,
      operationType: intent.operationType as any,
      categoryCode: intent.operationType === 'GIFT_CARD' ? categoryCode : null,
      categoryFaceValue: category ? D(category.faceValue) : null,
      quantity: intent.operationType === 'GIFT_CARD' ? intent.quantity || 1 : 1,
      amount,
      balanceBefore: currentRemaining,
      balanceAfter,
      note: intent.note || null,
      reason: intent.reason || null,
      userId: session.userId || null,
      username: session.username || null,
    },
  });

  await tx.receivedCardStageLog.create({
    data: {
      cardId: card.id,
      stage: card.currentStage || 0,
      direction: intent.operationType,
      amount,
      note: intent.note || intent.reason || null,
      userId: session.userId || null,
      username: session.username || null,
    },
  });

  await recalculateReceivedCard(tx, card.id);
  return { personId: personResult.person.id, cardId: card.id, operationId: operation.id };
}

async function executeCustomerDelivery(tx: Tx, intent: Extract<AssistantIntent, { type: 'RECORD_CUSTOMER_DELIVERY' }>, session: SessionLike) {
  const personResult = await resolvePerson(tx, intent);
  if (!personResult.ok || !intent.amount || !intent.currencyCode) throw new Error('ASSISTANT_PREVIEW_STALE');
  const currency = await findCurrency(tx, intent.currencyCode);
  if (!currency) throw new Error('ASSISTANT_PREVIEW_STALE');
  const balance = await deliveryBalance(tx, personResult.person.id, currency.id);
  const balanceAfter = balance.remaining.sub(D(intent.amount));
  if (balanceAfter.lt(0)) throw new Error('ASSISTANT_PREVIEW_STALE');

  const delivery = await tx.customerCardDelivery.create({
    data: {
      personId: personResult.person.id,
      currencyId: currency.id,
      paymentMethod: intent.paymentMethod || null,
      amount: D(intent.amount),
      balanceBefore: balance.remaining,
      balanceAfter,
      reason: 'CUSTOMER_CARD_DELIVERY',
      note: intent.note || null,
      userId: session.userId || null,
      username: session.username || null,
    },
  });
  return { personId: personResult.person.id, deliveryId: delivery.id };
}

async function executeWalletSettlement(tx: Tx, intent: Extract<AssistantIntent, { type: 'ADD_WALLET_SETTLEMENT' }>, session: SessionLike) {
  const personResult = await resolvePerson(tx, intent);
  if (!personResult.ok || !intent.amount || !intent.currencyCode || !intent.accountType || !intent.direction) {
    throw new Error('ASSISTANT_PREVIEW_STALE');
  }
  const currency = await findCurrency(tx, intent.currencyCode);
  if (!currency) throw new Error('ASSISTANT_PREVIEW_STALE');
  const totals = await walletTotals(tx, personResult.person.id, currency.id);
  previewWalletOperation({
    debtBefore: totals.debt,
    creditBefore: totals.credit,
    amount: intent.amount,
    accountType: intent.accountType,
    direction: intent.direction,
    effectMode: intent.effectMode || 'NORMAL',
  });

  const paymentMethod = normalizeWalletPaymentMethod(intent.paymentMethod, currency.code);
  const legacyBalanceBefore = walletAccountAmount(
    totals.transactions,
    totals.settlements,
    currency.id,
    paymentMethod,
    intent.accountType,
  );
  const amount = D(intent.amount);
  const balanceAfter = intent.direction === 'ADD' ? legacyBalanceBefore.add(amount) : legacyBalanceBefore.sub(amount);
  if (balanceAfter.lt(0)) throw new Error('ASSISTANT_PREVIEW_STALE');

  const settlement = await tx.customerWalletSettlement.create({
    data: {
      personId: personResult.person.id,
      currencyId: currency.id,
      paymentMethod,
      accountType: intent.accountType as WalletAccountType,
      direction: intent.direction as WalletSettlementDirection,
      amount,
      balanceBefore: legacyBalanceBefore,
      balanceAfter,
      reason: intent.reason || (intent.movementKind === 'REPAYMENT' ? 'سداد عبر المساعد الذكي' : 'حركة عبر المساعد الذكي'),
      note: intent.note || null,
      movementKind: intent.movementKind || 'ADJUSTMENT',
      settlementMethod: intent.effectMode === 'OFFSET' ? 'OFFSET' : null,
      userId: session.userId || null,
      username: session.username || null,
    },
  });

  if (intent.movementKind === 'REPAYMENT') {
    await tx.customerAccountRepayment.create({
      data: {
        settlementId: settlement.id,
        personId: personResult.person.id,
        currencyId: currency.id,
        paymentMethod,
        accountType: intent.accountType,
        amount,
        balanceBefore: settlement.balanceBefore,
        balanceAfter: settlement.balanceAfter,
        reason: settlement.reason,
        note: intent.note || null,
        userId: session.userId || null,
        username: session.username || null,
      },
    });
  }

  return { personId: personResult.person.id, settlementId: settlement.id };
}

export async function executeAssistantConfirmation(token: string, session: SessionLike) {
  const payload = verifyAssistantConfirmationToken(token, session.id);
  const meta = await clientMeta();

  const result = await db.$transaction(async (tx) => {
    const duplicate = await tx.auditLog.findFirst({
      where: {
        action: 'ASSISTANT_COMMAND_EXECUTE',
        newValue: { path: ['idempotencyKey'], equals: payload.idempotencyKey },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (duplicate) {
      return {
        duplicated: true,
        auditLogId: duplicate.id,
        result: duplicate.newValue,
      };
    }

    let execution: unknown;
    if (payload.intent.type === 'CREATE_CUSTOMER_WITH_CARDS') execution = await executeCreateCustomerWithCards(tx, payload.intent, session);
    else if (payload.intent.type === 'ADD_CARD_OPERATION') execution = await executeCardOperation(tx, payload.intent, session);
    else if (payload.intent.type === 'RECORD_CUSTOMER_DELIVERY') execution = await executeCustomerDelivery(tx, payload.intent, session);
    else if (payload.intent.type === 'ADD_WALLET_SETTLEMENT') execution = await executeWalletSettlement(tx, payload.intent, session);
    else throw new Error('ASSISTANT_CONFIRMATION_NOT_WRITE');

    const auditLog = await tx.auditLog.create({
      data: {
        userId: session.userId || null,
        username: session.username || null,
        sessionId: session.id,
        action: 'ASSISTANT_COMMAND_EXECUTE',
        entityType: 'AssistantCommand',
        entityId: payload.idempotencyKey,
        oldValue: null as any,
        newValue: {
          idempotencyKey: payload.idempotencyKey,
          originalCommand: payload.originalCommand,
          transcript: payload.transcript || null,
          intent: payload.intent,
          preview: payload.preview,
          execution,
        } as any,
        description: `تنفيذ مؤكد عبر المساعد الذكي: ${payload.preview.actionLabel}`,
        ip: meta.ip,
        userAgent: meta.ua,
      },
    });

    return { duplicated: false, auditLogId: auditLog.id, result: execution };
  });

  const personId = (result.result as any)?.personId;
  revalidateFinancePaths(['/dashboard', '/people', '/accounts', '/audit', ...(personId ? [`/people/${personId}`] : [])]);
  return result;
}
