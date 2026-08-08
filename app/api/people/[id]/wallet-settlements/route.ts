import { clientMeta, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import {
  normalizeWalletPaymentMethod,
  walletAccountAmount,
  walletAccountLabels,
  walletSettlementDirectionLabels,
} from '@/lib/customer-wallet';
import { z } from 'zod';

const settlementSchema = z.object({
  direction: z.enum(['ADD', 'SUBTRACT']),
  accountType: z.enum(['CREDIT', 'DEBT']),
  currencyId: z.string().min(1),
  paymentMethod: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(2),
  note: z.string().trim().optional().nullable(),
  movementKind: z.enum(['ADJUSTMENT', 'REPAYMENT']).default('ADJUSTMENT'),
  settlementMethod: z.string().trim().optional().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const meta = await clientMeta();
    const { id } = await params;
    const parsed = settlementSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات التسوية');

    const input = parsed.data;

    const settlement = await db.$transaction(async (tx) => {
      const [person, currency] = await Promise.all([
        tx.person.findFirst({ where: { id, deletedAt: null, status: 'ACTIVE' } }),
        tx.currency.findFirst({ where: { id: input.currencyId, isActive: true } }),
      ]);

      if (!person) throw new Error('PERSON_NOT_FOUND');
      if (!currency) throw new Error('INVALID_CURRENCY');

      const paymentMethod = normalizeWalletPaymentMethod(input.paymentMethod, currency.code);
      if (input.movementKind === 'REPAYMENT' && input.direction !== 'SUBTRACT') {
        throw new Error('REPAYMENT_MUST_SUBTRACT');
      }
      const [transactions, settlements] = await Promise.all([
        tx.financialTransaction.findMany({
          where: { personId: id, deletedAt: null },
          include: { currency: true },
        }),
        tx.customerWalletSettlement.findMany({
          where: { personId: id, deletedAt: null },
          include: { currency: true },
        }),
      ]);

      const balanceBefore = walletAccountAmount(
        transactions,
        settlements,
        currency.id,
        paymentMethod,
        input.accountType,
      );
      const delta = D(input.amount);
      const balanceAfter = input.direction === 'ADD' ? balanceBefore.add(delta) : balanceBefore.sub(delta);

      if (balanceAfter.lt(0)) throw new Error('NEGATIVE_WALLET_BALANCE');

      const created = await tx.customerWalletSettlement.create({
        data: {
          personId: id,
          currencyId: currency.id,
          paymentMethod,
          accountType: input.accountType,
          direction: input.direction,
          amount: delta,
          balanceBefore,
          balanceAfter,
          reason: input.reason,
          note: input.note || null,
          movementKind: input.movementKind,
          settlementMethod: input.settlementMethod || null,
          userId: session.userId,
          username: session.username,
        },
        include: { currency: true, person: true },
      });

      if (input.movementKind === 'REPAYMENT') {
        await tx.customerAccountRepayment.create({
          data: {
            settlementId: created.id,
            personId: id,
            currencyId: currency.id,
            paymentMethod,
            accountType: input.accountType,
            amount: delta,
            balanceBefore,
            balanceAfter,
            reason: input.reason,
            note: input.note || null,
            userId: session.userId,
            username: session.username,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.userId,
          username: session.username,
          sessionId: session.id,
          action: 'CUSTOMER_WALLET_SETTLEMENT_CREATE',
          entityType: 'CustomerWalletSettlement',
          entityId: created.id,
          oldValue: {
            personId: id,
            currencyId: currency.id,
            paymentMethod,
            accountType: input.accountType,
            balance: balanceBefore.toString(),
          },
          newValue: {
            id: created.id,
            personId: id,
            currencyId: currency.id,
            paymentMethod,
            accountType: input.accountType,
            direction: input.direction,
            amount: delta.toString(),
            balanceBefore: balanceBefore.toString(),
            balanceAfter: balanceAfter.toString(),
            reason: input.reason,
            note: input.note || null,
            movementKind: input.movementKind,
            settlementMethod: input.settlementMethod || null,
          },
          description: `${walletSettlementDirectionLabels[input.direction]} ${walletAccountLabels[input.accountType]} - ${person.fullName}`,
          ip: meta.ip,
          userAgent: meta.ua,
        },
      });

      return created;
    });

    revalidateFinancePaths([`/people/${id}`, '/accounts']);
    return ok(settlement, 201);
  } catch (error) {
    if ((error as Error).message === 'PERSON_NOT_FOUND') return fail('الزبون غير موجود', 404);
    if ((error as Error).message === 'INVALID_CURRENCY') return fail('اختر عملة صحيحة');
    if ((error as Error).message === 'NEGATIVE_WALLET_BALANCE') {
      return fail('لا يمكن خصم مبلغ أكبر من الرصيد الحالي', 400);
    }
    if ((error as Error).message === 'REPAYMENT_MUST_SUBTRACT') {
      return fail('حركة السداد يجب أن تكون خصمًا من الرصيد الحالي');
    }
    return apiError(error);
  }
}
