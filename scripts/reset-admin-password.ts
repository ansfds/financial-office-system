import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { ALLOWED_USERNAMES, type AllowedUsername } from '../lib/users';

const prisma = new PrismaClient();

function readUsername(): AllowedUsername {
  const username = process.env.ADMIN_USERNAME?.trim();

  if (!username || !ALLOWED_USERNAMES.includes(username as AllowedUsername)) {
    throw new Error(`ADMIN_USERNAME must be one of: ${ALLOWED_USERNAMES.join(', ')}`);
  }

  return username as AllowedUsername;
}

function readPassword() {
  const password = process.env.ADMIN_NEW_PASSWORD || '';

  if (password.length < 12) {
    throw new Error('ADMIN_NEW_PASSWORD must be at least 12 characters.');
  }

  return password;
}

async function main() {
  const username = readUsername();
  const password = readPassword();

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, isActive: true },
  });

  if (!user) throw new Error(`User ${username} was not found.`);
  if (!user.isActive) throw new Error(`User ${username} is inactive; password hash was not changed.`);

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  console.log(`Password hash updated for ${user.username}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Failed to reset password hash.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
