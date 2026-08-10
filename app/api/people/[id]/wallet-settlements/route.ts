import { clientMeta, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { revalidateFinancePaths } from '@/lib/revalidate';
import {
  normalizeWalletPaymentMethod,
  previewWalletOperation,
  transactionWalletEffect,
  type WalletAccountType,
  type WalletSettlementDirection,
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
  effectMode: z.enum(['NORMAL', 'OFFSET']).default('NORMAL'),
});

type WalletStateRow = {
  paymentMethod: string;
  CREDIT: ReturnType<typeof D>;
  DEBT: ReturnType<typeof D>;
};

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

function buildCurrencyWalletState(transactions: any[], settlements: any[], currencyId: string) {
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
    row[settlement.accountType as WalletAccountType] =
      settlement.direction === 'ADD'
        ? row[settlement.accountType as WalletAccountType].add(D(settlement.amount))
        : row[settlement.accountType as WalletAccountType].sub(D(settlement.amount));
  }

  return state;
}

function totalWalletSide(state: Map<string, WalletStateRow>, accountType: WalletAccountType) {
  let total = D(0);
  for (const row of state.values()) total = total.add(row[accountType]);
  return total;
}

function decimalMin(left: ReturnType<typeof D>, right: ReturnType<typeof D>) {
  return left.lt(right) ? left : right;
}

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
      const currencyId = currency.id;

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

      const delta = D(input.amount);
      const state = buildCurrencyWalletState(transactions, settlements, currencyId);
      const debtBeforeTotal = totalWalletSide(state, 'DEBT');
      const creditBeforeTotal = totalWalletSide(state, 'CREDIT');
      const legacyBalanceBefore = walletAccountAmount(
        transactions,
        settlements,
        currencyId,
        paymentMethod,
        input.accountType,
      );

      previewWalletOperation({
        debtBefore: debtBeforeTotal,
        creditBefore: creditBeforeTotal,
        amount: delta,
        accountType: input.accountType,
        direction: input.direction,
        effectMode: input.effectMode,
      });

      async function createMovement(data: {
        accountType: WalletAccountType;
        direction: WalletSettlementDirection;
        amount: ReturnType<typeof D>;
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
        const balanceAfter =
          data.direction === 'ADD' ? balanceBefore.add(data.amount) : balanceBefore.sub(data.amount);
        if (balanceAfter.lt(0)) throw new Error('NEGATIVE_WALLET_BALANCE');

        const created = await tx.customerWalletSettlement.create({
          data: {
            personId: id,
            currencyId,
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
            userId: session.userId,
            username: session.username,
          },
          include: { currency: true, person: true },
        });

        row[data.accountType] = balanceAfter;
        return created;
      }

      const created = await createMovement({
        accountType: input.accountType,
        direction: input.direction,
        amount: delta,
        paymentMethod,
        reason: input.reason,
        note: input.note || null,
        movementKind: input.movementKind,
        settlementMethod: input.effectMode === 'OFFSET' ? 'OFFSET' : input.settlementMethod || null,
      });

      if (input.movementKind === 'REPAYMENT') {
        await tx.customerAccountRepayment.create({
          data: {
            settlementId: created.id,
            personId: id,
            currencyId,
            paymentMethod,
            accountType: input.accountType,
            amount: delta,
            balanceBefore: created.balanceBefore,
            balanceAfter: created.balanceAfter,
            reason: input.reason,
            note: input.note || null,
            userId: session.userId,
            username: session.username,
          },
        });
      }

      const linkedSettlements: Awaited<ReturnType<typeof createMovement>>[] = [];
      if (input.effectMode === 'OFFSET') {
        const offsetAmount = decimalMin(totalWalletSide(state, 'DEBT'), totalWalletSide(state, 'CREDIT'));

        async function subtractAcross(accountType: WalletAccountType, amount: ReturnType<typeof D>) {
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
            const current = row[accountType];
            const amountToSubtract = decimalMin(current, remaining);
            linkedSettlements.push(
              await createMovement({
                accountType,
                direction: 'SUBTRACT',
                amount: amountToSubtract,
                paymentMethod: row.paymentMethod,
                reason: 'تسوية تلقائية - خصم من الإجمالي',
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

      const debtAfterTotal = totalWalletSide(state, 'DEBT');
      const creditAfterTotal = totalWalletSide(state, 'CREDIT');
      const walletPreview = {
        effectMode: input.effectMode,
        debtBefore: debtBeforeTotal.toString(),
        creditBefore: creditBeforeTotal.toString(),
        debtAfter: debtAfterTotal.toString(),
        creditAfter: creditAfterTotal.toString(),
        amount: delta.toString(),
        linkedSettlementIds: linkedSettlements.map((item) => item.id),
      };

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
            currencyId,
            paymentMethod,
            accountType: input.accountType,
            balance: legacyBalanceBefore.toString(),
            debtTotal: debtBeforeTotal.toString(),
            creditTotal: creditBeforeTotal.toString(),
          },
          newValue: {
            id: created.id,
            personId: id,
            currencyId,
            paymentMethod,
            accountType: input.accountType,
            direction: input.direction,
            amount: delta.toString(),
            balanceBefore: created.balanceBefore.toString(),
            balanceAfter: created.balanceAfter.toString(),
            reason: input.reason,
            note: input.note || null,
            movementKind: input.movementKind,
            settlementMethod: input.effectMode === 'OFFSET' ? 'OFFSET' : input.settlementMethod || null,
            effectMode: input.effectMode,
            walletPreview,
            linkedSettlements: linkedSettlements.map((item) => ({
              id: item.id,
              paymentMethod: item.paymentMethod,
              accountType: item.accountType,
              amount: item.amount.toString(),
              balanceBefore: item.balanceBefore.toString(),
              balanceAfter: item.balanceAfter.toString(),
            })),
          },
          description: `${walletSettlementDirectionLabels[input.direction]} ${walletAccountLabels[input.accountType]} - ${person.fullName} (${input.effectMode === 'OFFSET' ? 'خصم من الإجمالي' : 'إضافة عادية'})`,
          ip: meta.ip,
          userAgent: meta.ua,
        },
      });

      return {
        ...created,
        linkedSettlements,
        walletPreview,
      };
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
    if ((error as Error).message === 'INVALID_WALLET_AMOUNT') {
      return fail('أدخل قيمة صحيحة أكبر من الصفر');
    }
    return apiError(error);
  }
}
