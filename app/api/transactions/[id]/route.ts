import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { createCashboxMovement } from '@/lib/cashbox';
import { inferMovementPaymentMethod } from '@/lib/cashbox-summary';
import { apiError, fail, ok } from '@/lib/http';
import { D, statusOf } from '@/lib/money';
import { paymentMethodForCurrency } from '@/lib/payment-methods';
import { normalizeWalletPaymentMethod, walletAccountAmount } from '@/lib/customer-wallet';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const executionStatusSchema = z.enum(['COMPLETED', 'PENDING', 'NOT_EXECUTED']);
const notExecutedActionSchema = z.enum(['REFUND', 'CONVERT_TO_WALLET', 'KEEP_WITH_NOTE']);

const updateTransactionSchema = z.object({
  receivedAmount: z.coerce.number().min(0).optional(),
  paidAmount: z.coerce.number().min(0).optional(),
  bankName: z.string().trim().optional().nullable(),
  executionType: z.string().trim().optional().nullable(),
  verificationReceived: z.coerce.boolean().optional(),
  secureInternalNote: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  executionStatus: executionStatusSchema.optional(),
  executionNote: z.string().trim().optional().nullable(),
  notExecutedAction: notExecutedActionSchema.optional().nullable(),
});

function absDecimal(value: Prisma.Decimal) {
  return value.lt(0) ? value.mul(-1) : value;
}

