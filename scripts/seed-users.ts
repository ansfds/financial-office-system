import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { USER_PASSWORD_ENV } from '../lib/users';

const prisma = new PrismaClient();

function readRequiredPasswords() {
  const missing = USER_PASSWORD_ENV.filter(({ env }) => !process.env[env]?.trim());

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.map(({ env }) => env).join(', ')}`,
    );
  }

  return USER_PASSWORD_ENV.map(({ username, env }) => ({
    username,
    password: readPassword(env),
  }));
}

function readPassword(env: string) {
  const password = process.env[env]?.trim() || '';

  if (/^\[[a-z_ -]+\]$/i.test(password)) {
    throw new Error(
      `${env} looks like a Vercel placeholder. Run this seed in an environment that exposes the real secret value.`,
    );
  }

  return password;
}

async function main() {
  const users = readRequiredPasswords();

  for (const user of users) {
    const passwordHash = await argon2.hash(user.password, { type: argon2.argon2id });

    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        passwordHash,
        isActive: true,
      },
      create: {
        username: user.username,
        passwordHash,
        isActive: true,
      },
    });

    const verified = await argon2.verify(passwordHash, user.password);
    if (!verified) throw new Error(`Failed to verify password hash for ${user.username}`);
  }

  console.log(`Seeded and verified ${users.length} users: ${users.map((user) => user.username).join(', ')}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Failed to seed users');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
