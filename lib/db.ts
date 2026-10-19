import { PrismaClient } from '@prisma/client';
import { databaseError } from './server-errors';

type QueryClient = Omit<PrismaClient, '$on' | '$extends'>;
function createDatabaseClient(): QueryClient {
  return new PrismaClient({ log: [] }).$extends({
    query: {
      async $allOperations({ args, query }) {
        try { return await query(args); }
        catch (error) { throw databaseError(error); }
      },
    },
  // This query-only extension preserves model arguments, results, and transaction APIs.
  }) as unknown as QueryClient;
}
const globalDatabase = globalThis as unknown as { officeDatabase?: ReturnType<typeof createDatabaseClient> };
export const db = globalDatabase.officeDatabase ?? createDatabaseClient();
globalDatabase.officeDatabase = db;
