-- Preserve withdrawals made before the operations ledger existed.
-- The timestamp is the known last update, explicitly labelled as a legacy opening balance.
INSERT INTO "ReceivedCardOperation"
  ("id", "cardId", "operationType", "quantity", "amount", "balanceBefore", "balanceAfter",
   "progressBefore", "progressAfter", "note", "occurredAt", "createdAt", "updatedAt")
SELECT 'legacy-withdrawal-' || c."id", c."id", 'ADJUSTMENT', 1,
  GREATEST(c."receivedAmount", c."totalDeducted", 0) - COALESCE(o.total, 0),
  c."valueUsd", GREATEST(c."valueUsd" - (GREATEST(c."receivedAmount", c."totalDeducted", 0) - COALESCE(o.total, 0)), 0),
  0, 0, 'رصيد سحبات سابق — التاريخ هو آخر تعديل مسجل، وليس تاريخ السحب الأصلي',
  c."updatedAt", c."createdAt", c."updatedAt"
FROM "ReceivedCustomerCard" c
LEFT JOIN (
  SELECT "cardId", SUM("amount") AS total FROM "ReceivedCardOperation"
  WHERE "deletedAt" IS NULL AND "operationType" IN ('GIFT_CARD', 'INVOICE', 'FINAL_SETTLEMENT', 'ADJUSTMENT')
  GROUP BY "cardId"
) o ON o."cardId" = c."id"
WHERE GREATEST(c."receivedAmount", c."totalDeducted", 0) > COALESCE(o.total, 0)
ON CONFLICT ("id") DO NOTHING;
