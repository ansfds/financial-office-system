ALTER TABLE "FinancialTransaction"
  ADD COLUMN IF NOT EXISTS "operationKind" TEXT,
  ADD COLUMN IF NOT EXISTS "operationDetails" JSONB;

CREATE INDEX IF NOT EXISTS "FinancialTransaction_operationKind_idx" ON "FinancialTransaction"("operationKind");
