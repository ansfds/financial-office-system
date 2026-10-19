import { loadEnvConfig } from '@next/env';
import { Prisma, PrismaClient } from '@prisma/client';
loadEnvConfig(process.cwd(), false);
const db = new PrismaClient({ log: [] });
const tables = ['Person', 'ReceivedCardBatch', 'ReceivedCustomerCard', 'CustomerCardEntryTransaction', 'ReceivedCardOperation'] as const;
async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('A safety backup ID is required');
  const results=[];
  for (const table of tables) {
    // Identifiers are selected only from the fixed allowlist above; the ID stays parameterized.
    const ignore = table === 'Person' ? '- \'phoneSecondary\'' : table === 'ReceivedCardBatch' ? '- \'entryTransactionId\'' : '';
    const preserveEntry = table === 'ReceivedCardBatch' ? Prisma.sql`
      OR (original.row->>'entryTransactionId' IS NOT NULL AND current."entryTransactionId" IS DISTINCT FROM original.row->>'entryTransactionId')` : Prisma.empty;
    const query = Prisma.sql`
      WITH original AS (
        SELECT jsonb_array_elements(snapshot->'tables'->${table}) AS row
        FROM "DeletedItem" WHERE "entityType"='MigrationSafetyBackup' AND "entityId"=${id}
      )
      SELECT COUNT(*)::int AS "originalRows",
        COUNT(*) FILTER (WHERE current.id IS NULL)::int AS missing,
        COUNT(*) FILTER (WHERE current.id IS NOT NULL AND
          ((to_jsonb(current) ${Prisma.raw(ignore)}) IS DISTINCT FROM (original.row ${Prisma.raw(ignore)}) ${preserveEntry}))::int AS changed
      FROM original LEFT JOIN ${Prisma.raw('"'+table+'"')} current ON current.id=original.row->>'id'`;
    const [result] = await db.$queryRaw<Array<{originalRows:number;missing:number;changed:number}>>(query);
    if (result.missing || result.changed) throw new Error('Existing data changed in '+table);
    results.push({table,...result});
  }
  if (!await db.deletedItem.count({where:{entityType:'MigrationSafetyBackup',entityId:id}})) throw new Error('Backup not found');
  console.log(JSON.stringify({allExistingOperationalRowsPreserved:true,results},null,2));
}
main().catch(error=>{
  const hint = error?.code || (/^(Existing data changed in |Backup not found|A safety backup ID is required)/.test(error?.message || '') ? error.message : 'UNKNOWN');
  console.error('Migration verification failed:', hint);
  process.exitCode=1;
}).finally(()=>db.$disconnect());
