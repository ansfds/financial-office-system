import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function tableRows(tableName: string) {
  const quoted = quoteIdentifier(tableName);
  const escapedRegclass = quoted.replaceAll("'", "''");
  const existsResult = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT to_regclass('${escapedRegclass}') IS NOT NULL AS "exists"`,
  );

  if (!existsResult[0]?.exists) return [];

  const rows = await prisma.$queryRawUnsafe<Array<{ row: unknown }>>(
    `SELECT to_jsonb(t) AS row FROM ${quoted} t`,
  );
  return rows.map((item) => item.row);
}

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
      people: await tableRows('Person'),
      users: await tableRows('Users'),
      currencies: await tableRows('Currency'),
      transactionTypes: await tableRows('TransactionType'),
      financialTransactions: await tableRows('FinancialTransaction'),
      transactionMovements: await tableRows('TransactionMovement'),
      cashboxMovements: await tableRows('CashboxMovement'),
      currencyConversions: await tableRows('CurrencyConversion'),
      transactionExecutionItems: await tableRows('TransactionExecutionItem'),
      sheinCards: await tableRows('SheinCard'),
      sheinCardSales: await tableRows('SheinCardSale'),
      sheinCardSaleItems: await tableRows('SheinCardSaleItem'),
      sheinCardLogs: await tableRows('SheinCardLog'),
      receivedCardBatches: await tableRows('ReceivedCardBatch'),
      receivedCustomerCards: await tableRows('ReceivedCustomerCard'),
      receivedCardStageLogs: await tableRows('ReceivedCardStageLog'),
      customerCardEntryTransactions: await tableRows('CustomerCardEntryTransaction'),
      cardDiscountCategories: await tableRows('CardDiscountCategory'),
      receivedCardOperations: await tableRows('ReceivedCardOperation'),
      customerCardDeliveries: await tableRows('CustomerCardDelivery'),
      customerWalletSettlements: await tableRows('CustomerWalletSettlement'),
      customerAccountRepayments: await tableRows('CustomerAccountRepayment'),
      auditLogs: await tableRows('AuditLog'),
      deletedItems: await tableRows('DeletedItem'),
      settings: await tableRows('SystemSetting'),
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
