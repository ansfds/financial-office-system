DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TransactionExecutionStatus') THEN
    CREATE TYPE "TransactionExecutionStatus" AS ENUM ('COMPLETED', 'PENDING', 'NOT_EXECUTED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotExecutedAction') THEN
    CREATE TYPE "NotExecutedAction" AS ENUM ('REFUND', 'CONVERT_TO_WALLET', 'KEEP_WITH_NOTE');
  END IF;
END $$;

ALTER TYPE "SheinCardStatus" ADD VALUE IF NOT EXISTS 'USED';

ALTER TABLE "FinancialTransaction"
  ADD COLUMN IF NOT EXISTS "executionStatus" "TransactionExecutionStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS "executionNote" TEXT,
  ADD COLUMN IF NOT EXISTS "notExecutedAction" "NotExecutedAction";

ALTER TABLE "SheinCard"
  ADD COLUMN IF NOT EXISTS "linkedTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "linkedExecutionItemId" TEXT,
  ADD COLUMN IF NOT EXISTS "usedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "usedByUserId" TEXT;

CREATE TABLE IF NOT EXISTS "TransactionExecutionItem" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "customerId" TEXT,
  "itemNumber" TEXT NOT NULL,
  "status" "TransactionExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "sheinCardId" TEXT,
  "executedAt" TIMESTAMP(3),
  "executedByUserId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransactionExecutionItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FinancialTransaction_executionStatus_idx" ON "FinancialTransaction"("executionStatus");
CREATE UNIQUE INDEX IF NOT EXISTS "SheinCard_linkedExecutionItemId_key" ON "SheinCard"("linkedExecutionItemId");
CREATE INDEX IF NOT EXISTS "SheinCard_linkedTransactionId_idx" ON "SheinCard"("linkedTransactionId");
CREATE INDEX IF NOT EXISTS "SheinCard_usedByUserId_idx" ON "SheinCard"("usedByUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "TransactionExecutionItem_transactionId_itemNumber_key" ON "TransactionExecutionItem"("transactionId", "itemNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "TransactionExecutionItem_sheinCardId_key" ON "TransactionExecutionItem"("sheinCardId");
CREATE INDEX IF NOT EXISTS "TransactionExecutionItem_transactionId_idx" ON "TransactionExecutionItem"("transactionId");
CREATE INDEX IF NOT EXISTS "TransactionExecutionItem_customerId_idx" ON "TransactionExecutionItem"("customerId");
CREATE INDEX IF NOT EXISTS "TransactionExecutionItem_status_idx" ON "TransactionExecutionItem"("status");
CREATE INDEX IF NOT EXISTS "TransactionExecutionItem_executedByUserId_idx" ON "TransactionExecutionItem"("executedByUserId");
CREATE INDEX IF NOT EXISTS "TransactionExecutionItem_createdAt_idx" ON "TransactionExecutionItem"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TransactionExecutionItem_transactionId_fkey'
  ) THEN
    ALTER TABLE "TransactionExecutionItem"
      ADD CONSTRAINT "TransactionExecutionItem_transactionId_fkey"
      FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TransactionExecutionItem_customerId_fkey'
  ) THEN
    ALTER TABLE "TransactionExecutionItem"
      ADD CONSTRAINT "TransactionExecutionItem_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TransactionExecutionItem_sheinCardId_fkey'
  ) THEN
    ALTER TABLE "TransactionExecutionItem"
      ADD CONSTRAINT "TransactionExecutionItem_sheinCardId_fkey"
      FOREIGN KEY ("sheinCardId") REFERENCES "SheinCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TransactionExecutionItem_executedByUserId_fkey'
  ) THEN
    ALTER TABLE "TransactionExecutionItem"
      ADD CONSTRAINT "TransactionExecutionItem_executedByUserId_fkey"
      FOREIGN KEY ("executedByUserId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