function paymentMethodForTransaction(transaction: any) {
  return (
    inferMovementPaymentMethod({
      currency: transaction.currency,
      transaction: {
        operationKind: transaction.operationKind,
        operationDetails: transaction.operationDetails,
        sheinPaymentMethod: transaction.sheinPaymentMethod,
      },
    }) || paymentMethodForCurrency(transaction.currency.code, 'CASH')
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const username = session.username || 'system';

    const { id } = await params;
    const parsed = updateTransactionSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات تعديل الدفعة');

    const payload = parsed.data;

    const result = await db.$transaction(async (tx) => {
      const oldValue = await tx.financialTransaction.findUniqueOrThrow({
        where: { id },
        include: {
          currency: true,
          executionItems: { include: { sheinCard: true } },
          sheinCardSale: true,
        },
      });
      let receivedAmount =
        payload.receivedAmount === undefined ? oldValue.receivedAmount : D(payload.receivedAmount);
      let paidAmount = payload.paidAmount === undefined ? oldValue.paidAmount : D(payload.paidAmount);
      const executionNote = payload.executionNote === undefined ? oldValue.executionNote : payload.executionNote;
      let executionStatus = payload.executionStatus === undefined ? oldValue.executionStatus : payload.executionStatus;
      let notExecutedAction =
        payload.notExecutedAction === undefined ? oldValue.notExecutedAction : payload.notExecutedAction;
      const operationDetails =
        oldValue.operationDetails && typeof oldValue.operationDetails === 'object' && !Array.isArray(oldValue.operationDetails)
          ? { ...(oldValue.operationDetails as Record<string, any>) }
          : {};

      const deltaReceived = receivedAmount.sub(oldValue.receivedAmount);
      const deltaPaid = paidAmount.sub(oldValue.paidAmount);

      const adjustmentMovements = [
        {
          delta: deltaReceived,
          direction: deltaReceived.gte(0) ? ('IN' as const) : ('OUT' as const),
          reason: 'تعديل المبلغ المستلم',
        },
        {
          delta: deltaPaid,
          direction: deltaPaid.gte(0) ? ('OUT' as const) : ('IN' as const),
          reason: 'تعديل المبلغ المدفوع',
        },
      ];

      for (const movement of adjustmentMovements) {
        if (movement.delta.eq(0)) continue;

        const amount = absDecimal(movement.delta);
        const paymentMethod = paymentMethodForTransaction(oldValue);
        const last = await tx.cashboxMovement.findFirst({
          where: { currencyId: oldValue.currencyId },
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        });
        const balanceBefore = last?.balanceAfter || D(0);
        const balanceAfter =
          movement.direction === 'IN' ? balanceBefore.add(amount) : balanceBefore.sub(amount);

        const createdMovement = await tx.transactionMovement.create({
          data: {
            transactionId: id,
            type: movement.direction === 'IN' ? 'CASH_IN' : 'CASH_OUT',
            direction: movement.direction,
            amount,
            currencyId: oldValue.currencyId,
            notes: movement.reason,
            createdBy: username,
            balanceBefore,
            balanceAfter,
          },
        });

        await createCashboxMovement(tx, {
          currencyId: oldValue.currencyId,
          transactionId: id,
          personId: oldValue.personId,
          direction: movement.direction,
          amount,
          paymentMethod,
          reason: movement.reason,
          sourceType: 'TransactionEdit',
          sourceId: createdMovement.id,
          createdBy: username,
        });
      }

      const refundMovements: any[] = [];
      let walletSettlement: any = null;
      let releasedCards = 0;

      async function createRefundMovement(direction: 'IN' | 'OUT', amount: Prisma.Decimal, reason: string) {
        const last = await tx.cashboxMovement.findFirst({
          where: { currencyId: oldValue.currencyId },
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        });
        const balanceBefore = last?.balanceAfter || D(0);
        const balanceAfter = direction === 'IN' ? balanceBefore.add(amount) : balanceBefore.sub(amount);
        const transactionMovement = await tx.transactionMovement.create({
          data: {
            transactionId: id,
            type: 'REVERSAL',
            direction,
            amount,
            currencyId: oldValue.currencyId,
            notes: reason,
            createdBy: username,
            balanceBefore,
            balanceAfter,
          },
        });

        return createCashboxMovement(tx, {
          currencyId: oldValue.currencyId,
          transactionId: id,
          personId: oldValue.personId,
          direction,
          amount,
          paymentMethod: paymentMethodForTransaction(oldValue),
          reason,
          sourceType: 'TransactionNotExecuted',
          sourceId: transactionMovement.id,
          note: executionNote || null,
          createdBy: username,
        });
      }

      if (
        executionStatus === 'COMPLETED' &&
        oldValue.operationKind === 'SHEIN_CARD_SALE' &&
        oldValue.executionItems.length > 0 &&
        oldValue.executionItems.some((item) => item.status !== 'COMPLETED')
      ) {
        throw new Error('EXECUTION_ITEMS_NOT_COMPLETED');
      }

      if (executionStatus === 'NOT_EXECUTED') {
        const hasPayment = oldValue.receivedAmount.gt(0) || oldValue.paidAmount.gt(0);
        if (hasPayment && !notExecutedAction) throw new Error('NOT_EXECUTED_ACTION_REQUIRED');
        if (notExecutedAction === 'KEEP_WITH_NOTE' && !executionNote?.trim()) {
          throw new Error('NOT_EXECUTED_NOTE_REQUIRED');
        }
        if (notExecutedAction === 'CONVERT_TO_WALLET' && !oldValue.personId) {
          throw new Error('NOT_EXECUTED_WALLET_REQUIRES_PERSON');
        }

        for (const item of oldValue.executionItems) {
          if (!item.sheinCardId) continue;

          await tx.sheinCardSaleItem.deleteMany({ where: { cardId: item.sheinCardId } });
          await tx.sheinCard.update({
            where: { id: item.sheinCardId },
            data: {
              status: 'AVAILABLE',
              buyerPersonId: null,
              linkedTransactionId: null,
              linkedExecutionItemId: null,
              usedAt: null,
              usedByUserId: null,
              soldAt: null,
              saleCashboxMovementId: null,
              logs: {
                create: {
                  type: 'RELEASE',
                  note: executionNote || 'إلغاء ربط كرت من معاملة لم يتم تنفيذها',
                  createdBy: username,
                },
              },
            },
          });
          releasedCards += 1;
        }

        await tx.transactionExecutionItem.updateMany({
          where: { transactionId: id },
          data: {
            status: 'NOT_EXECUTED',
            sheinCardId: null,
            executedAt: null,
            executedByUserId: null,
            note: executionNote || undefined,
          },
        });

        if (notExecutedAction === 'REFUND') {
          if (!Array.isArray(operationDetails.notExecutedRefundMovementIds)) {
            if (oldValue.receivedAmount.gt(0)) {
              refundMovements.push(
                await createRefundMovement('OUT', oldValue.receivedAmount, 'إرجاع مبلغ معاملة لم يتم تنفيذها للزبون'),
              );
            }
            if (oldValue.paidAmount.gt(0)) {
              refundMovements.push(
                await createRefundMovement('IN', oldValue.paidAmount, 'عكس مبلغ مدفوع لمعاملة لم يتم تنفيذها'),
              );
            }
            operationDetails.notExecutedRefundMovementIds = refundMovements.map((movement) => movement.id);
          }
          receivedAmount = D(0);
          paidAmount = D(0);
        }

        if (notExecutedAction === 'CONVERT_TO_WALLET') {
          if (oldValue.receivedAmount.lte(0)) throw new Error('NOT_EXECUTED_WALLET_REQUIRES_RECEIVED_AMOUNT');

          if (!operationDetails.notExecutedWalletSettlementId) {
            const paymentMethod = normalizeWalletPaymentMethod(paymentMethodForTransaction(oldValue), oldValue.currency.code);
            const [transactions, settlements] = await Promise.all([
              tx.financialTransaction.findMany({
                where: { personId: oldValue.personId, deletedAt: null },
                include: { currency: true },
              }),
              tx.customerWalletSettlement.findMany({
                where: { personId: oldValue.personId! },
                include: { currency: true },
              }),
            ]);
            const balanceBefore = walletAccountAmount(
              transactions,
              settlements,
              oldValue.currencyId,
              paymentMethod,
              'CREDIT',
            );
            const balanceAfter = balanceBefore.add(oldValue.receivedAmount);

            walletSettlement = await tx.customerWalletSettlement.create({
              data: {
                personId: oldValue.personId!,
                currencyId: oldValue.currencyId,
                paymentMethod,
                accountType: 'CREDIT',
                direction: 'ADD',
                amount: oldValue.receivedAmount,
                balanceBefore,
                balanceAfter,
                reason: 'تحويل مبلغ معاملة لم يتم تنفيذها إلى محفظة الزبون',
                note: executionNote || null,
                userId: session.userId,
                username,
              },
            });
            operationDetails.notExecutedWalletSettlementId = walletSettlement.id;
          }
        }

        operationDetails.notExecutedAction = notExecutedAction;
        operationDetails.notExecutedAt = new Date().toISOString();
        operationDetails.releasedExecutionCards = releasedCards;
      } else if (payload.executionStatus) {
        notExecutedAction = null;
      }

      const nextStatus =
        executionStatus === 'NOT_EXECUTED'
          ? 'CANCELLED'
          : statusOf(
              oldValue.agreedAmount,
              receivedAmount,
              paidAmount,
              oldValue.receivableAmount,
              oldValue.payableAmount,
              oldValue.dueAt,
            );

      const updated = await tx.financialTransaction.update({
        where: { id },
        data: {
          receivedAmount,
          paidAmount,
          bankName: payload.bankName === undefined ? oldValue.bankName : payload.bankName,
          executionType: payload.executionType === undefined ? oldValue.executionType : payload.executionType,
          verificationReceived:
            payload.verificationReceived === undefined
              ? oldValue.verificationReceived
              : payload.verificationReceived,
          secureInternalNote:
            payload.secureInternalNote === undefined
              ? oldValue.secureInternalNote
              : payload.secureInternalNote,
          notes: payload.notes === undefined ? oldValue.notes : payload.notes,
          executionStatus: executionStatus as any,
          executionNote,
          notExecutedAction: notExecutedAction as any,
          operationDetails: operationDetails as any,
          status: nextStatus as any,
        },
        include: {
          person: true,
          currency: true,
          type: true,
          executionItems: {
            include: {
              customer: { select: { id: true, fullName: true, customerNo: true } },
              sheinCard: { select: { id: true, code: true, denomination: true, status: true } },
              executedBy: { select: { id: true, username: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return { oldValue, updated, refundMovements, walletSettlement, releasedCards };
    });

    await audit('TRANSACTION_UPDATE', {
      entityType: 'FinancialTransaction',
      entityId: id,
      oldValue: result.oldValue as any,
      newValue: result.updated as any,
      description: 'تعديل دفعة معاملة',
    });
    if (result.oldValue.executionStatus !== result.updated.executionStatus) {
      await audit('TRANSACTION_EXECUTION_STATUS_CHANGE', {
        entityType: 'FinancialTransaction',
        entityId: id,
        oldValue: { executionStatus: result.oldValue.executionStatus },
        newValue: {
          executionStatus: result.updated.executionStatus,
          executionNote: result.updated.executionNote,
          notExecutedAction: result.updated.notExecutedAction,
        },
        description: 'تغيير حالة تنفيذ المعاملة',
      });
    }
    if (result.refundMovements.length) {
      await audit('TRANSACTION_NOT_EXECUTED_REFUND', {
        entityType: 'CashboxMovement',
        entityId: id,
        oldValue: { transactionId: id, receivedAmount: result.oldValue.receivedAmount, paidAmount: result.oldValue.paidAmount },
        newValue: result.refundMovements as any,
        description: 'إرجاع مبلغ معاملة لم يتم تنفيذها',
      });
    }
    if (result.walletSettlement) {
      await audit('TRANSACTION_NOT_EXECUTED_WALLET_CONVERT', {
        entityType: 'CustomerWalletSettlement',
        entityId: result.walletSettlement.id,
        oldValue: { transactionId: id, receivedAmount: result.oldValue.receivedAmount },
        newValue: result.walletSettlement as any,
        description: 'تحويل مبلغ معاملة لم يتم تنفيذها إلى محفظة الزبون',
      });
    }
    revalidateFinancePaths(result.updated.personId ? [`/people/${result.updated.personId}`] : []);

    return ok(result.updated);
  } catch (error) {
    if ((error as Error).message === 'NOT_EXECUTED_ACTION_REQUIRED') {
      return fail('اختر طريقة التعامل مع المبلغ قبل تغيير المعاملة إلى لم يتم التنفيذ');
    }
    if ((error as Error).message === 'NOT_EXECUTED_NOTE_REQUIRED') {
      return fail('اكتب ملاحظة واضحة عند إبقاء المبلغ بدون إرجاع أو تحويل للمحفظة');
    }
    if ((error as Error).message === 'NOT_EXECUTED_WALLET_REQUIRES_PERSON') {
      return fail('تحويل المبلغ إلى المحفظة يتطلب أن تكون المعاملة مرتبطة بزبون');
    }
    if ((error as Error).message === 'NOT_EXECUTED_WALLET_REQUIRES_RECEIVED_AMOUNT') {
      return fail('لا يوجد مبلغ مستلم يمكن تحويله إلى محفظة الزبون');
    }
    if ((error as Error).message === 'EXECUTION_ITEMS_NOT_COMPLETED') {
      return fail('لا يمكن تحويل الطلب إلى تم التنفيذ قبل تنفيذ كل عناصره');
    }
    return apiError(error);
  }
}
