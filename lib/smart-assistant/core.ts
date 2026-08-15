import OpenAI from 'openai';
import type { Person, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { z } from 'zod';
import { audit, clientMeta } from '@/lib/auth';
import { cardOperationAmount, cardOperationTypeLabels, defaultCardDiscountCategories, isCardDeductionOperation } from '@/lib/customer-cards';
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
  enforceArabicAssistantMessage,
  formatAuditLogsAnswer,
  formatCardReadAnswer,
  formatCustomerReadAnswer,
  formatDuplicateCustomers,
  formatSystemAccountAnswer,
  tryBuildDeterministicReadIntent,
  type AssistantAmount,
  type AssistantCustomerCardView,
  type AssistantCustomerReadView,
  type AssistantReadQueryMode,
  type AssistantSystemAccountView,
} from './read-format';
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

const textModel = () => process.env.OPENAI_TEXT_MODEL?.trim() || 'gpt-5.6-sol';
const requestTimeoutMs = 25_000;

const modelIntentOutputSchema = z.object({
  intent: assistantIntentSchema,
  reply: z.string().trim().max(900).optional(),
});
const modelIntentTextFormat = {
  type: 'json_schema',
  name: 'assistant_intent',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: [
              'ASK_CLARIFICATION',
              'QUERY_CUSTOMER',
              'EXPLAIN_AUDIT',
              'CREATE_CUSTOMER_WITH_CARDS',
              'ADD_CARD_OPERATION',
              'RECORD_CUSTOMER_DELIVERY',
              'ADD_WALLET_SETTLEMENT',
            ],
          },
          question: { type: ['string', 'null'] },
          missingFields: { type: ['array', 'null'], items: { type: 'string' } },
          customerCode: { type: ['string', 'null'] },
          customerName: { type: ['string', 'null'] },
          includeCards: { type: ['boolean', 'null'] },
          includeWallet: { type: ['boolean', 'null'] },
          queryMode: {
            type: ['string', 'null'],
            enum: [
              'DEBT_SUMMARY',
              'CARDS_SUMMARY',
              'CARDS_DETAILS',
              'DELIVERIES_SUMMARY',
              'FINANCIAL_REMAINING',
              'ACCOUNT_SUMMARY',
              'CARD_LAST_OPERATION',
              'CARD_REMAINING',
              'FULL_SUMMARY',
              null,
            ],
          },
          cardPublicCode: { type: ['string', 'null'] },
          cardLast4: { type: ['string', 'null'] },
          currencyCode: { type: ['string', 'null'], enum: ['USD', 'LYD', 'USDT', 'CNY', null] },
          query: { type: ['string', 'null'] },
          transactionNumber: { type: ['string', 'null'] },
          entityId: { type: ['string', 'null'] },
          phone: { type: ['string', 'null'] },
          address: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
          category: { type: ['string', 'null'], enum: ['VIP', 'REGULAR', null] },
          agreedAmountPerCard: { type: ['number', 'null'] },
          valueUsdPerCard: { type: ['number', 'null'] },
          cards: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                cardLast4: { type: ['string', 'null'] },
                bankName: { type: ['string', 'null'] },
                valueUsd: { type: ['number', 'null'] },
                agreedAmount: { type: ['number', 'null'] },
                notes: { type: ['string', 'null'] },
              },
              required: ['cardLast4', 'bankName', 'valueUsd', 'agreedAmount', 'notes'],
            },
          },
          cardCount: { type: ['number', 'null'] },
          operationType: { type: ['string', 'null'], enum: ['GIFT_CARD', 'INVOICE', 'FINAL_SETTLEMENT', 'REJECT', null] },
          categoryCode: { type: ['string', 'null'], enum: ['100', '300', '500', null] },
          quantity: { type: ['number', 'null'] },
          amount: { type: ['number', 'null'] },
          note: { type: ['string', 'null'] },
          reason: { type: ['string', 'null'] },
          paymentMethod: {
            type: ['string', 'null'],
            enum: [
              'USD_CASH',
              'USD_TRANSFER',
              'LYD_CASH',
              'LYD_TRANSFER',
              'LYD_OFFICE_TRANSFER',
              'LYD_CARD',
              'USDT',
              'CNY',
              'CASH',
              'TRANSFER',
              'CARD',
              null,
            ],
          },
          accountType: { type: ['string', 'null'], enum: ['DEBT', 'CREDIT', null] },
          direction: { type: ['string', 'null'], enum: ['ADD', 'SUBTRACT', null] },
          movementKind: { type: ['string', 'null'], enum: ['ADJUSTMENT', 'REPAYMENT', null] },
          effectMode: { type: ['string', 'null'], enum: ['NORMAL', 'OFFSET', null] },
        },
        required: [
          'type',
          'question',
          'missingFields',
          'customerCode',
          'customerName',
          'includeCards',
          'includeWallet',
          'queryMode',
          'cardPublicCode',
          'cardLast4',
          'currencyCode',
          'query',
          'transactionNumber',
          'entityId',
          'phone',
          'address',
          'notes',
          'category',
          'agreedAmountPerCard',
          'valueUsdPerCard',
          'cards',
          'cardCount',
          'operationType',
          'categoryCode',
          'quantity',
          'amount',
          'note',
          'reason',
          'paymentMethod',
          'accountType',
          'direction',
          'movementKind',
          'effectMode',
        ],
      },
      reply: { type: ['string', 'null'] },
    },
    required: ['intent', 'reply'],
  },
} as const;

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
    message: enforceArabicAssistantMessage('راجعت الأمر وجهزت معاينة آمنة. التنفيذ يحتاج تأكيدك.'),
    preview,
    confirmationToken: previewTokenFor(session, preview, transcript),
  };
}

