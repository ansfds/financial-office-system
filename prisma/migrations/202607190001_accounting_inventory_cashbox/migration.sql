ALTER TYPE "SheinCardStatus" ADD VALUE IF NOT EXISTS 'INVALID';
ALTER TYPE "ReceivedCardStatus" ADD VALUE IF NOT EXISTS 'IN_SETTLEMENT';
ALTER TYPE "ReceivedCardStatus" ADD VALUE IF NOT EXISTS 'SETTLED';

ALTER TABLE "CashboxMovement"
  ADD COLUMN IF NOT EXISTS "personId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "note" TEXT,
  ADD COLUMN IF NOT EXISTS "reversedMovementId" TEXT;

ALTER TABLE "SheinCard"
  ADD COLUMN IF NOT EXISTS "cardCodeEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "pinEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "saleCurrencyId" TEXT,
  ADD COLUMN IF NOT EXISTS "saleCashboxMovementId" TEXT;

ALTER TABLE "ReceivedCustomerCard"
  ADD COLUMN IF NOT EXISTS "valueUsd" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "settlementCurrencyId" TEXT,
  ADD COLUMN IF NOT EXISTS "settlementAmount" DECIMAL(20, 6),
  ADD COLUMN IF NOT EXISTS "receivedCashboxMovementId" TEXT,
  ADD COLUMN IF NOT EXISTS "settlementCashboxMovementId" TEXT;

CREATE TABLE IF NOT EXISTS "CurrencyConversion" (
  "id" TEXT NOT NULL,
  "fromCurrencyId" TEXT NOT NULL,
  "toCurrencyId" TEXT NOT NULL,
  "fromAmount" DECIMAL(20, 6) NOT NULL,
  "toAmount" DECIMAL(20, 6) NOT NULL,
  "exchangeRate" DECIMAL(20, 8) NOT NULL,
  "operatorName" TEXT NOT NULL,
  "notes" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fromMovementId" TEXT,
  "toMovementId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CurrencyConversion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CashboxMovement_personId_idx" ON "CashboxMovement"("personId");
CREATE INDEX IF NOT EXISTS "CashboxMovement_sourceType_sourceId_idx" ON "CashboxMovement"("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "SheinCard_saleCurrencyId_idx" ON "SheinCard"("saleCurrencyId");
CREATE INDEX IF NOT EXISTS "ReceivedCustomerCard_settlementCurrencyId_idx" ON "ReceivedCustomerCard"("settlementCurrencyId");
CREATE INDEX IF NOT EXISTS "CurrencyConversion_occurredAt_idx" ON "CurrencyConversion"("occurredAt");
CREATE INDEX IF NOT EXISTS "CurrencyConversion_fromCurrencyId_idx" ON "CurrencyConversion"("fromCurrencyId");
CREATE INDEX IF NOT EXISTS "CurrencyConversion_toCurrencyId_idx" ON "CurrencyConversion"("toCurrencyId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CashboxMovement_personId_fkey'
  ) THEN
    ALTER TABLE "CashboxMovement"
      ADD CONSTRAINT "CashboxMovement_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SheinCard_saleCurrencyId_fkey'
  ) THEN
    ALTER TABLE "SheinCard"
      ADD CONSTRAINT "SheinCard_saleCurrencyId_fkey"
      FOREIGN KEY ("saleCurrencyId") REFERENCES "Currency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReceivedCustomerCard_settlementCurrencyId_fkey'
  ) THEN
    ALTER TABLE "ReceivedCustomerCard"
      ADD CONSTRAINT "ReceivedCustomerCard_settlementCurrencyId_fkey"
      FOREIGN KEY ("settlementCurrencyId") REFERENCES "Currency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CurrencyConversion_fromCurrencyId_fkey'
  ) THEN
    ALTER TABLE "CurrencyConversion"
      ADD CONSTRAINT "CurrencyConversion_fromCurrencyId_fkey"
      FOREIGN KEY ("fromCurrencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CurrencyConversion_toCurrencyId_fkey'
  ) THEN
    ALTER TABLE "CurrencyConversion"
      ADD CONSTRAINT "CurrencyConversion_toCurrencyId_fkey"
      FOREIGN KEY ("toCurrencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
