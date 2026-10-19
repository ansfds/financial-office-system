// CLI reset is deliberately limited to an explicitly confirmed loopback test database.
import { PrismaClient } from '@prisma/client';
import { resetOperationalData, lockOperationalTables } from '../lib/system-backup';
const prisma = new PrismaClient();
async function main() {
  const host = new URL(process.env.DATABASE_URL || '').hostname;
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.CONFIRM_RESET_SYSTEM_DATA !== 'RESET TEST DATABASE' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(host)
  )
    throw new Error('Use the protected settings interface; CLI reset only supports local test databases.');
  await prisma.$transaction(
    async (tx) => {
      await lockOperationalTables(tx);
      const result = await resetOperationalData(tx);
      await tx.auditLog.create({
        data: { action: 'SYSTEM_RESET', entityType: 'System', username: 'test-cli', newValue: result },
      });
    },
    { timeout: 120000 },
  );
  console.log('Local test database reset after backup.');
}
main()
  .catch(() => {
    console.error('Reset failed or was refused.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