function clarify(message: string, missingFields: string[] = []): AssistantResponse {
  return {
    type: 'clarify',
    message: enforceArabicAssistantMessage(message),
    missingFields,
  };
}

function setupRequired(): AssistantResponse {
  return {
    type: 'setup_required',
    message: enforceArabicAssistantMessage(
      'المساعد جاهز داخل المنظومة، لكن مفتاح OpenAI غير مضبوط على الخادم. أضف مفتاح OpenAI في إعدادات الإنتاج ثم أعد المحاولة.',
    ),
  };
}

function answer(message: string): AssistantResponse {
  return {
    type: 'answer',
    message: enforceArabicAssistantMessage(message),
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

function removeNullFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => removeNullFields(item));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [key, removeNullFields(item)]),
  );
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

async function getCustomerReadAnswerForTool(args: any, mode: AssistantReadQueryMode) {
  return db.$transaction(async (tx) => {
    const personResult = await resolvePerson(tx, {
      customerCode: args?.customerCode || undefined,
      customerName: args?.customerName || undefined,
    });
    if (!personResult.ok) return { error: 'CUSTOMER_NOT_RESOLVED', message: personResult.message, matches: personResult.matches || [] };
    const view = filterCustomerViewByCurrency(await getCustomerReadView(tx, personResult.person), args?.currencyCode || undefined);
    return { message: formatCustomerReadAnswer(mode, view) };
  });
}

async function getCardReadAnswerForTool(args: any, mode: Extract<AssistantReadQueryMode, 'CARD_LAST_OPERATION' | 'CARD_REMAINING'>) {
  return db.$transaction(async (tx) => {
    const result = await resolveCardForRead(tx, {
      type: 'QUERY_CUSTOMER',
      customerCode: args?.customerCode || undefined,
      customerName: args?.customerName || undefined,
      includeCards: true,
      includeWallet: false,
      queryMode: mode,
      cardPublicCode: args?.cardPublicCode || undefined,
      cardLast4: args?.cardLast4 || undefined,
    });
    if (!result.ok) return { error: 'CARD_NOT_RESOLVED', message: result.message };
    return { message: formatCardReadAnswer(mode, result.card, result.customer) };
  });
}

const customerToolParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    customerCode: { type: 'string' },
    customerName: { type: 'string' },
    currencyCode: { type: 'string' },
  },
  required: ['customerCode', 'customerName', 'currencyCode'],
} as const;

const cardToolParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    customerCode: { type: 'string' },
    customerName: { type: 'string' },
    cardPublicCode: { type: 'string' },
    cardLast4: { type: 'string' },
  },
  required: ['customerCode', 'customerName', 'cardPublicCode', 'cardLast4'],
} as const;

