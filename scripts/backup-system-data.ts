import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createSystemBackup } from '../lib/system-backup';
const prisma = new PrismaClient();
async function main() {
  const result = await prisma.$transaction((tx) => createSystemBackup(tx), {
    isolationLevel: 'RepeatableRead',
    timeout: 120000,
  });
  const snapshot = await prisma.deletedItem.findUniqueOrThrow({ where: { id: result.snapshotId } });
  const directory = path.join(process.cwd(), 'backups');
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, result.record.filename);
  await writeFile(filename, JSON.stringify(snapshot.snapshot, null, 2), { encoding: 'utf8', flag: 'wx' });
  console.log('Backup created: ' + filename);
}
main()
  .catch(() => {
    console.error('Backup failed; no data was deleted.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
