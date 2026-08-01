import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { D, statusOf } from '@/lib/money';
import { createCashboxMovement } from '@/lib/cashbox';
import { formatMoney } from '@/lib/format';
import {
  detailedPaymentCurrencyCode,
  detailedPaymentLabels,
  detailedPaymentMethods,
  normalizeDetailedPaymentMethod,
  paymentMethodForCurrency,
  simplePaymentLabels,
  simplePaymentMethods,
} from '@/lib/payment-methods';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const TRANSACTION_KIND = {
  STANDARD: 'STANDARD',
  CURRENCY_CONVERSION: 'CURRENCY_CONVERSION',
  SHEIN_CARD_SALE: 'SHEIN_CARD_SALE',
} as const;

const OPERATION_KIND = {
  MANUAL: 'MANUAL',
  USDT: 'USDT',
  CARD_OPERATION: 'CARD_OPERATION',
  CASHBOX_MOVEMENT: 'CASHBOX_MOVEMENT',
  CURRENCY_CONVERSION: 'CURRENCY_CONVERSION',
  MONEY_TRANSFER: 'MONEY_TRANSFER',
  SHEIN_CARD_SALE: 'SHEIN_CARD_SALE',
  EXPENSE: 'EXPENSE',
} as const;

const EXECUTION_STATUS = {
  COMPLETED: 'COMPLETED',
  PENDING: 'PENDING',
  NOT_EXECUTED: 'NOT_EXECUTED',
} as const;

const NOT_EXECUTED_ACTION = {
  REFUND: 'REFUND',
  CONVERT_TO_WALLET: 'CONVERT_TO_WALLET',
  KEEP_WITH_NOTE: 'KEEP_WITH_NOTE',
} as const;

const transactionDetailedPaymentMethods = [...detailedPaymentMethods, 'CARD'] as [string, ...string[]];

const operationKindSchema = z.enum([
  OPERATION_KIND.MANUAL,
  OPERATION_KIND.USDT,
  OPERATION_KIND.CARD_OPERATION,
  OPERATION_KIND.CASHBOX_MOVEMENT,
  OPERATION_KIND.CURRENCY_CONVERSION,
  OPERATION_KIND.MONEY_TRANSFER,
  OPERATION_KIND.SHEIN_CARD_SALE,
  OPERATION_KIND.EXPENSE,
]);

const executionStatusSchema = z.enum([
  EXECUTION_STATUS.COMPLETED,
  EXECUTION_STATUS.PENDING,
  EXECUTION_STATUS.NOT_EXECUTED,
]);

const requiredPositiveNumber = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce.number().positive(),
);
const requiredNonNegativeNumber = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce.number().min(0),
);
const optionalPositiveNumber = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number().positive().optional(),
);

const transactionSchema = z.object({
  operationKind: operationKindSchema.optional(),
  transactionKind: z
    .enum([TRANSACTION_KIND.STANDARD, TRANSACTION_KIND.CURRENCY_CONVERSION, TRANSACTION_KIND.SHEIN_CARD_SALE])
    .optional()
    .default(TRANSACTION_KIND.STANDARD),
  personId: z.string().optional().nullable(),
  typeId: z.string().optional().nullable(),
  customType: z.string().trim().optional(),
  description: z.string().trim().optional(),
  executionType: z.string().trim().optional(),
  currencyId: z.string().optional(),
  agreedAmount: z.coerce.number().positive().optional(),
  receivedAmount: z.coerce.number().min(0).default(0),
  paidAmount: z.coerce.number().min(0).default(0),
  exchangeRate: z.coerce.number().positive().optional().nullable(),
  transactionAt: z.string().optional(),
  dueAt: z.string().optional().nullable(),
  txId: z.string().trim().optional(),
  cardNumber: z.string().trim().optional(),
  bankName: z.string().trim().optional(),
  verificationReceived: z.coerce.boolean().default(false),
  secureInternalNote: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  executionStatus: executionStatusSchema.optional().default(EXECUTION_STATUS.COMPLETED),
  executionNote: z.string().trim().optional(),
  notExecutedAction: z
    .enum([NOT_EXECUTED_ACTION.REFUND, NOT_EXECUTED_ACTION.CONVERT_TO_WALLET, NOT_EXECUTED_ACTION.KEEP_WITH_NOTE])
    .optional()
    .nullable(),
  manual: z
    .object({
      currencyId: z.string().min(1),
      amount: z.coerce.number().positive(),
      cashDirection: z.enum(['IN', 'OUT', 'NONE']),
      movementMethod: z.enum(simplePaymentMethods).default('CASH'),
    })
    .optional(),
  usdt: z
    .object({
      action: z.enum(['BUY', 'SELL']),
      network: z.string().trim().min(1),
      usdtAmount: requiredPositiveNumber,
      commissionPercent: requiredNonNegativeNumber,
      paymentCurrencyCode: z.enum(['USD', 'LYD']),
      paymentMethod: z.enum(simplePaymentMethods).default('CASH'),
      exchangeRate: optionalPositiveNumber,
      txId: z.string().trim().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.paymentCurrencyCode === 'LYD' && !value.exchangeRate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'سعر الصرف مطلوب عند الدفع بالدينار',
          path: ['exchangeRate'],
        });
      }
    })
    .optional(),
  cardOperation: z
    .object({
      action: z.enum(['RECEIVE_CARD', 'PAY_CARD_VALUE', 'WITHDRAW_FROM_CARD']),
      cardCount: z.coerce.number().int().positive(),
      cardValue: z.coerce.number().positive(),
      currencyId: z.string().min(1),
      paymentAmount: z.coerce.number().min(0).default(0),
      paymentMethod: z.enum(transactionDetailedPaymentMethods),
      cardStatus: z
        .enum(['RECEIVED', 'IN_SETTLEMENT', 'SETTLED', 'PARTIAL', 'COMPLETED', 'CANCELLED'])
        .default('RECEIVED'),
    })
    .optional(),
  cashboxMovement: z
    .object({
      action: z.enum(['IN', 'OUT']),
      currencyId: z.string().min(1),
      amount: z.coerce.number().positive(),
      movementMethod: z.enum(simplePaymentMethods),
      reason: z.string().trim().min(3),
    })
    .optional(),
  conversion: z
    .object({
      action: z.enum(['SELL_CURRENCY', 'BUY_CURRENCY', 'TRANSFER_AMOUNT']).default('TRANSFER_AMOUNT'),
      fromCurrencyId: z.string().min(1),
      toCurrencyId: z.string().min(1),
      fromAmount: z.coerce.number().positive(),
      toAmount: z.coerce.number().positive(),
      exchangeRate: z.coerce.number().positive().optional(),
      paymentMethod: z.enum(simplePaymentMethods).default('CASH'),
      notes: z.string().trim().optional(),
    })
    .optional(),
  moneyTransfer: z
    .object({
      receiverName: z.string().trim().min(2),
      destination: z.string().trim().min(2),
      currencyId: z.string().min(1),
      amount: z.coerce.number().positive(),
      commission: z.coerce.number().min(0).default(0),
      paymentMethod: z.enum(simplePaymentMethods),
      status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
      transferNumber: z.string().trim().optional(),
    })
    .optional(),
  sheinSale: z
    .object({
      denomination: z.coerce.number().positive(),
      paymentMethod: z.enum(transactionDetailedPaymentMethods),
      pricePerCard: z.coerce.number().positive(),
      cardCount: z.coerce.number().int().positive(),
      notes: z.string().trim().optional(),
    })
    .optional(),
  expense: z
    .object({
      action: z.enum(['PAY_BILL', 'GENERAL_EXPENSE']),
      payee: z.string().trim().min(2),
      expenseType: z.string().trim().min(2),
      currencyId: z.string().min(1),
      amount: z.coerce.number().positive(),
      paymentMethod: z.enum(simplePaymentMethods),
      invoiceNumber: z.string().trim().optional(),
    })
    .optional(),
});