const assistantTools = [
  {
    type: 'function',
    name: 'find_customer',
    description: 'ابحث عن زبون نشط بالكود أو الاسم أو الهاتف عند وجود التباس. لا يغير البيانات.',
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
    name: 'get_customer_debt_summary',
    description: 'اقرأ الدين الحالي للزبون فقط، مفصولًا حسب العملة، دون اعتبار الدين المسدد دينًا حاليًا.',
    strict: true,
    parameters: customerToolParameters,
  },
  {
    type: 'function',
    name: 'get_customer_cards_summary',
    description: 'اقرأ ملخص بطاقات الزبون، مع عدد البطاقات وإجمالي الأصلي والمتفق عليه والمسلّم والمتبقي المالي.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        customerCode: { type: 'string' },
        customerName: { type: 'string' },
        details: { type: 'boolean' },
      },
      required: ['customerCode', 'customerName', 'details'],
    },
  },
  {
    type: 'function',
    name: 'get_customer_deliveries_summary',
    description: 'اقرأ مبالغ التسليم الفعلية للزبون والمتبقي المالي، مفصولة حسب العملة.',
    strict: true,
    parameters: customerToolParameters,
  },
  {
    type: 'function',
    name: 'get_customer_account_summary',
    description: 'اقرأ ملخص حساب الزبون: لنا، علينا، والمتبقي المالي، مفصولًا حسب العملة.',
    strict: true,
    parameters: customerToolParameters,
  },
  {
    type: 'function',
    name: 'get_card_last_operation',
    description: 'اقرأ آخر عملية غير محذوفة على بطاقة محددة، ولا يغير البيانات.',
    strict: true,
    parameters: cardToolParameters,
  },
  {
    type: 'function',
    name: 'get_card_remaining',
    description: 'احسب المتبقي داخل بطاقة محددة من المبلغ الأصلي ناقص عمليات السحب غير المحذوفة.',
    strict: true,
    parameters: cardToolParameters,
  },
  {
    type: 'function',
    name: 'get_customer_full_summary',
    description: 'اقرأ ملخصًا مختصرًا كاملًا للزبون عند طلب الحساب كاملًا فقط.',
    strict: true,
    parameters: customerToolParameters,
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
  if (name === 'find_customer' || name === 'search_customers') return searchCustomersForTool(args);
  if (name === 'get_customer_debt_summary') return getCustomerReadAnswerForTool(args, 'DEBT_SUMMARY');
  if (name === 'get_customer_cards_summary') return getCustomerReadAnswerForTool(args, (args as any)?.details ? 'CARDS_DETAILS' : 'CARDS_SUMMARY');
  if (name === 'get_customer_deliveries_summary') return getCustomerReadAnswerForTool(args, 'DELIVERIES_SUMMARY');
  if (name === 'get_customer_account_summary') return getCustomerReadAnswerForTool(args, 'ACCOUNT_SUMMARY');
  if (name === 'get_card_last_operation') return getCardReadAnswerForTool(args, 'CARD_LAST_OPERATION');
  if (name === 'get_card_remaining') return getCardReadAnswerForTool(args, 'CARD_REMAINING');
  if (name === 'get_customer_full_summary' || name === 'get_customer_snapshot') return getCustomerReadAnswerForTool(args, 'FULL_SUMMARY');
  if (name === 'read_recent_audit_logs') return readRecentAuditLogsForTool(args);
  return { error: 'UNKNOWN_TOOL' };
}

