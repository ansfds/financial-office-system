import { Prisma } from '@prisma/client';
// Ordered by foreign-key dependencies. Reused by backup and reset.
export const operationalModels = [
  'attachment',
  'customerAccountRepayment',
  'customerWalletSettlement',
  'customerCardDelivery',
  'receivedCardOperation',
  'receivedCardStageLog',
  'receivedCustomerCard',
  'receivedCardBatch',
  'customerCardEntryTransaction',
  'sheinCardSaleItem',
  'sheinCardLog',
  'sheinCardSale',
  'transactionExecutionItem',
  'currencyConversion',
  'cashboxMovement',
  'transactionMovement',
  'financialTransaction',
  'sheinCard',
  'dailyNote',
  'person',
] as const;
export const backupTypes = ['ManualBackup', 'FullSystemResetBackup', 'CustomerDeleteBackup', 'FinancialTransactionBatch'];
export async function lockOperationalTables(tx: Prisma.TransactionClient) {
  const names = [
    ...operationalModels.map((m) => m[0].toUpperCase() + m.slice(1)),
    'AuditLog',
    'DeletedItem',
    'BackupRecord',
    'SystemSetting',
    'Users',
    'Currency',
    'TransactionType',
    'CardDiscountCategory',
  ].sort();
  await tx.$executeRawUnsafe(`LOCK TABLE ${names.map((n) => `"${n}"`).join(', ')} IN EXCLUSIVE MODE`);
}
export const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function createSystemBackup(tx: Prisma.TransactionClient, type = 'ManualBackup') {
  const tables: Record<string, unknown> = {};
  for (const model of operationalModels) tables[model] = await (tx[model] as any).findMany();
  for (const model of [
    'user',
    'systemSetting',
    'currency',
    'transactionType',
    'cardDiscountCategory',
    'auditLog',
    'backupRecord',
  ] as const)
    tables[model] = await (tx[model] as any).findMany();
  tables.deletedItem = await tx.deletedItem.findMany({ where: { entityType: { notIn: backupTypes } } });
  const createdAt = new Date();
  const filename = `${type === 'FullSystemResetBackup' ? 'backup-before-reset' : 'financial-office-backup'}-${createdAt.toISOString().replace(/[:.]/g, '-')}.json`;
  const record = await tx.backupRecord.create({ data: { type, filename, status: 'completed' } });
  const snapshot = await tx.deletedItem.create({
    data: {
      entityType: type,
      entityId: record.id,
      restoredAt: createdAt,
      snapshot: jsonValue({ version: 2, createdAt, filename, tables }),
    },
  });
  return { record, snapshotId: snapshot.id };
}
export async function resetOperationalData(tx: Prisma.TransactionClient) {
  const backup = await createSystemBackup(tx, 'FullSystemResetBackup');
  const deleted: Record<string, number> = {};
  for (const model of operationalModels) deleted[model] = (await (tx[model] as any).deleteMany()).count;
  deleted.deletedItem = (
    await tx.deletedItem.deleteMany({ where: { entityType: { notIn: backupTypes } } })
  ).count;
  deleted.auditLog = (
    await tx.auditLog.deleteMany({
      where: {
        entityType: { notIn: ['System', 'User', 'LoginSession', 'BackupRecord'] },
        action: { not: 'SYSTEM_RESET' },
      },
    })
  ).count;
  return {
    backupRecordId: backup.record.id,
    backupSnapshotId: backup.snapshotId,
    filename: backup.record.filename,
    deleted,
  };
}
