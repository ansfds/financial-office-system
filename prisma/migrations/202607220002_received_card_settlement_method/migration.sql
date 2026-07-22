ALTER TABLE "ReceivedCustomerCard"
  ADD COLUMN IF NOT EXISTS "settlementPaymentMethod" "SheinPaymentMethod";

CREATE INDEX IF NOT EXISTS "ReceivedCustomerCard_settlementPaymentMethod_idx"
  ON "ReceivedCustomerCard"("settlementPaymentMethod");
