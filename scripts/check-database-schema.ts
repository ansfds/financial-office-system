import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { databaseReadinessQuery, databaseReady, type DatabaseReadiness } from '../lib/database-readiness';
loadEnvConfig(process.cwd(), false);
const db = new PrismaClient({ log: [] });
async function main() {
  const [result] = await db.$queryRaw<DatabaseReadiness[]>(databaseReadinessQuery);
  if (!databaseReady(result)) throw new Error('Database schema is not ready. Apply the reviewed migrations before deployment.');
  console.log('Database connection and required schema are ready.');
}
main().catch(() => {
  console.error('Database schema check failed. Apply the reviewed migrations with npm run db:deploy before building; verify DATABASE_URL without printing it.');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
