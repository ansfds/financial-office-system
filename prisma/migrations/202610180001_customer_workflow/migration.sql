-- Additive migration only. Do not run against production before review and backup.
ALTER TYPE "ReceivedCardStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_FAILED';
ALTER TYPE "ReceivedCardStatus" ADD VALUE IF NOT EXISTS 'INSUFFICIENT_BALANCE';
ALTER TABLE "Person" ADD COLUMN "phoneSecondary" TEXT;
CREATE INDEX "Person_phoneSecondary_idx" ON "Person"("phoneSecondary");
CREATE TABLE "DailyNote" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DailyNote_createdAt_idx" ON "DailyNote"("createdAt");
-- Existing batches already define the only reliable historical grouping.
-- Attach a clearly named legacy entry to each unlinked batch without changing IDs or dates.
INSERT INTO "CustomerCardEntryTransaction"
  ("id", "personId", "currencyId", "status", "cardCount", "totalOriginalAmount",
   "totalAgreedAmount", "notes", "occurredAt", "createdAt", "updatedAt")
SELECT 'legacy-' || b."id", b."personId", b."currencyId", 'COMPLETED',
  b."cardCount", b."totalOriginalAmount", b."totalAgreedAmount", 'بيانات سابقة',
  b."receivedAt", b."createdAt", b."updatedAt"
FROM "ReceivedCardBatch" b WHERE b."entryTransactionId" IS NULL;
UPDATE "ReceivedCardBatch" SET "entryTransactionId" = 'legacy-' || "id"
WHERE "entryTransactionId" IS NULL;
