import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { D, statusOf } from '@/lib/money';
import { createCashboxMovement } from '@/lib/cashbox';
import { z } from 'zod';

const TRANSACTION_KIND = {
  STANDARD: 'STANDARD',
  CURRENCY_CONVERSION: 'CURRENCY_CONVERSION',
  SHEIN_CARD_SALE: 'SHEIN_CARD_SALE',
} as const;

const paymentMethodLabels: Record<string, string> = {
  LYD_CASH: 'كاش دينار',
  USD_CASH: 'كاش دولار',
  LYD_TRANSFER: 'حوالة دينار',
  USD_TRANSFER: 'حوالة دولار',
  CARD: 'بطاقة مصرفية',
};

const paymentMethodCurrencyCode: Record<string, string> = {
  LYD_CASH: 'LYD',
  USD_CASH: 'USD',
  LYD_TRANSFER: 'LYD',
  USD_TRANSFER: 'USD',
  CARD: 'LYD',
};

const transactionSchema = z.object({
  transactionKind: z
    .enum([TRANSACTION_KIND.STANDARD, TRANSACTION_KIND.CURRENCY_CONVERSION, TRANSACTION_KIND.SHEIN_CARD_SALE])
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
  conversion: z
    .object({
      fromCurrencyId: z.string().min(1),
      toCurrencyId: z.string().min(1),
      fromAmount: z.coerce.number().positive(),
      toAmount: z.coerce.number().positive(),
      notes: z.string().trim().optional(),
    })
    .optional(),
  sheinSale: z
    .object({
      denomination: z.coerce.number().positive(),
      paymentMethod: z.enum(['LYD_CASH', 'USD_CASH', 'LYD_TRANSFER', 'USD_TRANSFER', 'CARD']),
      pricePerCard: z.coerce.number().positive(),
      cardCount: z.coerce.number().int().positive(),
      notes: z.string().trim().optional(),
    })
    .optional(),
});

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
  return `${D(amount).toString()} ${currency?.symbol || currency?.name || ''}`.trim();
}

