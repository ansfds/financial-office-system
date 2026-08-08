import { Prisma } from '@prisma/client';
import { audit, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { normalizeWalletPaymentMethod, recalculateSettlementBalances, transactionWalletEffect } from '@/lib/customer-wallet';
import { z } from 'zod';

const updateSettlementSchema = z.object({
  direction: z.enum(['ADD', 'SUBTRACT']).optional(),
  accountType: z.enum(['CREDIT', 'DEBT']).optional(),
  currencyId: z.string().min(1).optional(),
  paymentMethod: z.string().trim().min(1).optional(),
  amount: z.coerce.number().positive().optional(),
  reason: z.string().trim().min(2).optional(),
  note: z.string().trim().optional().nullable(),
  movementKind: z.enum(['ADJUSTMENT', 'REPAYMENT']).optional(),
  settlementMethod: z.string().trim().optional().nullable(),
});

const deleteSettlementSchema = z.object({
  reason: z.string().trim().optional().nullable(),
});

function sameWalletGroup(
  left: { currencyId: string; paymentMethod: string; accountType: 'CREDIT' | 'DEBT' },
  right: { currencyId: string; paymentMethod: string; accountType: 'CREDIT' | 'DEBT' },
) {
  return (
    left.currencyId === right.currencyId &&
    left.paymentMethod === right.paymentMethod &&
    left.accountType === right.accountType
  );
}

async function recalculateWalletGroup(
  tx: Prisma.TransactionClient,
  personId: string,
  group: { currencyId: string; paymentMethod: string; accountType: 'CREDIT' | 'DEBT' },
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

  for (const settlement of recalculateSettlementBalances(balance, settlements)) {
    await tx.customerWalletSettlement.update({
      where: { id: settlement.id },
      data: {
        balanceBefore: settlement.balanceBefore,
        balanceAfter: settlement.balanceAfter,
      },
    });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; settlementId: string }> }) {
  try {
    const session = await requireSession();
    const { id, settlementId } = await params;
    const parsed = updateSettlementSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات الحركة المالية');

    const input = parsed.data;
    let oldSnapshot: any = null;
    let newSnapshot: any = null;

    await db.$transaction(async (tx) => {
      const oldValue = await tx.customerWalletSettlement.findFirst({
        where: { id: settlementId, personId: id, deletedAt: null },
        include: { currency: true, person: true },
      });
      if (!oldValue) throw new Error('SETTLEMENT_NOT_FOUND');
      oldSnapshot = oldValue;

      const currencyId = input.currencyId || oldValue.currencyId;
      const currency = await tx.currency.findFirst({ where: { id: currencyId, isActive: true } });
      if (!currency) throw new Error('INVALID_CURRENCY');

      const nextGroup = {
        currencyId,
        paymentMethod: normalizeWalletPaymentMethod(input.paymentMethod || oldValue.paymentMethod, currency.code),
        accountType: input.accountType || oldValue.accountType,
      };
      const oldGroup = {
        currencyId: oldValue.currencyId,
        paymentMethod: oldValue.paymentMethod,
        accountType: oldValue.accountType,
      };

      await tx.customerWalletSettlement.update({
        where: { id: settlementId },
        data: {
          direction: input.direction || oldValue.direction,
          accountType: nextGroup.accountType,
          currencyId: nextGroup.currencyId,
          paymentMethod: nextGroup.paymentMethod,
          amount: input.amount === undefined ? oldValue.amount : D(input.amount),
          reason: input.reason || oldValue.reason,
          note: input.note === undefined ? oldValue.note : input.note || null,
          movementKind: input.movementKind || oldValue.movementKind,
          settlementMethod: input.settlementMethod === undefined ? oldValue.settlementMethod : input.settlementMethod || null,
        },
        include: { currency: true, person: true },
      });

      await recalculateWalletGroup(tx, id, oldGroup);
      if (!sameWalletGroup(oldGroup, nextGroup)) await recalculateWalletGroup(tx, id, nextGroup);

      newSnapshot = await tx.customerWalletSettlement.findUniqueOrThrow({
        where: { id: settlementId },
        include: { currency: true, person: true },
      });

      if (newSnapshot.movementKind === 'REPAYMENT') {
        if (newSnapshot.direction !== 'SUBTRACT') throw new Error('REPAYMENT_MUST_SUBTRACT');
        await tx.customerAccountRepayment.upsert({
          where: { settlementId },
          create: {
            settlementId,
            personId: id,
            currencyId: newSnapshot.currencyId,
            paymentMethod: newSnapshot.paymentMethod,
            accountType: newSnapshot.accountType,
            amount: newSnapshot.amount,
            balanceBefore: newSnapshot.balanceBefore,
            balanceAfter: newSnapshot.balanceAfter,
            reason: newSnapshot.reason,
            note: newSnapshot.note,
            userId: session.userId,
            username: session.username,
            occurredAt: newSnapshot.occurredAt,
          },
          update: {
            currencyId: newSnapshot.currencyId,
            paymentMethod: newSnapshot.paymentMethod,
            accountType: newSnapshot.accountType,
            amount: newSnapshot.amount,
            balanceBefore: newSnapshot.balanceBefore,
            balanceAfter: newSnapshot.balanceAfter,
            reason: newSnapshot.reason,
            note: newSnapshot.note,
            deletedAt: null,
            deletedBy: null,
            deleteReason: null,
          },
        });
      } else {
        await tx.customerAccountRepayment.updateMany({
          where: { settlementId, deletedAt: null },
          data: {
            deletedAt: new Date(),
            deletedBy: session.username,
            deleteReason: 'تحويل حركة السداد إلى حركة عادية',
          },
        });
      }
    });

    await audit('CUSTOMER_WALLET_SETTLEMENT_UPDATE', {
      entityType: 'CustomerWalletSettlement',
      entityId: settlementId,
      oldValue: oldSnapshot,
      newValue: newSnapshot,
      description: 'تعديل حركة مالية وإعادة حساب الرصيد',
    });
    revalidateFinancePaths([`/people/${id}`, '/accounts']);
    return ok(newSnapshot);
  } catch (error) {
    if ((error as Error).message === 'SETTLEMENT_NOT_FOUND') return fail('الحركة المالية غير موجودة', 404);
    if ((error as Error).message === 'INVALID_CURRENCY') return fail('اختر عملة صحيحة');
    if ((error as Error).message === 'NEGATIVE_WALLET_BALANCE') {
      return fail('لا يمكن أن يصبح الرصيد بالسالب بعد تعديل الحركة', 400);
    }
    if ((error as Error).message === 'REPAYMENT_MUST_SUBTRACT') {
      return fail('حركة السداد يجب أن تكون خصمًا من الرصيد الحالي');
    }
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; settlementId: string }> }) {
  try {
    const session = await requireSession();
    const { id, settlementId } = await params;
    const parsed = deleteSettlementSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail('تحقق من سبب الحذف');

    let oldSnapshot: any = null;
    let deletedSnapshot: any = null;

    await db.$transaction(async (tx) => {
      const oldValue = await tx.customerWalletSettlement.findFirst({
        where: { id: settlementId, personId: id, deletedAt: null },
        include: { currency: true, person: true },
      });
      if (!oldValue) throw new Error('SETTLEMENT_NOT_FOUND');
      oldSnapshot = oldValue;

      deletedSnapshot = await tx.customerWalletSettlement.update({
        where: { id: settlementId },
        data: {
          deletedAt: new Date(),
          deletedBy: session.username,
          deleteReason: parsed.data.reason || 'حذف منطقي من واجهة لنا وعلينا',
        },
        include: { currency: true, person: true },
      });

      await recalculateWalletGroup(tx, id, {
        currencyId: oldValue.currencyId,
        paymentMethod: oldValue.paymentMethod,
        accountType: oldValue.accountType,
      });

      await tx.customerAccountRepayment.updateMany({
        where: { settlementId, deletedAt: null },
        data: {
          deletedAt: new Date(),
          deletedBy: session.username,
          deleteReason: parsed.data.reason || 'حذف منطقي لحركة السداد المرتبطة',
        },
      });
    });

    await audit('CUSTOMER_WALLET_SETTLEMENT_ARCHIVE', {
      entityType: 'CustomerWalletSettlement',
      entityId: settlementId,
      oldValue: oldSnapshot,
      newValue: deletedSnapshot,
      description: 'حذف منطقي لحركة مالية وإعادة حساب الرصيد',
    });
    revalidateFinancePaths([`/people/${id}`, '/accounts']);
    return ok({ success: true });
  } catch (error) {
    if ((error as Error).message === 'SETTLEMENT_NOT_FOUND') return fail('الحركة المالية غير موجودة', 404);
    if ((error as Error).message === 'NEGATIVE_WALLET_BALANCE') {
      return fail('لا يمكن حذف الحركة لأن الرصيد التالي سيصبح بالسالب', 400);
    }
    return apiError(error);
  }
}
