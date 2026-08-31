UPDATE "CardDiscountCategory"
SET "deductionAmount" = 100,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = '100'
  AND "deductionAmount" <> 100;

CREATE INDEX IF NOT EXISTS "ReceivedCardOperation_dashboard_accounting_idx"
ON "ReceivedCardOperation" ("operationType", "deletedAt", "occurredAt", "categoryCode");

CREATE INDEX IF NOT EXISTS "ReceivedCustomerCard_dashboard_status_idx"
ON "ReceivedCustomerCard" ("deletedAt", "status", "updatedAt");
