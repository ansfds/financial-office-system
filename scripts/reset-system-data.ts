import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

const backupDir = path.join(process.cwd(), 'backups');
const backupName = `system-data-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const backupPath = path.join(backupDir, backupName);

function ensureConfirmed() {
  if (process.env.CONFIRM_RESET_SYSTEM_DATA !== 'RESET') {
    throw new Error('Set CONFIRM_RESET_SYSTEM_DATA=RESET before running this script.');
  }
}

async function backupData() {
  const [
    systemSettings,
    currencies,
    transactionTypes,
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
    attachments,
    loginSessions,
    loginAttempts,
    auditLogs,
    deletedItems,
    backupRecords,
  ] = await Promise.all([
    prisma.systemSetting.findMany(),
    prisma.currency.findMany(),
    prisma.transactionType.findMany(),
    prisma.person.findMany(),
    prisma.financialTransaction.findMany(),
    prisma.transactionMovement.findMany(),
    prisma.cashboxMovement.findMany(),
    prisma.currencyConversion.findMany(),
    prisma.sheinCard.findMany(),
    prisma.sheinCardLog.findMany(),
    prisma.sheinCardSale.findMany(),
    prisma.sheinCardSaleItem.findMany(),
    prisma.receivedCardBatch.findMany(),
    prisma.receivedCustomerCard.findMany(),
    prisma.attachment.findMany(),
    prisma.loginSession.findMany(),
    prisma.loginAttempt.findMany(),
    prisma.auditLog.findMany(),
    prisma.deletedItem.findMany(),
    prisma.backupRecord.findMany(),
  ]);

  await mkdir(backupDir, { recursive: true });
  await writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        source: 'scripts/reset-system-data.ts',
        tables: {
          systemSettings,
          currencies,
          transactionTypes,
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
          attachments,
          loginSessions,
          loginAttempts,
          auditLogs,
          deletedItems,
          backupRecords,
        },
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function resetData() {
  const deleted = await prisma.$transaction(async (tx) => {
    const result: Record<string, number> = {};

    result.attachments = (await tx.attachment.deleteMany()).count;
    result.sheinCardSaleItems = (await tx.sheinCardSaleItem.deleteMany()).count;
    result.sheinCardSales = (await tx.sheinCardSale.deleteMany()).count;
    result.sheinCardLogs = (await tx.sheinCardLog.deleteMany()).count;
    result.currencyConversions = (await tx.currencyConversion.deleteMany()).count;
    result.cashboxMovements = (await tx.cashboxMovement.deleteMany()).count;
    result.transactionMovements = (await tx.transactionMovement.deleteMany()).count;
    result.financialTransactions = (await tx.financialTransaction.deleteMany()).count;
    result.receivedCustomerCards = (await tx.receivedCustomerCard.deleteMany()).count;
    result.receivedCardBatches = (await tx.receivedCardBatch.deleteMany()).count;
    result.sheinCards = (await tx.sheinCard.deleteMany()).count;
    result.deletedItems = (await tx.deletedItem.deleteMany()).count;
    result.auditLogs = (await tx.auditLog.deleteMany()).count;
    result.loginSessions = (await tx.loginSession.deleteMany()).count;
    result.loginAttempts = (await tx.loginAttempt.deleteMany()).count;
    result.people = (await tx.person.deleteMany()).count;

    await tx.backupRecord.create({
      data: {
        type: 'SYSTEM_DATA_RESET_BACKUP',
        filename: backupName,
        status: 'COMPLETED',
      },
    });

    await tx.auditLog.create({
      data: {
        action: 'SYSTEM_DATA_RESET',
        entityType: 'System',
        entityId: backupName,
        description: 'Reset system data for fresh start after backup',
        newValue: result,
      },
    });

    return result;
  });

  return deleted;
}

async function main() {
  ensureConfirmed();
  await backupData();
  const deleted = await resetData();

  console.log(`Backup created: ${backupPath}`);
  console.log('Deleted rows:');
  for (const [table, count] of Object.entries(deleted)) {
    console.log(`- ${table}: ${count}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
