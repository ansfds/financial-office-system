-- Fast card-entry transactions, card operations, customer deliveries, and account repayments.
-- This migration only adds structures and derived balance fields; it does not delete or overwrite source records.

CREATE TYPE "CustomerCardOperationType" AS ENUM ('GIFT_CARD', 'INVOICE', 'FINAL_SETTLEMENT', 'REJECT', 'REACTIVATE', 'ADJUSTMENT');
CREATE TYPE "CustomerCardEntryStatus" AS ENUM ('COMPLETED', 'CANCELLED');

ALTER TABLE "CustomerWalletSettlement"
  ADD COLUMN "movementKind" TEXT NOT NULL DEFAULT 'ADJUSTMENT',
  ADD COLUMN "linkedSettlementId" TEXT,
  ADD COLUMN "settlementMethod" TEXT;

ALTER TABLE "ReceivedCardBatch"
  ADD COLUMN "entryTransactionId" TEXT,
  ADD COLUMN "totalOriginalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN "totalAgreedAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "createdByUsername" TEXT;

ALTER TABLE "ReceivedCustomerCard"
  ADD COLUMN "totalDeducted" DECIMAL(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN "remainingAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN "progressPercent" DECIMAL(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "rejectReason" TEXT;

WITH card_amounts AS (
  SELECT
    "id",
    CASE WHEN "valueUsd" > 0 THEN "valueUsd" ELSE "agreedAmount" END AS "baseAmount",
    "receivedAmount"
  FROM "ReceivedCustomerCard"
)
UPDATE "ReceivedCustomerCard" AS c
SET
  "totalDeducted" = card_amounts."receivedAmount",
  "remainingAmount" = GREATEST(card_amounts."baseAmount" - card_amounts."receivedAmount", 0::numeric),
  "progressPercent" = CASE
    WHEN card_amounts."baseAmount" > 0
      THEN LEAST(GREATEST((card_amounts."receivedAmount" / card_amounts."baseAmount") * 100, 0::numeric), 100::numeric)
    ELSE 0
  END
FROM card_amounts
WHERE c."id" = card_amounts."id";

UPDATE "ReceivedCustomerCard"
SET "rejectedAt" = "updatedAt"
WHERE "status" = 'CANCELLED' AND "rejectedAt" IS NULL;

WITH batch_amounts AS (
  SELECT
    "batchId",
    COUNT(*)::integer AS "cardCount",
    COALESCE(SUM(CASE WHEN "valueUsd" > 0 THEN "valueUsd" ELSE "agreedAmount" END), 0) AS "totalOriginalAmount",
    COALESCE(SUM("agreedAmount"), 0) AS "totalAgreedAmount"
  FROM "ReceivedCustomerCard"
  WHERE "deletedAt" IS NULL
  GROUP BY "batchId"
)
UPDATE "ReceivedCardBatch" AS b
SET
  "cardCount" = batch_amounts."cardCount",
  "totalOriginalAmount" = batch_amounts."totalOriginalAmount",
  "totalAgreedAmount" = batch_amounts."totalAgreedAmount"
FROM batch_amounts
WHERE b."id" = batch_amounts."batchId";

CREATE TABLE "CustomerCardEntryTransaction" (
  "id" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "currencyId" TEXT,
  "status" "CustomerCardEntryStatus" NOT NULL DEFAULT 'COMPLETED',
  "cardCount" INTEGER NOT NULL,
  "totalOriginalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "totalAgreedAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "duplicateWarnings" JSONB,
  "notes" TEXT,
  "userId" TEXT,
  "username" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerCardEntryTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CardDiscountCategory" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "faceValue" DECIMAL(20,6) NOT NULL,
  "deductionAmount" DECIMAL(20,6) NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CardDiscountCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceivedCardOperation" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "operationType" "CustomerCardOperationType" NOT NULL,
  "categoryCode" TEXT,
  "categoryFaceValue" DECIMAL(20,6),
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "balanceBefore" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "balanceAfter" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "progressBefore" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "progressAfter" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "note" TEXT,
  "reason" TEXT,
  "userId" TEXT,
  "username" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "deleteReason" TEXT,

  CONSTRAINT "ReceivedCardOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerCardDelivery" (
  "id" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "currencyId" TEXT NOT NULL,
  "paymentMethod" TEXT,
  "amount" DECIMAL(20,6) NOT NULL,
  "balanceBefore" DECIMAL(20,6) NOT NULL,
  "balanceAfter" DECIMAL(20,6) NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'CUSTOMER_CARD_DELIVERY',
  "note" TEXT,
  "userId" TEXT,
  "username" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "deleteReason" TEXT,

  CONSTRAINT "CustomerCardDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerAccountRepayment" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "currencyId" TEXT NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "accountType" "CustomerWalletAccountType" NOT NULL,
  "amount" DECIMAL(20,6) NOT NULL,
  "balanceBefore" DECIMAL(20,6) NOT NULL,
  "balanceAfter" DECIMAL(20,6) NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "userId" TEXT,
  "username" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "deleteReason" TEXT,

  CONSTRAINT "CustomerAccountRepayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CardDiscountCategory_code_key" ON "CardDiscountCategory"("code");

INSERT INTO "CardDiscountCategory" ("id", "code", "name", "faceValue", "deductionAmount", "isDefault", "isActive", "updatedAt")
VALUES
  ('cardcat_100', '100', 'كرت 100', 100, 101, true, true, CURRENT_TIMESTAMP),
  ('cardcat_300', '300', 'كرت 300', 300, 292, true, true, CURRENT_TIMESTAMP),
  ('cardcat_500', '500', 'كرت 500', 500, 476, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

CREATE UNIQUE INDEX "ReceivedCardBatch_entryTransactionId_key" ON "ReceivedCardBatch"("entryTransactionId");
CREATE INDEX "ReceivedCardBatch_entryTransactionId_idx" ON "ReceivedCardBatch"("entryTransactionId");
CREATE INDEX "CustomerWalletSettlement_movementKind_idx" ON "CustomerWalletSettlement"("movementKind");
CREATE INDEX "CustomerWalletSettlement_linkedSettlementId_idx" ON "CustomerWalletSettlement"("linkedSettlementId");
CREATE INDEX "ReceivedCustomerCard_remainingAmount_idx" ON "ReceivedCustomerCard"("remainingAmount");
CREATE INDEX "ReceivedCustomerCard_rejectedAt_idx" ON "ReceivedCustomerCard"("rejectedAt");

CREATE INDEX "CustomerCardEntryTransaction_personId_idx" ON "CustomerCardEntryTransaction"("personId");
CREATE INDEX "CustomerCardEntryTransaction_currencyId_idx" ON "CustomerCardEntryTransaction"("currencyId");
CREATE INDEX "CustomerCardEntryTransaction_status_idx" ON "CustomerCardEntryTransaction"("status");
CREATE INDEX "CustomerCardEntryTransaction_occurredAt_idx" ON "CustomerCardEntryTransaction"("occurredAt");
CREATE INDEX "CustomerCardEntryTransaction_createdAt_idx" ON "CustomerCardEntryTransaction"("createdAt");
CREATE INDEX "CustomerCardEntryTransaction_userId_idx" ON "CustomerCardEntryTransaction"("userId");
CREATE INDEX "CustomerCardEntryTransaction_username_idx" ON "CustomerCardEntryTransaction"("username");

CREATE INDEX "CardDiscountCategory_isActive_idx" ON "CardDiscountCategory"("isActive");
CREATE INDEX "CardDiscountCategory_isDefault_idx" ON "CardDiscountCategory"("isDefault");
CREATE INDEX "CardDiscountCategory_createdAt_idx" ON "CardDiscountCategory"("createdAt");

CREATE INDEX "ReceivedCardOperation_cardId_idx" ON "ReceivedCardOperation"("cardId");
CREATE INDEX "ReceivedCardOperation_operationType_idx" ON "ReceivedCardOperation"("operationType");
CREATE INDEX "ReceivedCardOperation_occurredAt_idx" ON "ReceivedCardOperation"("occurredAt");
CREATE INDEX "ReceivedCardOperation_createdAt_idx" ON "ReceivedCardOperation"("createdAt");
CREATE INDEX "ReceivedCardOperation_deletedAt_idx" ON "ReceivedCardOperation"("deletedAt");
CREATE INDEX "ReceivedCardOperation_userId_idx" ON "ReceivedCardOperation"("userId");
CREATE INDEX "ReceivedCardOperation_username_idx" ON "ReceivedCardOperation"("username");

CREATE INDEX "CustomerCardDelivery_personId_idx" ON "CustomerCardDelivery"("personId");
CREATE INDEX "CustomerCardDelivery_currencyId_idx" ON "CustomerCardDelivery"("currencyId");
CREATE INDEX "CustomerCardDelivery_paymentMethod_idx" ON "CustomerCardDelivery"("paymentMethod");
CREATE INDEX "CustomerCardDelivery_occurredAt_idx" ON "CustomerCardDelivery"("occurredAt");
CREATE INDEX "CustomerCardDelivery_createdAt_idx" ON "CustomerCardDelivery"("createdAt");
CREATE INDEX "CustomerCardDelivery_deletedAt_idx" ON "CustomerCardDelivery"("deletedAt");
CREATE INDEX "CustomerCardDelivery_userId_idx" ON "CustomerCardDelivery"("userId");
CREATE INDEX "CustomerCardDelivery_username_idx" ON "CustomerCardDelivery"("username");

CREATE UNIQUE INDEX "CustomerAccountRepayment_settlementId_key" ON "CustomerAccountRepayment"("settlementId");
CREATE INDEX "CustomerAccountRepayment_personId_idx" ON "CustomerAccountRepayment"("personId");
CREATE INDEX "CustomerAccountRepayment_currencyId_idx" ON "CustomerAccountRepayment"("currencyId");
CREATE INDEX "CustomerAccountRepayment_paymentMethod_idx" ON "CustomerAccountRepayment"("paymentMethod");
CREATE INDEX "CustomerAccountRepayment_accountType_idx" ON "CustomerAccountRepayment"("accountType");
CREATE INDEX "CustomerAccountRepayment_occurredAt_idx" ON "CustomerAccountRepayment"("occurredAt");
CREATE INDEX "CustomerAccountRepayment_createdAt_idx" ON "CustomerAccountRepayment"("createdAt");
CREATE INDEX "CustomerAccountRepayment_deletedAt_idx" ON "CustomerAccountRepayment"("deletedAt");
CREATE INDEX "CustomerAccountRepayment_userId_idx" ON "CustomerAccountRepayment"("userId");
CREATE INDEX "CustomerAccountRepayment_username_idx" ON "CustomerAccountRepayment"("username");

ALTER TABLE "ReceivedCardBatch"
  ADD CONSTRAINT "ReceivedCardBatch_entryTransactionId_fkey"
  FOREIGN KEY ("entryTransactionId") REFERENCES "CustomerCardEntryTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerCardEntryTransaction"
  ADD CONSTRAINT "CustomerCardEntryTransaction_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerCardEntryTransaction"
  ADD CONSTRAINT "CustomerCardEntryTransaction_currencyId_fkey"
  FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReceivedCardOperation"
  ADD CONSTRAINT "ReceivedCardOperation_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "ReceivedCustomerCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerCardDelivery"
  ADD CONSTRAINT "CustomerCardDelivery_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerCardDelivery"
  ADD CONSTRAINT "CustomerCardDelivery_currencyId_fkey"
  FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerAccountRepayment"
  ADD CONSTRAINT "CustomerAccountRepayment_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerAccountRepayment"
  ADD CONSTRAINT "CustomerAccountRepayment_currencyId_fkey"
  FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerAccountRepayment"
  ADD CONSTRAINT "CustomerAccountRepayment_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "CustomerWalletSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
