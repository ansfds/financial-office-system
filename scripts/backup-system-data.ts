import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const backupDir = path.join(process.cwd(), 'backups');
  await mkdir(backupDir, { recursive: true });

  const createdAt = new Date();
  const stamp = createdAt.toISOString().replace(/[:.]/g, '-');
  const filename = `financial-office-backup-${stamp}.json`;
  const filePath = path.join(backupDir, filename);

  const data = {
    createdAt: createdAt.toISOString(),
    schema: 'financial-office-system',
    tables: {
      people: await prisma.person.findMany(),
      currencies: await prisma.currency.findMany(),
      transactionTypes: await prisma.transactionType.findMany(),
      financialTransactions: await prisma.financialTransaction.findMany(),
      transactionMovements: await prisma.transactionMovement.findMany(),
      cashboxMovements: await prisma.cashboxMovement.findMany(),
      currencyConversions: await prisma.currencyConversion.findMany(),
      sheinCards: await prisma.sheinCard.findMany(),
      sheinCardSales: await prisma.sheinCardSale.findMany(),
      sheinCardSaleItems: await prisma.sheinCardSaleItem.findMany(),
      sheinCardLogs: await prisma.sheinCardLog.findMany(),
      receivedCardBatches: await prisma.receivedCardBatch.findMany(),
      receivedCustomerCards: await prisma.receivedCustomerCard.findMany(),
      auditLogs: await prisma.auditLog.findMany(),
      deletedItems: await prisma.deletedItem.findMany(),
      settings: await prisma.systemSetting.findMany(),
    },
  };

  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');

  await prisma.backupRecord.create({
    data: {
      type: 'manual-json',
      filename,
      status: 'completed',
    },
  });

  console.log(`Backup created: ${filePath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
