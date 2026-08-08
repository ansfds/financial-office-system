import { Prisma } from '@prisma/client';
import { audit, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, ok } from '@/lib/http';

export const runtime = 'nodejs';

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function tableRows(tx: Prisma.TransactionClient, tableName: string) {
  const quoted = quoteIdentifier(tableName);
  const escapedRegclass = quoted.replaceAll("'", "''");
  const existsResult = await tx.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT to_regclass('${escapedRegclass}') IS NOT NULL AS "exists"`,
  );

  if (!existsResult[0]?.exists) return [];

  const rows = await tx.$queryRawUnsafe<Array<{ row: unknown }>>(
    `SELECT to_jsonb(t) AS row FROM ${quoted} t`,
  );
  return rows.map((item) => item.row);
}

export async function POST() {
  try {
    await requireSession();

    const createdAt = new Date();
    const stamp = createdAt.toISOString().replace(/[:.]/g, '-');
    const filename = `financial-office-backup-${stamp}.json`;

    const result = await db.$transaction(async (tx) => {
      const tables = {
        people: await tableRows(tx, 'Person'),
        users: await tableRows(tx, 'Users'),
        currencies: await tableRows(tx, 'Currency'),
        transactionTypes: await tableRows(tx, 'TransactionType'),
        financialTransactions: await tableRows(tx, 'FinancialTransaction'),
        transactionMovements: await tableRows(tx, 'TransactionMovement'),
        cashboxMovements: await tableRows(tx, 'CashboxMovement'),
        currencyConversions: await tableRows(tx, 'CurrencyConversion'),
        transactionExecutionItems: await tableRows(tx, 'TransactionExecutionItem'),
        sheinCards: await tableRows(tx, 'SheinCard'),
        sheinCardSales: await tableRows(tx, 'SheinCardSale'),
        sheinCardSaleItems: await tableRows(tx, 'SheinCardSaleItem'),
        sheinCardLogs: await tableRows(tx, 'SheinCardLog'),
        receivedCardBatches: await tableRows(tx, 'ReceivedCardBatch'),
        receivedCustomerCards: await tableRows(tx, 'ReceivedCustomerCard'),
        receivedCardStageLogs: await tableRows(tx, 'ReceivedCardStageLog'),
        customerCardEntryTransactions: await tableRows(tx, 'CustomerCardEntryTransaction'),
        cardDiscountCategories: await tableRows(tx, 'CardDiscountCategory'),
        receivedCardOperations: await tableRows(tx, 'ReceivedCardOperation'),
        customerCardDeliveries: await tableRows(tx, 'CustomerCardDelivery'),
        customerWalletSettlements: await tableRows(tx, 'CustomerWalletSettlement'),
        customerAccountRepayments: await tableRows(tx, 'CustomerAccountRepayment'),
        auditLogs: await tableRows(tx, 'AuditLog'),
        deletedItems: await tableRows(tx, 'DeletedItem'),
        backupRecords: await tableRows(tx, 'BackupRecord'),
        settings: await tableRows(tx, 'SystemSetting'),
      };

      const backupRecord = await tx.backupRecord.create({
        data: {
          type: 'manual-db-json',
          filename,
          status: 'completed',
        },
      });

      const snapshot = await tx.deletedItem.create({
        data: {
          entityType: 'ManualBackup',
          entityId: backupRecord.id,
          snapshot: toJson({
            createdAt: createdAt.toISOString(),
            filename,
            tables,
          }),
        },
      });

      return { backupRecord, snapshotId: snapshot.id };
    });

    await audit('MANUAL_BACKUP_CREATE', {
      entityType: 'BackupRecord',
      entityId: result.backupRecord.id,
      newValue: result as any,
      description: 'إنشاء نسخة احتياطية يدوية داخل قاعدة البيانات',
    });

    return ok({ id: result.backupRecord.id, filename, status: result.backupRecord.status });
  } catch (error) {
    return apiError(error);
  }
}
