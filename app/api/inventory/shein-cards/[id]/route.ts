import { db } from '@/lib/db';
import { audit, requireSession } from '@/lib/auth';
import { apiError, fail, ok } from '@/lib/http';
import { D } from '@/lib/money';
import { decryptField } from '@/lib/secure-fields';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const updateSheinCardSchema = z.object({
  status: z.enum(['AVAILABLE', 'SOLD', 'USED', 'RESERVED', 'INVALID', 'CANCELLED']).optional(),
  salePrice: z.coerce.number().min(0).optional().nullable(),
  saleCurrencyId: z.string().optional().nullable(),
  buyerPersonId: z.string().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  logNote: z.string().trim().optional(),
});

const publicSheinCardSelect = {
  id: true,
  code: true,
  denomination: true,
  status: true,
  purchasePrice: true,
  salePrice: true,
  saleCurrencyId: true,
  saleCashboxMovementId: true,
  linkedTransactionId: true,
  linkedExecutionItemId: true,
  usedAt: true,
  usedByUserId: true,
  saleCurrency: true,
  supplier: true,
  buyerPersonId: true,
  buyer: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  soldAt: true,
  logs: { orderBy: { createdAt: 'desc' as const } },
};

function logTypeFor(status?: string) {
  if (status === 'SOLD' || status === 'USED') return 'SALE';
  if (status === 'RESERVED') return 'RESERVE';
  if (status === 'AVAILABLE') return 'RELEASE';
  if (status === 'INVALID' || status === 'CANCELLED') return 'CANCEL';
  return 'UPDATE';
}

function withoutSecrets(card: any) {
  const { cardCodeEncrypted, pinEncrypted, ...safeCard } = card;
  return safeCard;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();

    const { id } = await params;
    const card = await db.sheinCard.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        cardCodeEncrypted: true,
        pinEncrypted: true,
      },
    });
    if (!card) return fail('الكرت غير موجود', 404);

    await audit('SHEIN_CARD_SECRET_REVEAL', {
      entityType: 'SheinCard',
      entityId: id,
      description: `إظهار كود و PIN كرت شي إن ${card.code}`,
    });

    return ok({
      id: card.id,
      code: card.code,
      cardCode: decryptField(card.cardCodeEncrypted),
      pin: decryptField(card.pinEncrypted),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();

    const { id } = await params;
    const parsed = updateSheinCardSchema.safeParse(await request.json());
    if (!parsed.success) return fail('تحقق من بيانات كرت شي إن');

    const input = parsed.data;
    const oldValue = await db.sheinCard.findUnique({ where: { id } });
    if (!oldValue) return fail('الكرت غير موجود', 404);

    const updated = await db.$transaction(async (tx) => {
      const finalStatus = input.status || oldValue.status;
      const saleCurrencyId = input.saleCurrencyId === undefined ? oldValue.saleCurrencyId : input.saleCurrencyId;
      const salePrice = input.salePrice === undefined ? oldValue.salePrice : input.salePrice == null ? null : D(input.salePrice);
      const buyerPersonId = input.buyerPersonId === undefined ? oldValue.buyerPersonId : input.buyerPersonId || null;

      if (input.saleCurrencyId) {
        const saleCurrency = await tx.currency.findFirst({
          where: { id: input.saleCurrencyId, code: { in: ['LYD', 'USD'] }, isActive: true },
        });
        if (!saleCurrency) throw new Error('INVALID_SALE_CURRENCY');
      }

      if (finalStatus === 'AVAILABLE' && oldValue.linkedExecutionItemId) {
        await tx.sheinCardSaleItem.deleteMany({ where: { cardId: id } });
        await tx.transactionExecutionItem.updateMany({
          where: { id: oldValue.linkedExecutionItemId },
          data: {
            sheinCardId: null,
            status: 'PENDING',
            executedAt: null,
            executedByUserId: null,
          },
        });
      }

      return tx.sheinCard.update({
        where: { id },
        data: {
          status: input.status,
          salePrice,
          saleCurrencyId: saleCurrencyId || null,
          saleCashboxMovementId: finalStatus === 'AVAILABLE' ? null : oldValue.saleCashboxMovementId,
          linkedTransactionId: finalStatus === 'AVAILABLE' ? null : oldValue.linkedTransactionId,
          linkedExecutionItemId: finalStatus === 'AVAILABLE' ? null : oldValue.linkedExecutionItemId,
          usedAt: finalStatus === 'AVAILABLE' ? null : oldValue.usedAt,
          usedByUserId: finalStatus === 'AVAILABLE' ? null : oldValue.usedByUserId,
          buyerPersonId,
          notes: input.notes === undefined ? undefined : input.notes,
          soldAt:
            finalStatus === 'SOLD' || finalStatus === 'USED'
              ? oldValue.soldAt || new Date()
              : finalStatus === 'AVAILABLE'
                ? null
                : undefined,
          logs: {
            create: {
              type: logTypeFor(input.status) as any,
              amount: salePrice,
              note: input.logNote || input.notes || 'تعديل حالة كرت شي إن',
            },
          },
        },
        select: publicSheinCardSelect,
      });
    });

    await audit('SHEIN_CARD_UPDATE', {
      entityType: 'SheinCard',
      entityId: id,
      oldValue: withoutSecrets(oldValue) as any,
      newValue: updated as any,
      description: 'تعديل كرت شي إن',
    });
    revalidateFinancePaths(updated.buyerPersonId ? [`/people/${updated.buyerPersonId}`] : []);

    return ok(updated);
  } catch (error) {
    if ((error as Error).message === 'INVALID_SALE_CURRENCY') {
      return fail('عملة الدفع يجب أن تكون دينار أو دولار');
    }
    return apiError(error);
  }
}