const executionItemInclude = {
  customer: { select: { id: true, fullName: true, customerNo: true } },
  sheinCard: {
    select: {
      id: true,
      code: true,
      denomination: true,
      status: true,
      buyerPersonId: true,
      linkedTransactionId: true,
      linkedExecutionItemId: true,
      usedAt: true,
    },
  },
  executedBy: { select: { id: true, username: true } },
};

const transactionInclude = {
  person: true,
  currency: true,
  type: true,
  executionItems: {
    include: executionItemInclude,
    orderBy: { createdAt: 'asc' as const },
  },
};

function transactionNumber() {
  return `TX-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`;
}

async function typeIdFor(tx: any, name: string) {
  const type = await tx.transactionType.upsert({
    where: { name },
    update: { isActive: true },
    create: { name, isActive: true },
  });
  return type.id;
}

function amountText(amount: unknown, currency?: { name?: string | null; symbol?: string | null }) {
  return formatMoney(amount, currency);
}

function normalizedPaymentMethod(method: string) {
  return normalizeDetailedPaymentMethod(method) || method;
}

function jsonDetails(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function executionItemNumber(index: number) {
  return `#${String(index).padStart(5, '0')}`;
}

function occurredAt(value?: string) {
  return value ? new Date(value) : new Date();
}

async function activeCurrency(tx: any, id: string, errorCode = 'INVALID_CURRENCY') {
  const currency = await tx.currency.findFirst({ where: { id, isActive: true } });
  if (!currency) throw new Error(errorCode);
  return currency;
}

async function activeCurrencyByCode(tx: any, code: string, errorCode = 'INVALID_CURRENCY') {
  const currency = await tx.currency.findFirst({ where: { code, isActive: true } });
  if (!currency) throw new Error(errorCode);
  return currency;
}

function legacyOperationKind(transactionKind: string) {
  if (transactionKind === TRANSACTION_KIND.CURRENCY_CONVERSION) return OPERATION_KIND.CURRENCY_CONVERSION;
  if (transactionKind === TRANSACTION_KIND.SHEIN_CARD_SALE) return OPERATION_KIND.SHEIN_CARD_SALE;
  return null;
}

export async function GET(request: Request) {
  try {
    await requireSession();

    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() || '';
    const status = url.searchParams.get('status') || undefined;
    const executionStatus = url.searchParams.get('executionStatus') || undefined;
    const page = Math.max(Number(url.searchParams.get('page') || 1), 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') || 50), 10), 100);
    const where = {
      deletedAt: null,
      status: status as any,
      executionStatus: executionStatus as any,
      OR: q
        ? [
            { number: { contains: q, mode: 'insensitive' as const } },
            { description: { contains: q, mode: 'insensitive' as const } },
            { executionType: { contains: q, mode: 'insensitive' as const } },
            { customType: { contains: q, mode: 'insensitive' as const } },
            { notes: { contains: q, mode: 'insensitive' as const } },
            { txId: { contains: q, mode: 'insensitive' as const } },
            { cardNumber: { contains: q, mode: 'insensitive' as const } },
            { bankName: { contains: q, mode: 'insensitive' as const } },
            { person: { fullName: { contains: q, mode: 'insensitive' as const } } },
            { person: { customerNo: { contains: q, mode: 'insensitive' as const } } },
          ]
        : undefined,
    };

    const [transactions, total] = await Promise.all([
      db.financialTransaction.findMany({
        where,
        select: {
          id: true,
          number: true,
          personId: true,
          typeId: true,
          customType: true,
          description: true,
          executionType: true,
          operationKind: true,
          operationDetails: true,
          agreedAmount: true,
          receivedAmount: true,
          paidAmount: true,
          bankName: true,
          verificationReceived: true,
          secureInternalNote: true,
          notes: true,
          executionStatus: true,
          executionNote: true,
          notExecutedAction: true,
          status: true,
          createdBy: true,
          transactionAt: true,
          sheinPaymentMethod: true,
          executionItems: {
            include: executionItemInclude,
            orderBy: { createdAt: 'asc' },
          },
          person: { select: { id: true, fullName: true, customerNo: true } },
          currency: { select: { id: true, code: true, name: true, symbol: true } },
          type: { select: { id: true, name: true } },
        },
        orderBy: { transactionAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.financialTransaction.count({ where }),
    ]);

    return ok({
      items: transactions,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const username = session.username || 'system';
    const userId = session.userId || undefined;

    const parsed = transactionSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات المعاملة');

    const data = parsed.data;
    const number = transactionNumber();
    const operationKind = data.operationKind || legacyOperationKind(data.transactionKind);

    const transaction = await db.$transaction(async (tx) => {
      if (operationKind === OPERATION_KIND.MANUAL) {
        if (!data.manual) throw new Error('MISSING_MANUAL_DATA');
        const currency = await activeCurrency(tx, data.manual.currencyId);
        const amount = D(data.manual.amount);
        const typeId = await typeIdFor(tx, 'نوع يدوي');
        const executionType = data.executionType || data.description || 'كتابة يدوية';
        const date = occurredAt(data.transactionAt);
        const receivedAmount = data.manual.cashDirection === 'IN' ? amount : D(0);
        const paidAmount = data.manual.cashDirection === 'OUT' ? amount : D(0);

        const created = await tx.financialTransaction.create({
          data: {
            number,
            personId: data.personId || null,
            typeId,
            customType: 'نوع يدوي',
            description: data.description || executionType,
            executionType,
            operationKind,
            operationDetails: jsonDetails({
              amount: data.manual.amount,
              currencyId: currency.id,
              currencyCode: currency.code,
              cashDirection: data.manual.cashDirection,
              movementMethod: data.manual.movementMethod,
            }),
            currencyId: currency.id,
            agreedAmount: amount,
            receivedAmount,
            paidAmount,
            receivableAmount: D(0),
            payableAmount: D(0),
            transactionAt: date,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            notes: data.notes || undefined,
            status: 'COMPLETED',
            createdBy: username,
          },
        });

        if (data.manual.cashDirection !== 'NONE') {
          await createCashboxMovement(tx, {
            currencyId: currency.id,
            transactionId: created.id,
            personId: data.personId || null,
            direction: data.manual.cashDirection,
            amount,
            paymentMethod: paymentMethodForCurrency(currency.code, data.manual.movementMethod),
            reason: executionType,
            sourceType: 'FinancialTransaction',
            sourceId: created.id,
            note: data.notes || null,
            occurredAt: date,
          });
        }

        return tx.financialTransaction.findUniqueOrThrow({
          where: { id: created.id },
          include: transactionInclude,
        });
      }

      if (operationKind === OPERATION_KIND.USDT) {
        if (!data.personId) throw new Error('USDT_REQUIRES_PERSON');
        if (!data.usdt) throw new Error('MISSING_USDT_DATA');

        const [usdtCurrency, paymentCurrency] = await Promise.all([
          activeCurrencyByCode(tx, 'USDT', 'USDT_CURRENCY_NOT_FOUND'),
          activeCurrencyByCode(tx, data.usdt.paymentCurrencyCode, 'INVALID_USDT_PAYMENT_CURRENCY'),
        ]);
        const usdtAmount = D(data.usdt.usdtAmount);
        const commissionPercent = D(data.usdt.commissionPercent);
        const commissionAmountUsd = usdtAmount.mul(commissionPercent).div(100);
        const totalUsd = usdtAmount.add(commissionAmountUsd);
        const exchangeRate = data.usdt.paymentCurrencyCode === 'LYD' ? D(data.usdt.exchangeRate) : null;
        if (data.usdt.paymentCurrencyCode === 'LYD' && (!exchangeRate || exchangeRate.lte(0))) {
          throw new Error('USDT_EXCHANGE_RATE_REQUIRED');
        }
        const totalAmount = exchangeRate ? totalUsd.mul(exchangeRate) : totalUsd;
        const actionLabel = data.usdt.action === 'SELL' ? 'بيع USDT' : 'شراء USDT';
        const paymentLabel = data.usdt.paymentCurrencyCode === 'LYD' ? 'دينار' : 'دولار';
        const executionType =
          data.executionType ||
          `${actionLabel} ${usdtAmount.toString()} USDT عبر ${data.usdt.network}، العمولة ${commissionPercent.toString()}%، الإجمالي ${amountText(
            totalUsd,
            { symbol: '$' },
          )}، الدفع ${paymentLabel}${
            exchangeRate
              ? ` بسعر صرف ${exchangeRate.toString()} = ${amountText(totalAmount, paymentCurrency)}`
              : ''
          }`;
        const typeId = await typeIdFor(tx, 'USDT');
        const date = occurredAt(data.transactionAt);

        const created = await tx.financialTransaction.create({
          data: {
            number,
            personId: data.personId,
            typeId,
            customType: 'USDT',
            description: data.description || executionType,
            executionType,
            operationKind,
            operationDetails: jsonDetails({
              action: data.usdt.action,
              network: data.usdt.network,
              usdtAmount: data.usdt.usdtAmount,
              originalUsd: usdtAmount.toString(),
              commissionPercent: commissionPercent.toString(),
              commissionAmount: commissionAmountUsd.toString(),
              commissionAmountUsd: commissionAmountUsd.toString(),
              totalUsd: totalUsd.toString(),
              totalAmount: totalAmount.toString(),
              paymentTotal: totalAmount.toString(),
              paymentCurrencyId: paymentCurrency.id,
              paymentCurrencyCode: paymentCurrency.code,
              paymentMethod: data.usdt.paymentMethod,
              exchangeRate: exchangeRate?.toString() || null,
              totalLyd: data.usdt.paymentCurrencyCode === 'LYD' ? totalAmount.toString() : null,
              txId: data.usdt.txId || data.txId || null,
            }),
            currencyId: paymentCurrency.id,
            agreedAmount: totalAmount,
            receivedAmount: data.usdt.action === 'SELL' ? totalAmount : D(0),
            paidAmount: data.usdt.action === 'BUY' ? totalAmount : D(0),
            receivableAmount: D(0),
            payableAmount: D(0),
            exchangeRate: exchangeRate || undefined,
            txId: data.usdt.txId || data.txId,
            transactionAt: date,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            notes: data.notes || undefined,
            status: 'COMPLETED',
            createdBy: username,
          },
        });

        const movements =
          data.usdt.action === 'SELL'
            ? [
                { currencyId: usdtCurrency.id, direction: 'OUT' as const, amount: usdtAmount },
                { currencyId: paymentCurrency.id, direction: 'IN' as const, amount: totalAmount },
              ]
            : [
                { currencyId: usdtCurrency.id, direction: 'IN' as const, amount: usdtAmount },
                { currencyId: paymentCurrency.id, direction: 'OUT' as const, amount: totalAmount },
              ];

        for (const movement of movements) {
          await createCashboxMovement(tx, {
            currencyId: movement.currencyId,
            transactionId: created.id,
            personId: data.personId,
            direction: movement.direction,
            amount: movement.amount,
            paymentMethod:
              movement.currencyId === usdtCurrency.id
                ? 'USDT'
                : paymentMethodForCurrency(paymentCurrency.code, data.usdt.paymentMethod),
            reason: executionType,
            sourceType: 'USDTOperation',
            sourceId: created.id,
            note: data.notes || null,
            occurredAt: date,
          });
        }

        return tx.financialTransaction.findUniqueOrThrow({
          where: { id: created.id },
          include: transactionInclude,
        });
      }

      if (operationKind === OPERATION_KIND.CARD_OPERATION) {
        if (!data.personId) throw new Error('CARD_OPERATION_REQUIRES_PERSON');
        if (!data.cardOperation) throw new Error('MISSING_CARD_OPERATION_DATA');

        const currency = await activeCurrency(tx, data.cardOperation.currencyId);
        const typeId = await typeIdFor(tx, 'عمليات بطاقة');
        const cardValue = D(data.cardOperation.cardValue);
        const cardCount = data.cardOperation.cardCount;
        const cardTotal = cardValue.mul(cardCount);
        const paymentAmount = D(data.cardOperation.paymentAmount || cardTotal);
        const initialCardStatus = data.cardOperation.action === 'RECEIVE_CARD' ? 'RECEIVED' : data.cardOperation.cardStatus;
        const paymentMethod = normalizedPaymentMethod(data.cardOperation.paymentMethod);
        const paymentLabel = detailedPaymentLabels[paymentMethod as keyof typeof detailedPaymentLabels] || paymentMethod;
        const actionLabel =
          data.cardOperation.action === 'RECEIVE_CARD'
            ? 'استلام بطاقة'
            : data.cardOperation.action === 'PAY_CARD_VALUE'
              ? 'دفع قيمة بطاقة'
              : 'سحب من بطاقة';
        const executionType =
          data.executionType ||
          `${actionLabel} ${cardCount} بطاقات، قيمة كل بطاقة ${amountText(cardValue, currency)}، الإجمالي ${amountText(
            cardTotal,
            currency,
          )}`;
        const date = occurredAt(data.transactionAt);
        const receivedAmount =
          data.cardOperation.action === 'WITHDRAW_FROM_CARD'
            ? paymentAmount
            : D(0);
        const paidAmount = data.cardOperation.action === 'PAY_CARD_VALUE' ? paymentAmount : D(0);
        let details = {
          action: data.cardOperation.action,
          cardCount,
          cardValue: data.cardOperation.cardValue,
          cardTotal: cardTotal.toString(),
          currencyId: currency.id,
          currencyCode: currency.code,
          paymentAmount: paymentAmount.toString(),
          paymentMethod,
          cardStatus: initialCardStatus,
          cashEffect: data.cardOperation.action === 'RECEIVE_CARD' ? 'NONE_ON_RECEIPT' : 'IMMEDIATE',
          receivedCardBatchId: null as string | null,
        };

        const created = await tx.financialTransaction.create({
          data: {
            number,
            personId: data.personId,
            typeId,
            customType: 'عمليات بطاقة',
            description: data.description || executionType,
            executionType,
            operationKind,
            operationDetails: jsonDetails(details),
            currencyId: currency.id,
            agreedAmount: cardTotal,
            receivedAmount,
            paidAmount,
            receivableAmount: D(0),
            payableAmount: D(0),
            transactionAt: date,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            notes: data.notes || undefined,
            status: 'COMPLETED',
            createdBy: username,
          },
        });

        if (data.cardOperation.action === 'RECEIVE_CARD') {
          const batch = await tx.receivedCardBatch.create({
            data: {
              personId: data.personId,
              currencyId: currency.id,
              receivedAt: date,
              cardCount,
              agreedAmountPerCard: cardValue,
              notes: data.notes,
            },
          });

          details = { ...details, receivedCardBatchId: batch.id };

          for (let index = 1; index <= cardCount; index += 1) {
            await tx.receivedCustomerCard.create({
              data: {
                batchId: batch.id,
                sequence: index,
                valueUsd: currency.code === 'USD' ? cardValue : D(0),
                agreedAmount: cardValue,
                settlementAmount: null,
                settlementCurrencyId: currency.id,
                settlementPaymentMethod: null,
                receivedAmount: D(0),
                status: initialCardStatus,
                notes: data.notes,
              },
            });
          }

          await tx.financialTransaction.update({
            where: { id: created.id },
            data: { operationDetails: jsonDetails(details) },
          });
        } else {
          await createCashboxMovement(tx, {
            currencyId: currency.id,
            transactionId: created.id,
            personId: data.personId,
            direction: data.cardOperation.action === 'PAY_CARD_VALUE' ? 'OUT' : 'IN',
            amount: paymentAmount,
            paymentMethod,
            reason: `${executionType} (${paymentLabel})`,
            sourceType: 'CardOperation',
            sourceId: created.id,
            note: data.notes || null,
            occurredAt: date,
          });
        }

        return tx.financialTransaction.findUniqueOrThrow({
          where: { id: created.id },
          include: transactionInclude,
        });
      }

      if (operationKind === OPERATION_KIND.CASHBOX_MOVEMENT) {
        if (!data.cashboxMovement) throw new Error('MISSING_CASHBOX_MOVEMENT_DATA');

        const currency = await activeCurrency(tx, data.cashboxMovement.currencyId);
        const amount = D(data.cashboxMovement.amount);
        const typeId = await typeIdFor(tx, 'حركة صندوق');
        const movementLabel = data.cashboxMovement.action === 'IN' ? 'دخول مبلغ' : 'خروج مبلغ';
        const executionType =
          data.executionType ||
          `${movementLabel} ${amountText(amount, currency)} ${simplePaymentLabels[data.cashboxMovement.movementMethod]} - ${
            data.cashboxMovement.reason
          }`;
        const date = occurredAt(data.transactionAt);

        const created = await tx.financialTransaction.create({
          data: {
            number,
            personId: data.personId || null,
            typeId,
            customType: 'حركة صندوق',
            description: data.description || executionType,
            executionType,
            operationKind,
            operationDetails: jsonDetails({
              action: data.cashboxMovement.action,
              amount: data.cashboxMovement.amount,
              currencyId: currency.id,
              currencyCode: currency.code,
              movementMethod: data.cashboxMovement.movementMethod,
              paymentMethod: paymentMethodForCurrency(currency.code, data.cashboxMovement.movementMethod),
              reason: data.cashboxMovement.reason,
            }),
            currencyId: currency.id,
            agreedAmount: amount,
            receivedAmount: data.cashboxMovement.action === 'IN' ? amount : D(0),
            paidAmount: data.cashboxMovement.action === 'OUT' ? amount : D(0),
            receivableAmount: D(0),
            payableAmount: D(0),
            transactionAt: date,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            notes: data.notes || undefined,
            status: 'COMPLETED',
            createdBy: username,
          },
        });

        await createCashboxMovement(tx, {
          currencyId: currency.id,
          transactionId: created.id,
          personId: data.personId || null,
          direction: data.cashboxMovement.action,
          amount,
          paymentMethod: paymentMethodForCurrency(currency.code, data.cashboxMovement.movementMethod),
          reason: data.cashboxMovement.reason,
          sourceType: 'CashboxMovement',
          sourceId: created.id,
          note: data.notes || null,
          occurredAt: date,
        });

        return tx.financialTransaction.findUniqueOrThrow({
          where: { id: created.id },
          include: transactionInclude,
        });
      }

      if (operationKind === OPERATION_KIND.CURRENCY_CONVERSION) {
        if (!data.conversion) throw new Error('MISSING_CONVERSION_DATA');
        if (data.conversion.fromCurrencyId === data.conversion.toCurrencyId) throw new Error('SAME_CONVERSION_CURRENCY');

        const currencies = await tx.currency.findMany({
          where: {
            id: { in: [data.conversion.fromCurrencyId, data.conversion.toCurrencyId] },
            isActive: true,
          },
        });
        if (currencies.length !== 2) throw new Error('INVALID_CONVERSION_CURRENCY');

        const fromCurrency = currencies.find((currency) => currency.id === data.conversion?.fromCurrencyId);
        const toCurrency = currencies.find((currency) => currency.id === data.conversion?.toCurrencyId);
        const fromAmount = D(data.conversion.fromAmount);
        const toAmount = D(data.conversion.toAmount);
        const exchangeRate = toAmount.div(fromAmount);
        const actionLabel =
          data.conversion.action === 'SELL_CURRENCY'
            ? 'بيع عملة'
            : data.conversion.action === 'BUY_CURRENCY'
              ? 'شراء عملة'
              : 'تحويل مبلغ';
        const executionType =
          data.executionType ||
          `${actionLabel} من ${amountText(fromAmount, fromCurrency)} إلى ${amountText(toAmount, toCurrency)} عبر ${
            simplePaymentLabels[data.conversion.paymentMethod]
          }`;
        const typeId = data.typeId || (await typeIdFor(tx, 'صرف / تحويل عملة'));
        const date = occurredAt(data.transactionAt);

        const created = await tx.financialTransaction.create({
          data: {
            number,
            personId: data.personId || null,
            typeId,
            customType: 'صرف / تحويل عملة',
            description: data.description || executionType,
            executionType,
            operationKind: OPERATION_KIND.CURRENCY_CONVERSION,
            operationDetails: jsonDetails({
              action: data.conversion.action,
              fromCurrencyId: data.conversion.fromCurrencyId,
              toCurrencyId: data.conversion.toCurrencyId,
              fromAmount: data.conversion.fromAmount,
              toAmount: data.conversion.toAmount,
              exchangeRate: exchangeRate.toString(),
              enteredExchangeRate: data.conversion.exchangeRate || null,
              paymentMethod: data.conversion.paymentMethod,
            }),
            currencyId: data.conversion.fromCurrencyId,
            agreedAmount: fromAmount,
            receivedAmount: D(0),
            paidAmount: fromAmount,
            receivableAmount: D(0),
            payableAmount: D(0),
            exchangeRate,
            transactionAt: date,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            notes: data.notes || data.conversion.notes || undefined,
            status: 'COMPLETED',
            createdBy: username,
          },
        });

        const fromMovement = await createCashboxMovement(tx, {
          currencyId: data.conversion.fromCurrencyId,
          transactionId: created.id,
          personId: data.personId || null,
          direction: 'OUT',
          amount: fromAmount,
          paymentMethod: paymentMethodForCurrency(fromCurrency?.code, data.conversion.paymentMethod),
          reason: executionType,
          sourceType: 'CurrencyConversion',
          note: data.notes || data.conversion.notes || null,
          occurredAt: date,
        });

        const toMovement = await createCashboxMovement(tx, {
          currencyId: data.conversion.toCurrencyId,
          transactionId: created.id,
          personId: data.personId || null,
          direction: 'IN',
          amount: toAmount,
          paymentMethod: paymentMethodForCurrency(toCurrency?.code, data.conversion.paymentMethod),
          reason: executionType,
          sourceType: 'CurrencyConversion',
          note: data.notes || data.conversion.notes || null,
          occurredAt: date,
        });

        const conversion = await tx.currencyConversion.create({
          data: {
            fromCurrencyId: data.conversion.fromCurrencyId,
            toCurrencyId: data.conversion.toCurrencyId,
            fromAmount,
            toAmount,
            exchangeRate,
            operatorName: 'system',
            notes: data.notes || data.conversion.notes || null,
            occurredAt: date,
            fromMovementId: fromMovement.id,
            toMovementId: toMovement.id,
          },
        });

        await tx.cashboxMovement.updateMany({
          where: { id: { in: [fromMovement.id, toMovement.id] } },
          data: { sourceId: conversion.id },
        });

        return tx.financialTransaction.findUniqueOrThrow({
          where: { id: created.id },
          include: transactionInclude,
        });
      }

      if (operationKind === OPERATION_KIND.MONEY_TRANSFER) {
        if (!data.personId) throw new Error('MONEY_TRANSFER_REQUIRES_PERSON');
        if (!data.moneyTransfer) throw new Error('MISSING_MONEY_TRANSFER_DATA');

        const currency = await activeCurrency(tx, data.moneyTransfer.currencyId);
        const amount = D(data.moneyTransfer.amount);
        const commission = D(data.moneyTransfer.commission);
        const totalAmount = amount.add(commission);
        const typeId = await typeIdFor(tx, 'حوالة مالية');
        const executionType =
          data.executionType ||
          `حوالة مالية إلى ${data.moneyTransfer.destination} بقيمة ${amountText(amount, currency)}${
            commission.gt(0) ? ` وعمولة ${amountText(commission, currency)}` : ''
          }`;
        const date = occurredAt(data.transactionAt);
        const cancelled = data.moneyTransfer.status === 'CANCELLED';

        const created = await tx.financialTransaction.create({
          data: {
            number,
            personId: data.personId,
            typeId,
            customType: 'حوالة مالية',
            description: data.description || executionType,
            executionType,
            operationKind,
            operationDetails: jsonDetails({
              receiverName: data.moneyTransfer.receiverName,
              destination: data.moneyTransfer.destination,
              amount: data.moneyTransfer.amount,
              commission: data.moneyTransfer.commission,
              totalAmount: totalAmount.toString(),
              currencyId: currency.id,
              currencyCode: currency.code,
              paymentMethod: data.moneyTransfer.paymentMethod,
              status: data.moneyTransfer.status,
              transferNumber: data.moneyTransfer.transferNumber || null,
            }),
            currencyId: currency.id,
            agreedAmount: totalAmount,
            receivedAmount: cancelled ? D(0) : totalAmount,
            paidAmount: D(0),
            receivableAmount: D(0),
            payableAmount: D(0),
            transactionAt: date,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            notes: data.notes || undefined,
            status: cancelled ? 'CANCELLED' : data.moneyTransfer.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
            createdBy: username,
          },
        });

        if (!cancelled && totalAmount.gt(0)) {
          await createCashboxMovement(tx, {
            currencyId: currency.id,
            transactionId: created.id,
            personId: data.personId,
            direction: 'IN',
            amount: totalAmount,
            paymentMethod: paymentMethodForCurrency(currency.code, data.moneyTransfer.paymentMethod),
            reason: `${executionType} (${simplePaymentLabels[data.moneyTransfer.paymentMethod]})`,
            sourceType: 'MoneyTransfer',
            sourceId: created.id,
            note: data.notes || null,
            occurredAt: date,
          });
        }

        return tx.financialTransaction.findUniqueOrThrow({
          where: { id: created.id },
          include: transactionInclude,
        });
      }

      if (operationKind === OPERATION_KIND.SHEIN_CARD_SALE) {
        if (!data.personId) throw new Error('SHEIN_SALE_REQUIRES_PERSON');
        if (!data.sheinSale) throw new Error('MISSING_SHEIN_SALE_DATA');

        const paymentMethod = normalizedPaymentMethod(data.sheinSale.paymentMethod);
        const currencyCode = detailedPaymentCurrencyCode[paymentMethod as keyof typeof detailedPaymentCurrencyCode];
        const currency = await tx.currency.findFirst({ where: { code: currencyCode, isActive: true } });
        if (!currency) throw new Error('SHEIN_SALE_CURRENCY_NOT_FOUND');

        const denomination = D(data.sheinSale.denomination);
        const pricePerCard = D(data.sheinSale.pricePerCard);
        const cardCount = data.sheinSale.cardCount;
        const totalAmount = pricePerCard.mul(cardCount);
        const paymentLabel = detailedPaymentLabels[paymentMethod as keyof typeof detailedPaymentLabels] || paymentMethod;
        const executionType =
          data.executionType ||
          `بيع ${cardCount} كروت شي إن فئة ${denomination.toString()}$ بسعر ${amountText(
            pricePerCard,
            currency,
          )} للكرت (${paymentLabel})`;
        const typeId = data.typeId || (await typeIdFor(tx, 'كروت شي إن'));
        const date = occurredAt(data.transactionAt);
        const executionStatus = data.executionStatus || EXECUTION_STATUS.COMPLETED;
        if (executionStatus === EXECUTION_STATUS.NOT_EXECUTED) {
          throw new Error('INVALID_INITIAL_SHEIN_EXECUTION_STATUS');
        }
        const completeNow = executionStatus === EXECUTION_STATUS.COMPLETED;

        const availableCards = completeNow
          ? await tx.sheinCard.findMany({
              where: { denomination, status: 'AVAILABLE' },
              orderBy: { createdAt: 'asc' },
              take: cardCount,
            })
          : [];
        if (completeNow && availableCards.length < cardCount) {
          throw new Error('NOT_ENOUGH_AVAILABLE_SHEIN_CARDS');
        }

        const created = await tx.financialTransaction.create({
          data: {
            number,
            personId: data.personId,
            typeId,
            customType: 'كروت شي إن',
            description: data.description || executionType,
            executionType,
            operationKind: OPERATION_KIND.SHEIN_CARD_SALE,
            operationDetails: jsonDetails({
              denomination: data.sheinSale.denomination,
              paymentMethod,
              cardCount,
              pricePerCard: data.sheinSale.pricePerCard,
              totalAmount: totalAmount.toString(),
              linkedInventoryCards: availableCards.length,
              executedCards: completeNow ? cardCount : 0,
              executionStatus,
            }),
            currencyId: currency.id,
            agreedAmount: totalAmount,
            receivedAmount: totalAmount,
            paidAmount: D(0),
            receivableAmount: D(0),
            payableAmount: D(0),
            transactionAt: date,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            notes: data.notes || data.sheinSale.notes || undefined,
            sheinPaymentMethod: paymentMethod as any,
            status: 'COMPLETED',
            executionStatus: executionStatus as any,
            executionNote: data.executionNote || null,
            createdBy: username,
          },
        });

        const movement = await createCashboxMovement(tx, {
          currencyId: currency.id,
          transactionId: created.id,
          personId: data.personId,
          direction: 'IN',
          amount: totalAmount,
          paymentMethod,
          reason: executionType,
          sourceType: 'SheinCardSale',
          note: data.notes || data.sheinSale.notes || null,
          occurredAt: date,
        });

        const sale = await tx.sheinCardSale.create({
          data: {
            transactionId: created.id,
            personId: data.personId,
            currencyId: currency.id,
            paymentMethod: paymentMethod as any,
            denomination,
            cardCount,
            pricePerCard,
            totalAmount,
            occurredAt: date,
            notes: data.notes || data.sheinSale.notes || null,
            items: completeNow
              ? {
                  create: availableCards.map((card) => ({ cardId: card.id })),
                }
              : undefined,
          },
        });

        await tx.cashboxMovement.update({
          where: { id: movement.id },
          data: { sourceId: sale.id },
        });

        for (let index = 0; index < cardCount; index += 1) {
          const card = availableCards[index];
          const item = await tx.transactionExecutionItem.create({
            data: {
              transactionId: created.id,
              customerId: data.personId,
              itemNumber: executionItemNumber(index + 1),
              status: completeNow ? EXECUTION_STATUS.COMPLETED : EXECUTION_STATUS.PENDING,
              sheinCardId: card?.id || null,
              executedAt: completeNow ? date : null,
              executedByUserId: completeNow ? userId : null,
              note: completeNow ? executionType : null,
            },
          });

          if (card) {
            await tx.sheinCard.update({
              where: { id: card.id },
              data: {
                status: 'USED',
                salePrice: pricePerCard,
                saleCurrencyId: currency.id,
                salePaymentMethod: paymentMethod as any,
                saleCashboxMovementId: movement.id,
                buyerPersonId: data.personId,
                linkedTransactionId: created.id,
                linkedExecutionItemId: item.id,
                usedAt: date,
                usedByUserId: userId,
                soldAt: date,
                logs: {
                  create: {
                    type: 'SALE',
                    amount: pricePerCard,
                    note: executionType,
                    createdBy: username,
                  },
                },
              },
            });
          }
        }

        return tx.financialTransaction.findUniqueOrThrow({
          where: { id: created.id },
          include: transactionInclude,
        });
      }

      if (operationKind === OPERATION_KIND.EXPENSE) {
        if (!data.expense) throw new Error('MISSING_EXPENSE_DATA');

        const currency = await activeCurrency(tx, data.expense.currencyId);
        const amount = D(data.expense.amount);
        const typeId = await typeIdFor(tx, 'مصروف / دفع فاتورة');
        const actionLabel = data.expense.action === 'PAY_BILL' ? 'دفع فاتورة' : 'مصروف عام';
        const executionType =
          data.executionType ||
          `${actionLabel} ${data.expense.expenseType} بقيمة ${amountText(amount, currency)} عبر ${
            simplePaymentLabels[data.expense.paymentMethod]
          }`;
        const date = occurredAt(data.transactionAt);

        const created = await tx.financialTransaction.create({
          data: {
            number,
            personId: data.personId || null,
            typeId,
            customType: 'مصروف / دفع فاتورة',
            description: data.description || executionType,
            executionType,
            operationKind,
            operationDetails: jsonDetails({
              action: data.expense.action,
              payee: data.expense.payee,
              expenseType: data.expense.expenseType,
              amount: data.expense.amount,
              currencyId: currency.id,
              currencyCode: currency.code,
              paymentMethod: data.expense.paymentMethod,
              invoiceNumber: data.expense.invoiceNumber || null,
            }),
            currencyId: currency.id,
            agreedAmount: amount,
            receivedAmount: D(0),
            paidAmount: amount,
            receivableAmount: D(0),
            payableAmount: D(0),
            transactionAt: date,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            notes: data.notes || undefined,
            status: 'COMPLETED',
            createdBy: username,
          },
        });

        await createCashboxMovement(tx, {
          currencyId: currency.id,
          transactionId: created.id,
          personId: data.personId || null,
          direction: 'OUT',
          amount,
          paymentMethod: paymentMethodForCurrency(currency.code, data.expense.paymentMethod),
          reason: `${executionType} - ${data.expense.payee}`,
          sourceType: 'Expense',
          sourceId: created.id,
          note: data.notes || null,
          occurredAt: date,
        });

        return tx.financialTransaction.findUniqueOrThrow({
          where: { id: created.id },
          include: transactionInclude,
        });
      }

      if (!data.currencyId || data.agreedAmount === undefined) throw new Error('MISSING_STANDARD_TRANSACTION_DATA');

      const standardCurrency = await activeCurrency(tx, data.currencyId);
      const agreedAmount = D(data.agreedAmount);
      const receivedAmount = D(data.receivedAmount);
      const paidAmount = D(data.paidAmount);
      const {
        transactionKind: _transactionKind,
        operationKind: _operationKind,
        manual: _manual,
        usdt: _usdt,
        cardOperation: _cardOperation,
        cashboxMovement: _cashboxMovement,
        conversion: _conversion,
        moneyTransfer: _moneyTransfer,
        sheinSale: _sheinSale,
        expense: _expense,
        ...standardData
      } = data;

      const created = await tx.financialTransaction.create({
        data: {
          ...standardData,
          personId: data.personId || null,
          typeId: data.typeId || null,
          currencyId: standardCurrency.id,
          number,
          agreedAmount,
          receivedAmount,
          paidAmount,
          receivableAmount: D(0),
          payableAmount: D(0),
          transactionAt: data.transactionAt ? new Date(data.transactionAt) : new Date(),
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          executionType: data.executionType || data.description || null,
          status: statusOf(agreedAmount, receivedAmount, paidAmount, D(0), D(0)) as any,
          createdBy: username,
        },
      });

      const movements = [
        { direction: 'IN' as const, amount: receivedAmount, reason: 'المبلغ المستلم عند إنشاء المعاملة' },
        { direction: 'OUT' as const, amount: paidAmount, reason: 'المبلغ المدفوع عند إنشاء المعاملة' },
      ];

      for (const movement of movements) {
        if (movement.amount.lte(0)) continue;

        await createCashboxMovement(tx, {
          currencyId: standardCurrency.id,
          transactionId: created.id,
          personId: data.personId || null,
          direction: movement.direction,
          amount: movement.amount,
          paymentMethod: paymentMethodForCurrency(standardCurrency.code, 'CASH'),
          reason: movement.reason,
          sourceType: 'FinancialTransaction',
          sourceId: created.id,
        });
      }

      return tx.financialTransaction.findUniqueOrThrow({
        where: { id: created.id },
        include: transactionInclude,
      });
    });

    const auditValue =
      operationKind === OPERATION_KIND.USDT
        ? { number, ...data, savedDetails: jsonDetails(transaction.operationDetails) }
        : { number, ...data };

    await audit('TRANSACTION_CREATE', {
      entityType: 'FinancialTransaction',
      entityId: transaction.id,
      newValue: auditValue,
      description: 'إضافة معاملة',
    });
    if (operationKind === OPERATION_KIND.SHEIN_CARD_SALE && data.executionStatus === EXECUTION_STATUS.PENDING) {
      await audit('TRANSACTION_EXECUTION_PENDING_CREATE', {
        entityType: 'FinancialTransaction',
        entityId: transaction.id,
        newValue: {
          transactionId: transaction.id,
          executionStatus: data.executionStatus,
          executionItems: (transaction as any).executionItems,
        },
        description: 'إنشاء معاملة كروت شي إن في انتظار التنفيذ',
      });
    }

    const transactionDetails = transaction.operationDetails as any;
    if (
      operationKind === OPERATION_KIND.CARD_OPERATION &&
      data.cardOperation?.action === 'RECEIVE_CARD' &&
      transactionDetails?.receivedCardBatchId
    ) {
      await audit('RECEIVED_CARD_BATCH_CREATE', {
        entityType: 'ReceivedCardBatch',
        entityId: transactionDetails.receivedCardBatchId,
        newValue: transactionDetails,
        description: 'استلام دفعة بطاقات من إضافة معاملة بدون أثر على الصندوق',
      });
    }

    revalidateFinancePaths(data.personId ? [`/people/${data.personId}`] : []);

    return ok(transaction, 201);
  } catch (error) {
    if ((error as Error).message === 'MISSING_MANUAL_DATA') return fail('أدخل بيانات العملية اليدوية');
    if ((error as Error).message === 'INVALID_CURRENCY') return fail('اختر عملة نشطة وصحيحة');
    if ((error as Error).message === 'USDT_REQUIRES_PERSON') return fail('اختر الزبون قبل عملية USDT');
    if ((error as Error).message === 'MISSING_USDT_DATA') return fail('أدخل بيانات USDT');
    if ((error as Error).message === 'USDT_CURRENCY_NOT_FOUND') return fail('عملة USDT غير مفعلة في الإعدادات');
    if ((error as Error).message === 'INVALID_USDT_PAYMENT_CURRENCY') return fail('اختر عملة دفع صحيحة لعملية USDT');
    if ((error as Error).message === 'USDT_EXCHANGE_RATE_REQUIRED') return fail('أدخل سعر الصرف عند الدفع بالدينار');
    if ((error as Error).message === 'CARD_OPERATION_REQUIRES_PERSON') return fail('اختر الزبون قبل عملية البطاقة');
    if ((error as Error).message === 'MISSING_CARD_OPERATION_DATA') return fail('أدخل بيانات عملية البطاقة');
    if ((error as Error).message === 'MISSING_CASHBOX_MOVEMENT_DATA') return fail('أدخل بيانات حركة الصندوق');
    if ((error as Error).message === 'MISSING_CONVERSION_DATA') return fail('أدخل بيانات تحويل المبلغ');
    if ((error as Error).message === 'SAME_CONVERSION_CURRENCY') return fail('اختر عملتين مختلفتين للتحويل');
    if ((error as Error).message === 'INVALID_CONVERSION_CURRENCY') return fail('اختر عملات نشطة وصحيحة للتحويل');
    if ((error as Error).message === 'MONEY_TRANSFER_REQUIRES_PERSON') return fail('اختر الزبون / المرسل');
    if ((error as Error).message === 'MISSING_MONEY_TRANSFER_DATA') return fail('أدخل بيانات الحوالة المالية');
    if ((error as Error).message === 'SHEIN_SALE_REQUIRES_PERSON') return fail('اختر الزبون قبل بيع كروت شي إن');
    if ((error as Error).message === 'MISSING_SHEIN_SALE_DATA') return fail('أدخل بيانات بيع كروت شي إن');
    if ((error as Error).message === 'SHEIN_SALE_CURRENCY_NOT_FOUND') return fail('عملة الدفع المطلوبة غير مفعلة');
    if ((error as Error).message === 'INVALID_INITIAL_SHEIN_EXECUTION_STATUS') {
      return fail('اختر تم التنفيذ أو في انتظار اكتمال التنفيذ عند إضافة طلب كروت شي إن');
    }
    if ((error as Error).message === 'NOT_ENOUGH_AVAILABLE_SHEIN_CARDS') {
      return fail('لا توجد كروت شي إن متاحة كافية لهذه الفئة في المخزن');
    }
    if ((error as Error).message === 'MISSING_EXPENSE_DATA') return fail('أدخل بيانات المصروف أو الفاتورة');
    if ((error as Error).message === 'MISSING_STANDARD_TRANSACTION_DATA') {
      return fail('اختر العملة وأدخل المبلغ المتفق عليه');
    }
    return apiError(error);
  }
}
