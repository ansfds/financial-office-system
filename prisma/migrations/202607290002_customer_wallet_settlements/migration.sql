DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomerWalletAccountType') THEN
    CREATE TYPE "CustomerWalletAccountType" AS ENUM ('CREDIT', 'DEBT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomerWalletSettlementDirection') THEN
    CREATE TYPE "CustomerWalletSettlementDirection" AS ENUM ('ADD', 'SUBTRACT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CustomerWalletSettlement" (
  "id" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "currencyId" TEXT NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "accountType" "CustomerWalletAccountType" NOT NULL,
  "direction" "CustomerWalletSettlementDirection" NOT NULL,
  "amount" DECIMAL(20, 6) NOT NULL,
  "balanceBefore" DECIMAL(20, 6) NOT NULL,
  "balanceAfter" DECIMAL(20, 6) NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "userId" TEXT,
  "username" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerWalletSettlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomerWalletSettlement_personId_idx" ON "CustomerWalletSettlement"("personId");
CREATE INDEX IF NOT EXISTS "CustomerWalletSettlement_currencyId_idx" ON "CustomerWalletSettlement"("currencyId");
CREATE INDEX IF NOT EXISTS "CustomerWalletSettlement_paymentMethod_idx" ON "CustomerWalletSettlement"("paymentMethod");
CREATE INDEX IF NOT EXISTS "CustomerWalletSettlement_accountType_idx" ON "CustomerWalletSettlement"("accountType");
CREATE INDEX IF NOT EXISTS "CustomerWalletSettlement_occurredAt_idx" ON "CustomerWalletSettlement"("occurredAt");
CREATE INDEX IF NOT EXISTS "CustomerWalletSettlement_createdAt_idx" ON "CustomerWalletSettlement"("createdAt");
CREATE INDEX IF NOT EXISTS "CustomerWalletSettlement_userId_idx" ON "CustomerWalletSettlement"("userId");
CREATE INDEX IF NOT EXISTS "CustomerWalletSettlement_username_idx" ON "CustomerWalletSettlement"("username");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerWalletSettlement_personId_fkey'
  ) THEN
    ALTER TABLE "CustomerWalletSettlement"
      ADD CONSTRAINT "CustomerWalletSettlement_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerWalletSettlement_currencyId_fkey'
  ) THEN
    ALTER TABLE "CustomerWalletSettlement"
      ADD CONSTRAINT "CustomerWalletSettlement_currencyId_fkey"
      FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerWalletSettlement_userId_fkey'
  ) THEN
    ALTER TABLE "CustomerWalletSettlement"
      ADD CONSTRAINT "CustomerWalletSettlement_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