export async function GET(request: Request) {
  try {
    await requireSession();

    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() || '';
    const status = url.searchParams.get('status') || undefined;

    const transactions = await db.financialTransaction.findMany({
      where: {
        deletedAt: null,
        status: status as any,
        OR: q
          ? [
              { number: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { executionType: { contains: q, mode: 'insensitive' } },
              { customType: { contains: q, mode: 'insensitive' } },
              { notes: { contains: q, mode: 'insensitive' } },
              { txId: { contains: q, mode: 'insensitive' } },
              { cardNumber: { contains: q, mode: 'insensitive' } },
              { bankName: { contains: q, mode: 'insensitive' } },
              { person: { fullName: { contains: q, mode: 'insensitive' } } },
              { person: { customerNo: { contains: q, mode: 'insensitive' } } },
            ]
          : undefined,
      },
      include: { person: true, currency: true, type: true },
      orderBy: { transactionAt: 'desc' },
      take: 300,
    });

    return ok(transactions);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();

    const parsed = transactionSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات المعاملة');

    const data = parsed.data;
    const number = transactionNumber();

    const transaction = await db.$transaction(async (tx) => {
      if (data.transactionKind === TRANSACTION_KIND.CURRENCY_CONVERSION) {
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
        const executionType =
          data.executionType ||
          `تحويل مبلغ من ${amountText(fromAmount, fromCurrency)} إلى ${amountText(toAmount, toCurrency)}`;
        const typeId = data.typeId || (await typeIdFor(tx, 'تحويل مبلغ'));
        const occurredAt = data.transactionAt ? new Date(data.transactionAt) : new Date();

        const created = await tx.financialTransaction.create({
          data: {
            number,
            personId: data.personId || null,
            typeId,
            customType: data.customType || 'تحويل مبلغ',
            description: data.description || executionType,
            executionType,
            currencyId: data.conversion.fromCurrencyId,
            agreedAmount: fromAmount,
            receivedAmount: D(0),
            paidAmount: fromAmount,
            receivableAmount: D(0),
            payableAmount: D(0),
            exchangeRate: toAmount.div(fromAmount),
            transactionAt: occurredAt,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            notes: data.notes || data.conversion.notes || undefined,
            status: 'COMPLETED',
          },
        });

        const fromMovement = await createCashboxMovement(tx, {
          currencyId: data.conversion.fromCurrencyId,
          transactionId: created.id,
          personId: data.personId || null,
          direction: 'OUT',
          amount: fromAmount,
          reason: executionType,
          sourceType: 'CurrencyConversion',
          note: data.notes || data.conversion.notes || null,
          occurredAt,
        });

        const toMovement = await createCashboxMovement(tx, {
          currencyId: data.conversion.toCurrencyId,
          transactionId: created.id,
          personId: data.personId || null,
          direction: 'IN',
          amount: toAmount,
          reason: executionType,
          sourceType: 'CurrencyConversion',
          note: data.notes || data.conversion.notes || null,
          occurredAt,
        });

        const conversion = await tx.currencyConversion.create({
          data: {
            fromCurrencyId: data.conversion.fromCurrencyId,
            toCurrencyId: data.conversion.toCurrencyId,
            fromAmount,
            toAmount,
            exchangeRate: toAmount.div(fromAmount),
            operatorName: 'system',
            notes: data.notes || data.conversion.notes || null,
            occurredAt,
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
          include: { person: true, currency: true, type: true },
        });
      }

      if (data.transactionKind === TRANSACTION_KIND.SHEIN_CARD_SALE) {
        if (!data.personId) throw new Error('SHEIN_SALE_REQUIRES_PERSON');
        if (!data.sheinSale) throw new Error('MISSING_SHEIN_SALE_DATA');

        const currencyCode = paymentMethodCurrencyCode[data.sheinSale.paymentMethod];
        const currency = await tx.currency.findFirst({ where: { code: currencyCode, isActive: true } });
        if (!currency) throw new Error('SHEIN_SALE_CURRENCY_NOT_FOUND');

        const denomination = D(data.sheinSale.denomination);
        const pricePerCard = D(data.sheinSale.pricePerCard);
        const cardCount = data.sheinSale.cardCount;
        const totalAmount = pricePerCard.mul(cardCount);
        const paymentLabel = paymentMethodLabels[data.sheinSale.paymentMethod];
        const executionType =
          data.executionType ||
          `بيع ${cardCount} كروت شي إن فئة ${denomination.toString()}$ بسعر ${amountText(
            pricePerCard,
            currency,
          )} للكرت (${paymentLabel})`;
        const typeId = data.typeId || (await typeIdFor(tx, 'كروت شي إن'));
        const occurredAt = data.transactionAt ? new Date(data.transactionAt) : new Date();

        const availableCards = await tx.sheinCard.findMany({
          where: { denomination, status: 'AVAILABLE' },
          orderBy: { createdAt: 'asc' },
          take: cardCount,
        });
        if (availableCards.length > 0 && availableCards.length < cardCount) {
          throw new Error('NOT_ENOUGH_AVAILABLE_SHEIN_CARDS');
        }

        const created = await tx.financialTransaction.create({
          data: {
            number,
            personId: data.personId,
            typeId,
            customType: data.customType || 'كروت شي إن',
            description: data.description || executionType,
            executionType,
            currencyId: currency.id,
            agreedAmount: totalAmount,
            receivedAmount: totalAmount,
            paidAmount: D(0),
            receivableAmount: D(0),
            payableAmount: D(0),
            transactionAt: occurredAt,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            notes: data.notes || data.sheinSale.notes || undefined,
            sheinPaymentMethod: data.sheinSale.paymentMethod,
            status: 'COMPLETED',
          },
        });

        const movement = await createCashboxMovement(tx, {
          currencyId: currency.id,
          transactionId: created.id,
          personId: data.personId,
          direction: 'IN',
          amount: totalAmount,
          reason: executionType,
          sourceType: 'SheinCardSale',
          note: data.notes || data.sheinSale.notes || null,
          occurredAt,
        });

        const sale = await tx.sheinCardSale.create({
          data: {
            transactionId: created.id,
            personId: data.personId,
            currencyId: currency.id,
            paymentMethod: data.sheinSale.paymentMethod,
            denomination,
            cardCount,
            pricePerCard,
            totalAmount,
            occurredAt,
            notes: data.notes || data.sheinSale.notes || null,
            items: availableCards.length
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

        for (const card of availableCards) {
          await tx.sheinCard.update({
            where: { id: card.id },
            data: {
              status: 'SOLD',
              salePrice: pricePerCard,
              saleCurrencyId: currency.id,
              salePaymentMethod: data.sheinSale.paymentMethod,
              saleCashboxMovementId: movement.id,
              buyerPersonId: data.personId,
              soldAt: occurredAt,
              logs: {
                create: {
                  type: 'SALE',
                  amount: pricePerCard,
                  note: executionType,
                },
              },
            },
          });
        }

        return tx.financialTransaction.findUniqueOrThrow({
          where: { id: created.id },
          include: { person: true, currency: true, type: true },
        });
      }

      if (!data.currencyId || data.agreedAmount === undefined) throw new Error('MISSING_STANDARD_TRANSACTION_DATA');

      const agreedAmount = D(data.agreedAmount);
      const receivedAmount = D(data.receivedAmount);
      const paidAmount = D(data.paidAmount);
      const {
        transactionKind: _transactionKind,
        conversion: _conversion,
        sheinSale: _sheinSale,
        ...standardData
      } = data;

      const created = await tx.financialTransaction.create({
        data: {
          ...standardData,
          personId: data.personId || null,
          typeId: data.typeId || null,
          currencyId: data.currencyId,
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
        },
      });

      const movements = [
        { direction: 'IN' as const, amount: receivedAmount, reason: 'المبلغ المستلم عند إنشاء المعاملة' },
        { direction: 'OUT' as const, amount: paidAmount, reason: 'المبلغ المدفوع عند إنشاء المعاملة' },
      ];

      for (const movement of movements) {
        if (movement.amount.lte(0)) continue;

        await createCashboxMovement(tx, {
          currencyId: data.currencyId,
          transactionId: created.id,
          personId: data.personId || null,
          direction: movement.direction,
          amount: movement.amount,
          reason: movement.reason,
          sourceType: 'FinancialTransaction',
          sourceId: created.id,
        });
      }

      return created;
    });

    await audit('TRANSACTION_CREATE', {
      entityType: 'FinancialTransaction',
      entityId: transaction.id,
      newValue: { number, ...data },
      description: 'إضافة معاملة',
    });

    return ok(transaction, 201);
  } catch (error) {
    if ((error as Error).message === 'MISSING_CONVERSION_DATA') return fail('أدخل بيانات تحويل المبلغ');
    if ((error as Error).message === 'SAME_CONVERSION_CURRENCY') return fail('اختر عملتين مختلفتين للتحويل');
    if ((error as Error).message === 'INVALID_CONVERSION_CURRENCY') return fail('اختر عملات نشطة وصحيحة للتحويل');
    if ((error as Error).message === 'SHEIN_SALE_REQUIRES_PERSON') return fail('اختر الزبون قبل بيع كروت شي إن');
    if ((error as Error).message === 'MISSING_SHEIN_SALE_DATA') return fail('أدخل بيانات بيع كروت شي إن');
    if ((error as Error).message === 'SHEIN_SALE_CURRENCY_NOT_FOUND') return fail('عملة الدفع المطلوبة غير مفعلة');
    if ((error as Error).message === 'NOT_ENOUGH_AVAILABLE_SHEIN_CARDS') {
      return fail('لا توجد كروت شي إن متاحة كافية لهذه الفئة في المخزن');
    }
    if ((error as Error).message === 'MISSING_STANDARD_TRANSACTION_DATA') {
      return fail('اختر العملة وأدخل المبلغ المتفق عليه');
    }
    return apiError(error);
  }
}
