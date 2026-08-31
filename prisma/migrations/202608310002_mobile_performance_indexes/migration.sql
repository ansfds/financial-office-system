CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Person_status_deleted_customerNo_idx"
  ON "Person" ("status", "deletedAt", "customerNo");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Person_status_deleted_created_idx"
  ON "Person" ("status", "deletedAt", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Person_fullName_trgm_idx"
  ON "Person" USING gin ("fullName" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Person_phone_trgm_idx"
  ON "Person" USING gin ("phone" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Person_customerNo_trgm_idx"
  ON "Person" USING gin ("customerNo" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Person_externalId_trgm_idx"
  ON "Person" USING gin ("externalId" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "FT_person_deleted_txAt_idx"
  ON "FinancialTransaction" ("personId", "deletedAt", "transactionAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "FT_deleted_status_txAt_idx"
  ON "FinancialTransaction" ("deletedAt", "status", "transactionAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "FT_deleted_kind_txAt_idx"
  ON "FinancialTransaction" ("deletedAt", "operationKind", "transactionAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CWS_person_deleted_occ_idx"
  ON "CustomerWalletSettlement" ("personId", "deletedAt", "occurredAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CWS_person_currency_method_type_deleted_occ_idx"
  ON "CustomerWalletSettlement" ("personId", "currencyId", "paymentMethod", "accountType", "deletedAt", "occurredAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RCB_person_receivedAt_idx"
  ON "ReceivedCardBatch" ("personId", "receivedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RCC_batch_deleted_sequence_idx"
  ON "ReceivedCustomerCard" ("batchId", "deletedAt", "sequence");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RCC_status_deleted_updated_idx"
  ON "ReceivedCustomerCard" ("status", "deletedAt", "updatedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RCC_settlementCurrency_deleted_status_idx"
  ON "ReceivedCustomerCard" ("settlementCurrencyId", "deletedAt", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RCSL_card_created_idx"
  ON "ReceivedCardStageLog" ("cardId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RCO_card_deleted_occurred_idx"
  ON "ReceivedCardOperation" ("cardId", "deletedAt", "occurredAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RCO_type_deleted_occurred_idx"
  ON "ReceivedCardOperation" ("operationType", "deletedAt", "occurredAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CCD_person_currency_deleted_occurred_idx"
  ON "CustomerCardDelivery" ("personId", "currencyId", "deletedAt", "occurredAt");