function assistantInstructions() {
  return `
أنت مساعد عربي داخل منظومة مالية. افهم العربية واللهجة الليبية وحول كلام المستخدم إلى intent JSON فقط.
لا تنفذ كتابة. الكتابة دائما معاينة ثم تأكيد من المستخدم.
استخدم أدوات القراءة فقط عند الحاجة للبحث عن زبون أو بطاقة أو سجل تدقيق، لكن لا تعتمد على نفسك في أي جمع أو طرح مالي.
نتائج الأدوات داخلية فقط. لا تعرض JSON أو أسماء الحقول أو function calls للمستخدم.
إذا تكرر الاسم أو نقص كود الزبون في أمر يحتاج زبونا موجودا، اسأل عن الكود ولا تخمن.
لا تطلب أو تعرض CVV أو أسرار. لا تقترح SQL ولا أسماء جداول ولا حذف نهائي.
قواعد البطاقات: القيمة الأصلية الافتراضية 2000 USD منفصلة عن السعر المتفق عليه. كرت 100 يخصم 101، كرت 300 يخصم 292، كرت 500 يخصم 476. الفاتورة تخصم المبلغ المكتوب. التصفية تخصم المتبقي أو المبلغ المحدد.
لنا = DEBT، علينا = CREDIT. "تم السداد" يعني SUBTRACT وحركة REPAYMENT من الجانب الحالي.
في أسئلة القراءة اختر queryMode بدقة:
- DEBT_SUMMARY عند سؤال الدين فقط.
- CARDS_SUMMARY عند سؤال البطاقات كملخص.
- CARDS_DETAILS عند طلب التفاصيل أو كل بطاقة منفصلة.
- DELIVERIES_SUMMARY عند سؤال ما استلمه الزبون أو ما تم تسليمه له.
- FINANCIAL_REMAINING عند سؤال المتبقي المالي للزبون.
- ACCOUNT_SUMMARY عند سؤال حساب الزبون أو لنا وعلينا.
- CARD_LAST_OPERATION عند سؤال آخر عملية على بطاقة.
- CARD_REMAINING عند سؤال المتبقي داخل بطاقة.
- FULL_SUMMARY عند طلب ملخص كامل فقط.
أعد JSON فقط بهذا الشكل: {"intent": {...}, "reply": "جملة عربية قصيرة اختيارية"}.
أنواع intent المسموحة:
- ASK_CLARIFICATION: question, missingFields
- QUERY_CUSTOMER: customerCode أو customerName, includeCards, includeWallet, queryMode, cardPublicCode أو cardLast4, currencyCode
- EXPLAIN_AUDIT: query أو customerCode أو transactionNumber أو entityId
- CREATE_CUSTOMER_WITH_CARDS: customerName, phone, currencyCode, agreedAmountPerCard, valueUsdPerCard, cards أو cardCount
- ADD_CARD_OPERATION: customerCode أو customerName, cardPublicCode أو cardLast4, operationType, categoryCode, quantity, amount, note, reason
- RECORD_CUSTOMER_DELIVERY: customerCode أو customerName, amount, currencyCode, paymentMethod, note
- ADD_WALLET_SETTLEMENT: customerCode أو customerName, accountType, direction, amount, currencyCode, paymentMethod, reason, note, movementKind, effectMode
`.trim();
}

