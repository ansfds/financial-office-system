import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
loadEnvConfig(process.cwd(), false);
const db = new PrismaClient({ log: [] });
async function main() {
  const backupId = await db.$transaction(async tx => {
    const record = await tx.backupRecord.create({ data: {
      type: 'MigrationSafetyBackup', filename: `before-reviewed-migrations-${Date.now()}.json`, status: 'completed',
    } });
    // The affected-table snapshot stays in PostgreSQL; no customer data or credentials are exported.
    await tx.$executeRaw`
      INSERT INTO "DeletedItem" (id, "entityType", "entityId", snapshot, "deletedAt", "restoredAt")
      SELECT ${randomUUID()}, 'MigrationSafetyBackup', ${record.id},
        jsonb_build_object('version',1,'scope','affected-tables-before-additive-migrations','createdAt',now(),'tables',
          jsonb_build_object(
            'Person',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM "Person" t),'[]'::jsonb),
            'ReceivedCardBatch',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM "ReceivedCardBatch" t),'[]'::jsonb),
            'ReceivedCustomerCard',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM "ReceivedCustomerCard" t),'[]'::jsonb),
            'CustomerCardEntryTransaction',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM "CustomerCardEntryTransaction" t),'[]'::jsonb),
            'ReceivedCardOperation',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM "ReceivedCardOperation" t),'[]'::jsonb)
          )),now(),now()`;
    return record.id;
  }, { isolationLevel: 'RepeatableRead', timeout: 120000 });
  console.log('Migration safety snapshot saved inside the database. Backup ID: ' + backupId);
}
main().catch(() => { console.error('Migration preparation failed. No operational rows were changed.'); process.exitCode=1; }).finally(() => db.$disconnect());
