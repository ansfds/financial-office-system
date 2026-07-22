CREATE INDEX IF NOT EXISTS "Person_createdAt_idx" ON "Person"("createdAt");
CREATE INDEX IF NOT EXISTS "Person_status_deletedAt_idx" ON "Person"("status", "deletedAt");

CREATE INDEX IF NOT EXISTS "Currency_createdAt_idx" ON "Currency"("createdAt");
CREATE INDEX IF NOT EXISTS "Currency_isActive_idx" ON "Currency"("isActive");

CREATE INDEX IF NOT EXISTS "TransactionType_createdAt_idx" ON "TransactionType"("createdAt");

CREATE INDEX IF NOT EXISTS "FinancialTransaction_createdAt_idx" ON "FinancialTransaction"("createdAt");
CREATE INDEX IF NOT EXISTS "FinancialTransaction_personId_idx" ON "FinancialTransaction"("personId");
CREATE INDEX IF NOT EXISTS "FinancialTransaction_typeId_idx" ON "FinancialTransaction"("typeId");
CREATE INDEX IF NOT EXISTS "FinancialTransaction_currencyId_idx" ON "FinancialTransaction"("currencyId");

CREATE INDEX IF NOT EXISTS "TransactionMovement_createdAt_idx" ON "TransactionMovement"("createdAt");
CREATE INDEX IF NOT EXISTS "TransactionMovement_transactionId_idx" ON "TransactionMovement"("transactionId");
CREATE INDEX IF NOT EXISTS "TransactionMovement_currencyId_idx" ON "TransactionMovement"("currencyId");
CREATE INDEX IF NOT EXISTS "TransactionMovement_type_idx" ON "TransactionMovement"("type");

CREATE INDEX IF NOT EXISTS "CashboxMovement_createdAt_idx" ON "CashboxMovement"("createdAt");
CREATE INDEX IF NOT EXISTS "CashboxMovement_currencyId_idx" ON "CashboxMovement"("currencyId");
CREATE INDEX IF NOT EXISTS "CashboxMovement_transactionId_idx" ON "CashboxMovement"("transactionId");

CREATE INDEX IF NOT EXISTS "SheinCard_createdAt_idx" ON "SheinCard"("createdAt");
CREATE INDEX IF NOT EXISTS "SheinCardSale_createdAt_idx" ON "SheinCardSale"("createdAt");

CREATE INDEX IF NOT EXISTS "ReceivedCardBatch_createdAt_idx" ON "ReceivedCardBatch"("createdAt");
CREATE INDEX IF NOT EXISTS "ReceivedCustomerCard_createdAt_idx" ON "ReceivedCustomerCard"("createdAt");
CREATE INDEX IF NOT EXISTS "ReceivedCustomerCard_batchId_idx" ON "ReceivedCustomerCard"("batchId");

CREATE INDEX IF NOT EXISTS "CurrencyConversion_createdAt_idx" ON "CurrencyConversion"("createdAt");
