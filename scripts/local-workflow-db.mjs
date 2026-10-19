import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(path.resolve('.tmp/isolated-postgres/package.json'));
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const database = await PGlite.create(path.resolve('.tmp/workflow-postgres'));
const exists = await database.query(`SELECT to_regclass('"Person"') IS NOT NULL AS present`);
if (!exists.rows[0].present) {
  await database.exec(await readFile('.tmp/baseline.sql', 'utf8'));
  // A legacy batch proves that the new migration retains real IDs and dates.
  await database.exec(`INSERT INTO "Person" (id, "customerNo", "fullName", "updatedAt") VALUES ('legacy-customer', '#0001', 'زبون بيانات سابقة', now());
    INSERT INTO "ReceivedCardBatch" (id, "personId", "cardCount", "agreedAmountPerCard", "receivedAt", "updatedAt") VALUES ('legacy-batch', 'legacy-customer', 1, 1800, '2026-10-01T10:00:00Z', now());
    INSERT INTO "ReceivedCustomerCard" (id, "batchId", sequence, "cardLast4", "valueUsd", "agreedAmount", "remainingAmount", "updatedAt") VALUES ('legacy-card', 'legacy-batch', 1, '1111', 2000, 1800, 2000, now());`);
  await database.exec(
    await readFile('prisma/migrations/202610180001_customer_workflow/migration.sql', 'utf8'),
  );
  const legacy = await database.query(
    `SELECT "entryTransactionId", "receivedAt" FROM "ReceivedCardBatch" WHERE id='legacy-batch'`,
  );
  if (
    legacy.rows[0].entryTransactionId !== 'legacy-legacy-batch' ||
    !String(legacy.rows[0].receivedAt).includes('2026')
  )
    throw new Error('Legacy migration failed');
  console.log('Additive migration passed; legacy IDs, dates and card preserved.');
}
await database.exec(
  await readFile('prisma/migrations/202610180002_legacy_withdrawal_opening/migration.sql', 'utf8'),
);
const server = new PGLiteSocketServer({ db: database, host: '127.0.0.1', port: 55432, maxConnections: 10 });
await server.start();
console.log('Isolated development PostgreSQL listening on 127.0.0.1:55432');
async function stop() {
  await server.stop();
  await database.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
