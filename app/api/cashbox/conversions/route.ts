import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { createCashboxMovement } from '@/lib/cashbox';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { z } from 'zod';

const conversionSchema = z.object({
  fromCurrencyId: z.string().min(1),
  toCurrencyId: z.string().min(1),
  fromAmount: z.coerce.number().positive(),
  toAmount: z.coerce.number().positive(),
  operatorName: z.string().trim().min(2),
  notes: z.string().trim().optional().nullable(),
  occurredAt: z.string().optional().nullable(),
});

export async function GET() {
  try {
    await requireSession();

    const conversions = await db.currencyConversion.findMany({
      include: { fromCurrency: true, toCurrency: true },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });

    return ok(conversions);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();

    const parsed = conversionSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات تحويل العملة');

    const input = parsed.data;
    if (input.fromCurrencyId === input.toCurrencyId) return fail('اختر عملتين مختلفتين');

    const conversion = await db.$transaction(async (tx) => {
      const currencies = await tx.currency.findMany({
        where: {
          id: { in: [input.fromCurrencyId, input.toCurrencyId] },
          isActive: true,
        },
      });
      if (currencies.length !== 2) throw new Error('INVALID_CONVERSION_CURRENCIES');

      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      const fromAmount = D(input.fromAmount);
      const toAmount = D(input.toAmount);
      const exchangeRate = toAmount.div(fromAmount);
      const fromCurrency = currencies.find((currency) => currency.id === input.fromCurrencyId);
      const toCurrency = currencies.find((currency) => currency.id === input.toCurrencyId);
      const reason = `تحويل عملة من ${fromCurrency?.name || 'عملة'} إلى ${toCurrency?.name || 'عملة'}`;

      const fromMovement = await createCashboxMovement(tx, {
        currencyId: input.fromCurrencyId,
        direction: 'OUT',
        amount: fromAmount,
        reason,
        note: input.notes || null,
        createdBy: input.operatorName,
        occurredAt,
        sourceType: 'CurrencyConversion',
      });

      const toMovement = await createCashboxMovement(tx, {
        currencyId: input.toCurrencyId,
        direction: 'IN',
        amount: toAmount,
        reason,
        note: input.notes || null,
        createdBy: input.operatorName,
        occurredAt,
        sourceType: 'CurrencyConversion',
      });

      const created = await tx.currencyConversion.create({
        data: {
          fromCurrencyId: input.fromCurrencyId,
          toCurrencyId: input.toCurrencyId,
          fromAmount,
          toAmount,
          exchangeRate,
          operatorName: input.operatorName,
          notes: input.notes || null,
          occurredAt,
          fromMovementId: fromMovement.id,
          toMovementId: toMovement.id,
        },
        include: { fromCurrency: true, toCurrency: true },
      });

      await tx.cashboxMovement.updateMany({
        where: { id: { in: [fromMovement.id, toMovement.id] } },
        data: { sourceId: created.id },
      });

      return created;
    });

    await audit('CURRENCY_CONVERSION_CREATE', {
      entityType: 'CurrencyConversion',
      entityId: conversion.id,
      newValue: conversion as any,
      description: 'تحويل عملة',
    });

    return ok(conversion, 201);
  } catch (error) {
    if ((error as Error).message === 'INVALID_CONVERSION_CURRENCIES') {
      return fail('اختر عملتين نشطتين للتحويل');
    }
    return apiError(error);
  }
}
