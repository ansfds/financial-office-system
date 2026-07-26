ALTER TYPE "SheinPaymentMethod" ADD VALUE IF NOT EXISTS 'LYD_OFFICE_TRANSFER';
ALTER TYPE "SheinPaymentMethod" ADD VALUE IF NOT EXISTS 'LYD_CARD';
ALTER TYPE "SheinPaymentMethod" ADD VALUE IF NOT EXISTS 'USD_CARD';

ALTER TABLE "CashboxMovement"
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;

CREATE INDEX IF NOT EXISTS "CashboxMovement_paymentMethod_idx"
  ON "CashboxMovement"("paymentMethod");
