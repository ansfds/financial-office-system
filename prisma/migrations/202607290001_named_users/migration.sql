CREATE TABLE IF NOT EXISTS "Users" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Users_username_key" ON "Users"("username");
CREATE INDEX IF NOT EXISTS "Users_isActive_idx" ON "Users"("isActive");

ALTER TABLE "LoginSession"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "username" TEXT;

ALTER TABLE "LoginAttempt"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "username" TEXT;

ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "username" TEXT;

CREATE INDEX IF NOT EXISTS "LoginSession_userId_idx" ON "LoginSession"("userId");
CREATE INDEX IF NOT EXISTS "LoginSession_username_idx" ON "LoginSession"("username");
CREATE INDEX IF NOT EXISTS "LoginAttempt_userId_idx" ON "LoginAttempt"("userId");
CREATE INDEX IF NOT EXISTS "LoginAttempt_username_idx" ON "LoginAttempt"("username");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX IF NOT EXISTS "AuditLog_username_idx" ON "AuditLog"("username");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LoginSession_userId_fkey'
  ) THEN
    ALTER TABLE "LoginSession"
      ADD CONSTRAINT "LoginSession_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LoginAttempt_userId_fkey'
  ) THEN
    ALTER TABLE "LoginAttempt"
      ADD CONSTRAINT "LoginAttempt_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_userId_fkey'
  ) THEN
    ALTER TABLE "AuditLog"
      ADD CONSTRAINT "AuditLog_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
