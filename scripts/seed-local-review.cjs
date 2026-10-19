require('./local-review-env.cjs');
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const prisma = new PrismaClient();
(async () => {
  if (new URL(process.env.DATABASE_URL).hostname !== '127.0.0.1') throw new Error('Local database required');
  for (const [code, name, symbol] of [
    ['USD', 'دولار', '$'],
    ['LYD', 'دينار', 'د.ل'],
  ])
    await prisma.currency.upsert({ where: { code }, create: { code, name, symbol }, update: {} });
  for (const [username, env] of [
    ['ANS', 'USER_ANS_PASSWORD'],
    ['Mohammed', 'USER_MOHAMMED_PASSWORD'],
    ['Hossam', 'USER_HOSSAM_PASSWORD'],
  ])
    await prisma.user.upsert({
      where: { username },
      create: { username, passwordHash: await argon2.hash(process.env[env]) },
      update: {},
    });
  await prisma.systemSetting.upsert({
    where: { key: 'local-review' },
    create: { key: 'local-review', value: { isolated: true } },
    update: {},
  });
  console.log('Local review currencies and users ready. Credentials saved in .tmp/local-review-access.txt');
})()
  .catch(() => {
    console.error('Local seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