function reasoningEffortFor(command: string) {
  const normalized = command.trim();
  const isLong = normalized.length > 260 || normalized.split(/\s+/).length > 45;
  const hasMixedMoney =
    /(دولار|USD|\$)/i.test(normalized) &&
    (/(دينار|LYD|د\.ل)/i.test(normalized) || /(USDT|تيثر)/i.test(normalized));
  const hasMessyFinancialRequest = /(تفاصيل|كامل|حساب|لنا|علينا|المتبقي|سداد|سدد|سدّد|استلم)/.test(normalized) && /[,،؛]/.test(normalized);
  return isLong || hasMixedMoney || hasMessyFinancialRequest ? 'high' : 'medium';
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
      reasoning: { effort: reasoningEffortFor(command) } as any,
      text: { format: modelIntentTextFormat } as any,
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
        reasoning: { effort: reasoningEffortFor(command) } as any,
        text: { format: modelIntentTextFormat } as any,
      } as any),
    );
  }

  const raw = response.output_text || '';
  const parsed = modelIntentOutputSchema.safeParse(removeNullFields(extractJson(raw)));
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
    const duplicateMatches = matches.map((person) => ({ code: person.customerNo, name: person.fullName }));
    return {
      ok: false,
      message: formatDuplicateCustomers(duplicateMatches),
      missingFields: ['customerCode'],
      matches: duplicateMatches,
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

function decimalMaxZero(value: Prisma.Decimal) {
  return value.gt(0) ? value : D(0);
}

function currencyAmount(currency: { code?: string | null; symbol?: string | null } | null | undefined, amount: unknown): AssistantAmount | null {
  if (!currency?.code) return null;
  return { amount, currencyCode: currency.code, currencySymbol: currency.symbol };
}

function addCurrencyAmount(
  map: Map<string, { amount: Prisma.Decimal; currencyCode: string; currencySymbol?: string | null }>,
  currency: { code?: string | null; symbol?: string | null } | null | undefined,
  amount: unknown,
) {
  if (!currency?.code) return;
  const existing = map.get(currency.code);
  if (existing) existing.amount = existing.amount.add(D(amount || 0));
  else map.set(currency.code, { amount: D(amount || 0), currencyCode: currency.code, currencySymbol: currency.symbol });
}

function ensureCurrencyAmount(
  map: Map<string, { amount: Prisma.Decimal; currencyCode: string; currencySymbol?: string | null }>,
  currency: { code?: string | null; symbol?: string | null } | null | undefined,
) {
  if (!currency?.code || map.has(currency.code)) return;
  map.set(currency.code, { amount: D(0), currencyCode: currency.code, currencySymbol: currency.symbol });
}

function currencyMapToAmounts(map: Map<string, { amount: Prisma.Decimal; currencyCode: string; currencySymbol?: string | null }>) {
  return Array.from(map.values()).map((item) => ({
    amount: item.amount.toString(),
    currencyCode: item.currencyCode,
    currencySymbol: item.currencySymbol,
  }));
}

function filterAmountsByCurrency(amounts: AssistantAmount[], currencyCode?: string) {
  if (!currencyCode) return amounts;
  return amounts.filter((item) => item.currencyCode === currencyCode);
}

function filterCustomerViewByCurrency(view: AssistantCustomerReadView, currencyCode?: string): AssistantCustomerReadView {
  if (!currencyCode) return view;
  return {
    ...view,
    agreedByCurrency: filterAmountsByCurrency(view.agreedByCurrency, currencyCode),
    deliveredByCurrency: filterAmountsByCurrency(view.deliveredByCurrency, currencyCode),
    financialRemainingByCurrency: filterAmountsByCurrency(view.financialRemainingByCurrency, currencyCode),
    walletDebtByCurrency: filterAmountsByCurrency(view.walletDebtByCurrency, currencyCode),
    walletCreditByCurrency: filterAmountsByCurrency(view.walletCreditByCurrency, currencyCode),
  };
}

function latestActivityOf(
  current: AssistantCustomerReadView['latestActivity'],
  candidate: AssistantCustomerReadView['latestActivity'],
) {
  if (!candidate) return current;
  if (!current) return candidate;
  return new Date(candidate.occurredAt).getTime() > new Date(current.occurredAt).getTime() ? candidate : current;
}

function cardViewFromRecord(card: any): AssistantCustomerCardView {
  const operations = Array.isArray(card.operations) ? card.operations : [];
  const deducted = operations.reduce((sum: Prisma.Decimal, operation: any) => {
    return isCardDeductionOperation(operation.operationType) ? sum.add(D(operation.amount || 0)) : sum;
  }, D(0));
  const remaining = decimalMaxZero(D(card.valueUsd || 0).sub(deducted));
  const currency = card.settlementCurrency || card.batch?.currency || null;
  const lastOperation = operations[0];
  const operationLabel =
    lastOperation && cardOperationTypeLabels[lastOperation.operationType as keyof typeof cardOperationTypeLabels]
      ? cardOperationTypeLabels[lastOperation.operationType as keyof typeof cardOperationTypeLabels]
      : lastOperation?.operationType;

  return {
    publicCode: card.publicCode,
    cardLast4: card.cardLast4,
    bankName: card.bankName,
    originalAmount: D(card.valueUsd || 0).toString(),
    agreedAmount: D(card.agreedAmount || 0).toString(),
    agreedCurrencyCode: currency?.code || 'USD',
    agreedCurrencySymbol: currency?.symbol,
    deductedAmount: deducted.toString(),
    remainingAmount: remaining.toString(),
    status: card.status,
    lastOperation: lastOperation
      ? {
          label: operationLabel || 'حركة بطاقة',
          amount: D(lastOperation.amount || 0).toString(),
          currencyCode: 'USD',
          currencySymbol: '$',
          occurredAt: lastOperation.occurredAt,
        }
      : null,
  };
}

async function getCustomerReadView(tx: Tx, person: Person): Promise<AssistantCustomerReadView> {
  const [currencies, cards, deliveries, transactions, settlements] = await Promise.all([
    tx.currency.findMany({ where: { isActive: true } }),
    tx.receivedCustomerCard.findMany({
      where: { deletedAt: null, status: { not: 'CANCELLED' }, batch: { personId: person.id } },
      include: {
        settlementCurrency: true,
        batch: { include: { currency: true } },
        operations: {
          where: { deletedAt: null },
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    tx.customerCardDelivery.findMany({
      where: { personId: person.id, deletedAt: null },
      include: { currency: true },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    }),
    tx.financialTransaction.findMany({
      where: { personId: person.id, deletedAt: null },
      include: { currency: true },
      orderBy: [{ transactionAt: 'desc' }, { createdAt: 'desc' }],
    }),
    tx.customerWalletSettlement.findMany({
      where: { personId: person.id, deletedAt: null },
      include: { currency: true },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);

  const agreedMap = new Map<string, { amount: Prisma.Decimal; currencyCode: string; currencySymbol?: string | null }>();
  const deliveredMap = new Map<string, { amount: Prisma.Decimal; currencyCode: string; currencySymbol?: string | null }>();
  const remainingMap = new Map<string, { amount: Prisma.Decimal; currencyCode: string; currencySymbol?: string | null }>();
  const cardViews: AssistantCustomerCardView[] = [];
  let totalOriginalUsd = D(0);
  let latestActivity: AssistantCustomerReadView['latestActivity'] = null;

  for (const card of cards) {
    const cardView = cardViewFromRecord(card);
    const settlementCurrency = card.settlementCurrency || card.batch.currency || null;
    cardViews.push(cardView);
    totalOriginalUsd = totalOriginalUsd.add(D(card.valueUsd || 0));
    addCurrencyAmount(agreedMap, settlementCurrency, card.agreedAmount);
    ensureCurrencyAmount(deliveredMap, settlementCurrency);

    for (const operation of card.operations) {
      latestActivity = latestActivityOf(latestActivity, {
        label: cardOperationTypeLabels[operation.operationType as keyof typeof cardOperationTypeLabels] || 'حركة بطاقة',
        occurredAt: operation.occurredAt,
      });
    }
  }

  for (const delivery of deliveries) {
    addCurrencyAmount(deliveredMap, delivery.currency, delivery.amount);
    latestActivity = latestActivityOf(latestActivity, { label: 'تسليم للزبون', occurredAt: delivery.occurredAt });
  }

  for (const [currencyCode, agreed] of agreedMap.entries()) {
    const delivered = deliveredMap.get(currencyCode);
    remainingMap.set(currencyCode, {
      amount: agreed.amount.sub(delivered?.amount || 0),
      currencyCode: agreed.currencyCode,
      currencySymbol: agreed.currencySymbol,
    });
  }

  for (const [currencyCode, delivered] of deliveredMap.entries()) {
    if (!remainingMap.has(currencyCode)) {
      remainingMap.set(currencyCode, {
        amount: D(0).sub(delivered.amount),
        currencyCode: delivered.currencyCode,
        currencySymbol: delivered.currencySymbol,
      });
    }
  }

  const wallet = buildWalletSnapshot(transactions, settlements, currencies);
  const walletDebtByCurrency = wallet.totals.debt.map((item) => currencyAmount(item.currency, item.amount)).filter(Boolean) as AssistantAmount[];
  const walletCreditByCurrency = wallet.totals.credit.map((item) => currencyAmount(item.currency, item.amount)).filter(Boolean) as AssistantAmount[];

  for (const transaction of transactions) {
    latestActivity = latestActivityOf(latestActivity, { label: 'عملية مالية', occurredAt: transaction.transactionAt });
  }
  for (const settlement of settlements) {
    latestActivity = latestActivityOf(latestActivity, { label: 'حركة لنا وعلينا', occurredAt: settlement.occurredAt });
  }

  return {
    customer: { code: person.customerNo, name: person.fullName },
    cards: cardViews,
    totalOriginalUsd: totalOriginalUsd.toString(),
    agreedByCurrency: currencyMapToAmounts(agreedMap),
    deliveredByCurrency: currencyMapToAmounts(deliveredMap),
    financialRemainingByCurrency: currencyMapToAmounts(remainingMap),
    walletDebtByCurrency,
    walletCreditByCurrency,
    hasDeliveries: deliveries.length > 0,
    latestActivity,
  };
}

async function getSystemAccountView(tx: Tx): Promise<AssistantSystemAccountView> {
  const [currencies, transactions, settlements] = await Promise.all([
    tx.currency.findMany({ where: { isActive: true } }),
    tx.financialTransaction.findMany({
      where: { deletedAt: null, person: { deletedAt: null, status: 'ACTIVE' } },
      include: { currency: true },
      orderBy: [{ transactionAt: 'desc' }, { createdAt: 'desc' }],
    }),
    tx.customerWalletSettlement.findMany({
      where: { deletedAt: null, person: { deletedAt: null, status: 'ACTIVE' } },
      include: { currency: true },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);

  const wallet = buildWalletSnapshot(transactions, settlements, currencies);
  let latestActivity: AssistantSystemAccountView['latestActivity'] = null;
  for (const transaction of transactions) {
    latestActivity = latestActivityOf(latestActivity, { label: 'عملية مالية', occurredAt: transaction.transactionAt });
  }
  for (const settlement of settlements) {
    latestActivity = latestActivityOf(latestActivity, { label: 'حركة لنا وعلينا', occurredAt: settlement.occurredAt });
  }

  return {
    walletDebtByCurrency: wallet.totals.debt.map((item) => currencyAmount(item.currency, item.amount)).filter(Boolean) as AssistantAmount[],
    walletCreditByCurrency: wallet.totals.credit.map((item) => currencyAmount(item.currency, item.amount)).filter(Boolean) as AssistantAmount[],
    latestActivity,
  };
}

async function resolveCardForRead(
  tx: Tx,
  intent: Extract<AssistantIntent, { type: 'QUERY_CUSTOMER' }>,
): Promise<
  | { ok: true; card: AssistantCustomerCardView; customer: { code?: string | null; name: string } }
  | { ok: false; message: string; missingFields: string[] }
> {
  const cardPublicCode = intent.cardPublicCode?.trim();
  const cardLast4 = intent.cardLast4?.trim();
  if (!cardPublicCode && !cardLast4) return { ok: false, message: 'أحتاج رقم البطاقة أو آخر 4 أرقام.', missingFields: ['cardLast4'] };

  const personResult = intent.customerCode || intent.customerName ? await resolvePerson(tx, intent) : null;
  if (personResult && !personResult.ok) return { ok: false, message: personResult.message, missingFields: personResult.missingFields };

  const cards = await tx.receivedCustomerCard.findMany({
    where: {
      deletedAt: null,
      status: { not: 'CANCELLED' },
      ...(cardPublicCode ? { publicCode: cardPublicCode } : { cardLast4 }),
      ...(personResult?.ok ? { batch: { personId: personResult.person.id } } : {}),
    },
    include: {
      settlementCurrency: true,
      batch: { include: { currency: true, person: true } },
      operations: {
        where: { deletedAt: null },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 8,
  });

  if (cards.length === 1) {
    const card = cards[0];
    return {
      ok: true,
      card: cardViewFromRecord(card),
      customer: { code: card.batch.person.customerNo, name: card.batch.person.fullName },
    };
  }

  if (cards.length > 1) {
    return {
      ok: false,
      message: [
        'وجدت أكثر من بطاقة بهذا الرقم. حدد كود البطاقة أو الزبون:',
        ...cards.map((card) =>
          `${card.batch.person.customerNo || 'بدون كود'} - ${card.batch.person.fullName} - ${card.publicCode || 'بطاقة'}${card.cardLast4 ? ` - ${card.cardLast4}` : ''}`,
        ),
      ].join('\n'),
      missingFields: ['cardPublicCode'],
    };
  }

  return { ok: false, message: 'لم أجد البطاقة المطلوبة.', missingFields: ['cardLast4'] };
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
    const mode = (intent.queryMode || 'FULL_SUMMARY') as AssistantReadQueryMode;

    if (mode === 'CARD_LAST_OPERATION' || mode === 'CARD_REMAINING') {
      const cardResult = await db.$transaction((tx) => resolveCardForRead(tx, intent));
      if (!cardResult.ok) return clarify(cardResult.message, cardResult.missingFields);
      return answer(formatCardReadAnswer(mode, cardResult.card, cardResult.customer));
    }

    if (mode === 'ACCOUNT_SUMMARY' && !intent.customerCode && !intent.customerName) {
      const systemView = await db.$transaction((tx) => getSystemAccountView(tx));
      return answer(formatSystemAccountAnswer(systemView));
    }

    const readView = await db.$transaction(async (tx) => {
      const personResult = await resolvePerson(tx, intent);
      if (!personResult.ok) return personResult;
      return filterCustomerViewByCurrency(await getCustomerReadView(tx, personResult.person), intent.currencyCode);
    });

    if ((readView as any).ok === false) return clarify((readView as any).message, (readView as any).missingFields);
    return answer(formatCustomerReadAnswer(mode, readView as AssistantCustomerReadView));
  }

  if (intent.type === 'EXPLAIN_AUDIT') {
    const auditResult = await readRecentAuditLogsForTool(intent);
    return answer(formatAuditLogsAnswer(auditResult.logs));
  }

  return clarify('أحتاج توضيحًا أكثر للأمر المطلوب.', []);
}

export async function handleAssistantCommand(input: {
  command: string;
  transcript?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  session: SessionLike;
}) {
  const deterministicReadIntent = tryBuildDeterministicReadIntent(input.command);
  if (deterministicReadIntent) {
    await audit('ASSISTANT_COMMAND_PREVIEW', {
      entityType: 'AssistantCommand',
      entityId: undefined,
      newValue: {
        originalCommand: input.command,
        transcript: input.transcript || null,
        intent: deterministicReadIntent,
        model: 'deterministic-read-parser',
      } as any,
      description: 'قراءة حتمية من المساعد الذكي',
    });
    return buildAssistantPreviewFromIntent(deterministicReadIntent, input.command, input.session, input.transcript);
  }

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

async function getCardReadById(tx: Tx, cardId: string) {
  const card = await tx.receivedCustomerCard.findFirst({
    where: { id: cardId, deletedAt: null },
    include: {
      settlementCurrency: true,
      batch: { include: { currency: true, person: true } },
      operations: {
        where: { deletedAt: null },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      },
    },
  });
  if (!card) return null;
  return {
    card: cardViewFromRecord(card),
    customer: { code: card.batch.person.customerNo, name: card.batch.person.fullName },
  };
}

async function readCustomerViewById(personId: string, currencyCode?: string) {
  return db.$transaction(async (tx) => {
    const person = await tx.person.findFirst({ where: { id: personId, deletedAt: null, status: 'ACTIVE' } });
    if (!person) return null;
    return filterCustomerViewByCurrency(await getCustomerReadView(tx, person), currencyCode);
  });
}

async function buildPostExecutionMessage(intent: AssistantIntent, execution: any) {
  if (!execution?.personId && !execution?.cardId) return 'تم حفظ العملية، لكن لم أجد سجلًا كافيًا لإعادة قراءة الرصيد.';

  if (intent.type === 'ADD_CARD_OPERATION' && execution.cardId) {
    const cardResult = await db.$transaction((tx) => getCardReadById(tx, execution.cardId));
    if (!cardResult) return 'تم حفظ حركة البطاقة، لكن تعذرت إعادة قراءة البطاقة.';
    return ['تم تسجيل حركة البطاقة.', formatCardReadAnswer('CARD_REMAINING', cardResult.card, cardResult.customer)].join('\n\n');
  }

  if (intent.type === 'RECORD_CUSTOMER_DELIVERY') {
    const view = await readCustomerViewById(execution.personId, intent.currencyCode);
    if (!view) return 'تم حفظ التسليم، لكن تعذرت إعادة قراءة حساب الزبون.';
    return ['تم تسجيل التسليم.', formatCustomerReadAnswer('DELIVERIES_SUMMARY', view)].join('\n\n');
  }

  if (intent.type === 'ADD_WALLET_SETTLEMENT') {
    const view = await readCustomerViewById(execution.personId, intent.currencyCode);
    if (!view) return 'تم حفظ الحركة، لكن تعذرت إعادة قراءة حساب الزبون.';
    const mode: AssistantReadQueryMode = intent.accountType === 'DEBT' ? 'DEBT_SUMMARY' : 'ACCOUNT_SUMMARY';
    return [intent.movementKind === 'REPAYMENT' ? 'تم تسجيل السداد.' : 'تم تسجيل حركة الحساب.', formatCustomerReadAnswer(mode, view)].join('\n\n');
  }

  if (intent.type === 'CREATE_CUSTOMER_WITH_CARDS') {
    const view = await readCustomerViewById(execution.personId, intent.currencyCode);
    if (!view) return 'تم حفظ الزبون والبطاقات، لكن تعذرت إعادة قراءة الحساب.';
    return ['تمت إضافة الزبون والبطاقات.', formatCustomerReadAnswer('CARDS_SUMMARY', view)].join('\n\n');
  }

  return 'تم حفظ العملية وإعادة قراءة السجل بنجاح.';
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
  const message = result.duplicated
    ? 'هذه العملية منفذة سابقًا ولم يتم تكرارها.'
    : enforceArabicAssistantMessage(await buildPostExecutionMessage(payload.intent, result.result as any));

  return {
    duplicated: result.duplicated,
    auditLogId: result.auditLogId,
    message,
  };
}
