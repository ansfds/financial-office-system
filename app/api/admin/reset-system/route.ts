import { createHash, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { clientMeta, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, fail, ok } from '@/lib/http';
import { revalidateFinancePaths } from '@/lib/revalidate';
import { z } from 'zod';

const RESET_FULL_CONFIRMATION_TEXT = 'RESET FULL SYSTEM DATA';

const fullResetSchema = z.object({
  resetPassword: z.string().min(1),
  confirmationText: z.literal(RESET_FULL_CONFIRMATION_TEXT),
});

export const runtime = 'nodejs';

function resetPasswordSecret() {
  return process.env.RESET_SYSTEM_PASSWORD?.trim() || '';
}

function safeSecretMatch(input: string, secret: string) {
  if (!secret) return false;

  const inputHash = createHash('sha256').update(input).digest();
  const secretHash = createHash('sha256').update(secret).digest();
  return inputHash.length === secretHash.length && timingSafeEqual(inputHash, secretHash);
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function assertFreshStartCounts(counts: Record<string, number>) {
  const nonZero = Object.entries(counts).filter(([, count]) => count !== 0);
  if (nonZero.length) {
    throw new Error(`FULL_RESET_REMAINING_DATA:${nonZero.map(([key]) => key).join(',')}`);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const meta = await clientMeta();

    const secret = resetPasswordSecret();
    if (!secret) return fail('تم تعطيل التصفير مؤقتًا حتى يتم ضبط RESET_SYSTEM_PASSWORD', 503);

    const parsed = fullResetSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail(`أدخل كلمة مرور التصفير واكتب عبارة التأكيد ${RESET_FULL_CONFIRMATION_TEXT}`);
    }

    const input = parsed.data;
    if (!safeSecretMatch(input.resetPassword, secret)) return fail('كلمة مرور التصفير غير صحيحة', 403);

    const resetAt = new Date();
    const stamp = resetAt.toISOString().replace(/[:.]/g, '-');
    const result = await db.$transaction(
      async (tx) => {
        const [
          people,
          financialTransactions,
          transactionMovements,
          cashboxMovements,
          currencyConversions,
          sheinCards,
          sheinCardLogs,
          sheinCardSales,
          sheinCardSaleItems,
          receivedCardBatches,
          receivedCustomerCards,
          customerWalletSettlements,
          attachments,
          auditLogs,
          deletedItems,
          backupRecords,
        ] = await Promise.all([
          tx.person.findMany(),
          tx.financialTransaction.findMany(),
          tx.transactionMovement.findMany(),
          tx.cashboxMovement.findMany(),
          tx.currencyConversion.findMany(),
          tx.sheinCard.findMany(),
          tx.sheinCardLog.findMany(),
          tx.sheinCardSale.findMany(),
          tx.sheinCardSaleItem.findMany(),
          tx.receivedCardBatch.findMany(),
          tx.receivedCustomerCard.findMany(),
          tx.customerWalletSettlement.findMany(),
          tx.attachment.findMany(),
          tx.auditLog.findMany(),
          tx.deletedItem.findMany(),
          tx.backupRecord.findMany(),
        ]);

        const backupData = {
          createdAt: resetAt.toISOString(),
          source: 'app/api/admin/reset-system',
          resetType: 'FULL_SYSTEM_RESET',
          preservedTables: ['Users', 'SystemSetting', 'Currency', 'TransactionType', 'BackupRecord'],
          tables: {
            people,
            financialTransactions,
            transactionMovements,
            cashboxMovements,
            currencyConversions,
            sheinCards,
            sheinCardLogs,
            sheinCardSales,
            sheinCardSaleItems,
            receivedCardBatches,
            receivedCustomerCards,
            customerWalletSettlements,
            attachments,
            auditLogs,
            deletedItems,
            backupRecords,
          },
        };

        const backupRecord = await tx.backupRecord.create({
          data: {
            type: 'full-system-reset-json',
            filename: `full-system-reset-${stamp}.json`,
            status: 'completed',
          },
        });

        const deleted: Record<string, number> = {};
        deleted.attachments = (await tx.attachment.deleteMany()).count;
        deleted.customerWalletSettlements = (await tx.customerWalletSettlement.deleteMany()).count;
        deleted.sheinCardSaleItems = (await tx.sheinCardSaleItem.deleteMany()).count;
        deleted.sheinCardLogs = (await tx.sheinCardLog.deleteMany()).count;
        deleted.sheinCardSales = (await tx.sheinCardSale.deleteMany()).count;
        deleted.receivedCustomerCards = (await tx.receivedCustomerCard.deleteMany()).count;
        deleted.receivedCardBatches = (await tx.receivedCardBatch.deleteMany()).count;
        deleted.currencyConversions = (await tx.currencyConversion.deleteMany()).count;
        deleted.cashboxMovements = (await tx.cashboxMovement.deleteMany()).count;
        deleted.transactionMovements = (await tx.transactionMovement.deleteMany()).count;
        deleted.financialTransactions = (await tx.financialTransaction.deleteMany()).count;
        deleted.sheinCards = (await tx.sheinCard.deleteMany()).count;
        deleted.deletedItems = (await tx.deletedItem.deleteMany()).count;
        deleted.people = (await tx.person.deleteMany()).count;
        deleted.auditLogs = (await tx.auditLog.deleteMany()).count;

        const backupSnapshot = await tx.deletedItem.create({
          data: {
            entityType: 'FullSystemResetBackup',
            entityId: backupRecord.id,
            restoredAt: resetAt,
            snapshot: toJson({
              backupRecordId: backupRecord.id,
              filename: backupRecord.filename,
              ...backupData,
            }),
          },
        });

        const auditLog = await tx.auditLog.create({
          data: {
            userId: session.userId,
            username: session.username,
            action: 'FULL_SYSTEM_RESET',
            entityType: 'System',
            entityId: backupRecord.id,
            oldValue: {
              backupRecordId: backupRecord.id,
              backupSnapshotId: backupSnapshot.id,
              countsBefore: {
                people: people.length,
                financialTransactions: financialTransactions.length,
                transactionMovements: transactionMovements.length,
                cashboxMovements: cashboxMovements.length,
                currencyConversions: currencyConversions.length,
                sheinCards: sheinCards.length,
                sheinCardSales: sheinCardSales.length,
                receivedCardBatches: receivedCardBatches.length,
                receivedCustomerCards: receivedCustomerCards.length,
                customerWalletSettlements: customerWalletSettlements.length,
                auditLogs: auditLogs.length,
                deletedItems: deletedItems.length,
              },
            },
            newValue: deleted,
            description: 'تصفير كامل لبيانات الشغل مع إبقاء المستخدمين والإعدادات الأساسية',
            ip: meta.ip,
            userAgent: meta.ua,
            sessionId: session.id,
          },
        });

        const remainingOperational = {
          customers: await tx.person.count(),
          transactions: await tx.financialTransaction.count(),
          transactionMovements: await tx.transactionMovement.count(),
          cashboxMovements: await tx.cashboxMovement.count(),
          currencyConversions: await tx.currencyConversion.count(),
          sheinCards: await tx.sheinCard.count(),
          sheinCardSales: await tx.sheinCardSale.count(),
          sheinCardSaleItems: await tx.sheinCardSaleItem.count(),
          sheinCardLogs: await tx.sheinCardLog.count(),
          receivedCardBatches: await tx.receivedCardBatch.count(),
          receivedCustomerCards: await tx.receivedCustomerCard.count(),
          walletSettlements: await tx.customerWalletSettlement.count(),
          attachments: await tx.attachment.count(),
          visibleDeletedItems: await tx.deletedItem.count({ where: { restoredAt: null } }),
        };
        assertFreshStartCounts(remainingOperational);

        const preserved = {
          users: await tx.user.count(),
          settings: await tx.systemSetting.count(),
          currencies: await tx.currency.count(),
          transactionTypes: await tx.transactionType.count(),
          backupRecords: await tx.backupRecord.count(),
          auditLogs: await tx.auditLog.count(),
        };

        if (preserved.auditLogs !== 1) throw new Error('FULL_RESET_AUDIT_LOG_MISMATCH');

        return {
          resetAt,
          backupRecordId: backupRecord.id,
          backupSnapshotId: backupSnapshot.id,
          auditLogId: auditLog.id,
          deleted,
          remainingOperational,
          preserved,
        };
      },
      { timeout: 60_000 },
    );

    revalidateFinancePaths(['/trash', '/reports/daily']);
    return ok(result);
  } catch (error) {
    return apiError(error);
  }
}
