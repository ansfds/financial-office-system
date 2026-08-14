import { z } from 'zod';

export const assistantCurrencyCodeSchema = z.enum(['USD', 'LYD', 'USDT', 'CNY']);

export const assistantPaymentMethodSchema = z
  .enum([
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
  ])
  .optional();

export const assistantCardInputSchema = z.object({
  cardLast4: z.string().trim().regex(/^\d{4}$/).optional(),
  bankName: z.string().trim().min(1).max(80).optional(),
  valueUsd: z.coerce.number().positive().default(2000),
  agreedAmount: z.coerce.number().positive().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const createCustomerWithCardsIntentSchema = z.object({
  type: z.literal('CREATE_CUSTOMER_WITH_CARDS'),
  customerName: z.string().trim().min(2).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(180).optional(),
  notes: z.string().trim().max(700).optional(),
  category: z.enum(['VIP', 'REGULAR']).default('REGULAR'),
  currencyCode: assistantCurrencyCodeSchema.optional(),
  agreedAmountPerCard: z.coerce.number().positive().optional(),
  valueUsdPerCard: z.coerce.number().positive().default(2000),
  cards: z.array(assistantCardInputSchema).min(1).max(60).optional(),
  cardCount: z.coerce.number().int().min(1).max(60).optional(),
});

export const cardOperationIntentSchema = z.object({
  type: z.literal('ADD_CARD_OPERATION'),
  customerCode: z.string().trim().max(30).optional(),
  customerName: z.string().trim().min(2).optional(),
  cardPublicCode: z.string().trim().max(30).optional(),
  cardLast4: z.string().trim().regex(/^\d{4}$/).optional(),
  operationType: z.enum(['GIFT_CARD', 'INVOICE', 'FINAL_SETTLEMENT', 'REJECT']),
  categoryCode: z.enum(['100', '300', '500']).optional(),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  amount: z.coerce.number().min(0).optional(),
  note: z.string().trim().max(700).optional(),
  reason: z.string().trim().max(700).optional(),
});

export const customerDeliveryIntentSchema = z.object({
  type: z.literal('RECORD_CUSTOMER_DELIVERY'),
  customerCode: z.string().trim().max(30).optional(),
  customerName: z.string().trim().min(2).optional(),
  amount: z.coerce.number().positive().optional(),
  currencyCode: assistantCurrencyCodeSchema.optional(),
  paymentMethod: assistantPaymentMethodSchema,
  note: z.string().trim().max(700).optional(),
});

export const walletSettlementIntentSchema = z.object({
  type: z.literal('ADD_WALLET_SETTLEMENT'),
  customerCode: z.string().trim().max(30).optional(),
  customerName: z.string().trim().min(2).optional(),
  accountType: z.enum(['DEBT', 'CREDIT']).optional(),
  direction: z.enum(['ADD', 'SUBTRACT']).optional(),
  amount: z.coerce.number().positive().optional(),
  currencyCode: assistantCurrencyCodeSchema.optional(),
  paymentMethod: assistantPaymentMethodSchema,
  reason: z.string().trim().max(220).optional(),
  note: z.string().trim().max(700).optional(),
  movementKind: z.enum(['ADJUSTMENT', 'REPAYMENT']).default('ADJUSTMENT'),
  effectMode: z.enum(['NORMAL', 'OFFSET']).default('NORMAL'),
});

export const queryCustomerIntentSchema = z.object({
  type: z.literal('QUERY_CUSTOMER'),
  customerCode: z.string().trim().max(30).optional(),
  customerName: z.string().trim().min(2).optional(),
  includeCards: z.boolean().default(true),
  includeWallet: z.boolean().default(true),
});

export const explainAuditIntentSchema = z.object({
  type: z.literal('EXPLAIN_AUDIT'),
  query: z.string().trim().max(160).optional(),
  customerCode: z.string().trim().max(30).optional(),
  transactionNumber: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(80).optional(),
});

export const clarificationIntentSchema = z.object({
  type: z.literal('ASK_CLARIFICATION'),
  question: z.string().trim().min(2).max(700),
  missingFields: z.array(z.string().trim().min(1).max(80)).default([]),
});

export const assistantIntentSchema = z.discriminatedUnion('type', [
  createCustomerWithCardsIntentSchema,
  cardOperationIntentSchema,
  customerDeliveryIntentSchema,
  walletSettlementIntentSchema,
  queryCustomerIntentSchema,
  explainAuditIntentSchema,
  clarificationIntentSchema,
]);

export type AssistantIntent = z.infer<typeof assistantIntentSchema>;

export const assistantWriteIntentTypes = [
  'CREATE_CUSTOMER_WITH_CARDS',
  'ADD_CARD_OPERATION',
  'RECORD_CUSTOMER_DELIVERY',
  'ADD_WALLET_SETTLEMENT',
] as const;

export type AssistantWriteIntentType = (typeof assistantWriteIntentTypes)[number];

export function isAssistantWriteIntent(intent: AssistantIntent): intent is Extract<AssistantIntent, { type: AssistantWriteIntentType }> {
  return assistantWriteIntentTypes.includes(intent.type as AssistantWriteIntentType);
}

export const assistantMessageRequestSchema = z.object({
  command: z.string().trim().min(2).max(2000),
  transcript: z.string().trim().max(4000).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().max(1000),
      }),
    )
    .max(6)
    .optional(),
});

export const assistantConfirmRequestSchema = z.object({
  confirmationToken: z.string().trim().min(20).max(50000),
});

export type AssistantResponse =
  | {
      type: 'setup_required';
      message: string;
    }
  | {
      type: 'clarify';
      message: string;
      missingFields: string[];
    }
  | {
      type: 'answer';
      message: string;
      answer: unknown;
    }
  | {
      type: 'preview';
      message: string;
      preview: AssistantPreview;
      confirmationToken: string;
    };

export type AssistantPreviewLine = {
  label: string;
  value: string;
};

export type AssistantPreview = {
  idempotencyKey: string;
  action: AssistantWriteIntentType;
  actionLabel: string;
  originalCommand: string;
  customer?: {
    id?: string;
    code?: string | null;
    name: string;
    phone?: string | null;
  };
  cards?: Array<{
    id?: string;
    publicCode?: string | null;
    cardLast4?: string | null;
    bankName?: string | null;
    valueUsd?: string;
    agreedAmount?: string;
    amount?: string;
    balanceBefore?: string;
    balanceAfter?: string;
  }>;
  amount?: {
    value: string;
    currencyCode?: string;
    paymentMethod?: string | null;
  };
  balances?: Array<{
    label: string;
    before: string;
    after: string;
    currencyCode?: string;
  }>;
  lines: AssistantPreviewLine[];
  warnings: string[];
  missingFields: string[];
  intent: AssistantIntent;
};
