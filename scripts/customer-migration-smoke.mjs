import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.resolve('.tmp/isolated-postgres/package.json'));
const { PGlite } = require('@electric-sql/pglite');
const db = await PGlite.create();
try {
  await db.exec(await readFile('.tmp/baseline.sql', 'utf8'));
  await db.exec(`INSERT INTO "Person" (id, "fullName", "updatedAt") VALUES ('old-person', 'Legacy test customer', now());
    INSERT INTO "ReceivedCardBatch" (id, "personId", "cardCount", "agreedAmountPerCard", "receivedAt", "updatedAt") VALUES ('old-batch', 'old-person', 3, 1800, '2026-10-01T10:00:00Z', now());
    INSERT INTO "ReceivedCustomerCard" (id, "batchId", sequence, "cardLast4", "valueUsd", "agreedAmount", "receivedAmount", "totalDeducted", "remainingAmount", "updatedAt", "cardImageDataUrl") VALUES
      ('old-card-1', 'old-batch', 1, '1111', 2000, 1800, 500, 500, 1500, '2026-10-02T12:00:00Z', 'legacy-image-sentinel'),
      ('old-card-2', 'old-batch', 2, '2222', 2000, 1800, 500, 500, 1500, '2026-10-02T12:00:00Z', null),
      ('old-card-3', 'old-batch', 3, '3333', 2000, 1800, 500, 500, 1500, '2026-10-02T12:00:00Z', null);
    INSERT INTO "ReceivedCardOperation" (id, "cardId", "operationType", amount, "balanceBefore", "balanceAfter", "updatedAt") VALUES
      ('old-op-1', 'old-card-2', 'INVOICE', 100, 2000, 1900, now()),
      ('old-op-2', 'old-card-3', 'INVOICE', 500, 2000, 1500, now());`);
  await db.exec(await readFile('prisma/migrations/202610180001_customer_workflow/migration.sql', 'utf8'));
  const sql = await readFile(
    'prisma/migrations/202610180002_legacy_withdrawal_opening/migration.sql',
    'utf8',
  );
  await db.exec(sql);
  await db.exec(sql);
  const batch = (
    await db.query(
      `SELECT *, "receivedAt"::text AS "savedDate" FROM "ReceivedCardBatch" WHERE id='old-batch'`,
    )
  ).rows[0];
  assert.equal(batch.entryTransactionId, 'legacy-old-batch');
  assert.equal(batch.savedDate, '2026-10-01 10:00:00');
  const cards = (await db.query(`SELECT * FROM "ReceivedCustomerCard" ORDER BY sequence`)).rows;
  assert.equal(cards.length, 3);
  assert.equal(cards[0].cardImageDataUrl, 'legacy-image-sentinel');
  assert.equal(cards[0].phoneSecondary, undefined);
  const balances = (
    await db.query(
      `SELECT "cardId", SUM(amount) AS total FROM "ReceivedCardOperation" GROUP BY "cardId" ORDER BY "cardId"`,
    )
  ).rows;
  for (const row of balances) assert.equal(Number(row.total), 500);
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int AS n FROM "ReceivedCardOperation" WHERE id LIKE 'legacy-withdrawal-%'`,
      )
    ).rows[0].n,
    2,
  );
  await db.exec(
    `UPDATE "ReceivedCustomerCard" SET status='PAYMENT_FAILED' WHERE id='old-card-1'; UPDATE "Person" SET "phoneSecondary"='0920000000' WHERE id='old-person'; INSERT INTO "DailyNote" (id,title,content,"createdBy","updatedAt") VALUES ('note','test','text','tester',now());`,
  );
  await writeFile(
    '.tmp/customer-migration-results.json',
    JSON.stringify(
      {
        preservedCustomerIds: true,
        preservedBatchDates: true,
        preservedCardIdsAndImages: true,
        preservedLegacyWithdrawals: [500, 500, 500],
        idempotentWithdrawalBackfill: true,
        newFieldsAndStatuses: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS additive migration, preserved legacy IDs/dates/images, complete and partial withdrawal ledgers, repeat-safe backfill, new note and phone fields',
  );
} finally {
  await db.close();
}
