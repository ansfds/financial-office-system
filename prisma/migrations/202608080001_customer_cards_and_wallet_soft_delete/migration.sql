ALTER TABLE "CustomerWalletSettlement"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedBy" TEXT,
ADD COLUMN "deleteReason" TEXT;

ALTER TABLE "ReceivedCustomerCard"
ADD COLUMN "publicCode" TEXT,
ADD COLUMN "currentStage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ReceivedCustomerCard_publicCode_key" ON "ReceivedCustomerCard"("publicCode");
CREATE INDEX "CustomerWalletSettlement_deletedAt_idx" ON "CustomerWalletSettlement"("deletedAt");
CREATE INDEX "ReceivedCustomerCard_publicCode_idx" ON "ReceivedCustomerCard"("publicCode");
CREATE INDEX "ReceivedCustomerCard_currentStage_idx" ON "ReceivedCustomerCard"("currentStage");
CREATE INDEX "ReceivedCustomerCard_deletedAt_idx" ON "ReceivedCustomerCard"("deletedAt");

CREATE TABLE "ReceivedCardStageLog" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "stage" INTEGER NOT NULL,
  "direction" TEXT NOT NULL,
  "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "note" TEXT,
  "userId" TEXT,
  "username" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReceivedCardStageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReceivedCardStageLog_cardId_idx" ON "ReceivedCardStageLog"("cardId");
CREATE INDEX "ReceivedCardStageLog_stage_idx" ON "ReceivedCardStageLog"("stage");
CREATE INDEX "ReceivedCardStageLog_createdAt_idx" ON "ReceivedCardStageLog"("createdAt");

ALTER TABLE "ReceivedCardStageLog"
ADD CONSTRAINT "ReceivedCardStageLog_cardId_fkey"
FOREIGN KEY ("cardId") REFERENCES "ReceivedCustomerCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
