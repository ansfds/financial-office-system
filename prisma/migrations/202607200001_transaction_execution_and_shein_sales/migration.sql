CREATE TYPE "SheinPaymentMethod" AS ENUM ('LYD_CASH', 'USD_CASH', 'LYD_TRANSFER', 'USD_TRANSFER', 'CARD');

ALTER TABLE "FinancialTransaction"
ADD COLUMN "executionType" TEXT,
ADD COLUMN "sheinPaymentMethod" "SheinPaymentMethod";

ALTER TABLE "SheinCard"
ADD COLUMN "salePaymentMethod" "SheinPaymentMethod";

CREATE TABLE "SheinCardSale" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT,
    "personId" TEXT,
    "currencyId" TEXT NOT NULL,
    "paymentMethod" "SheinPaymentMethod" NOT NULL,
    "denomination" DECIMAL(20,6) NOT NULL,
    "cardCount" INTEGER NOT NULL,
    "pricePerCard" DECIMAL(20,6) NOT NULL,
    "totalAmount" DECIMAL(20,6) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheinCardSale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SheinCardSaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheinCardSaleItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SheinCardSale_transactionId_key" ON "SheinCardSale"("transactionId");
CREATE INDEX "SheinCardSale_occurredAt_idx" ON "SheinCardSale"("occurredAt");
CREATE INDEX "SheinCardSale_paymentMethod_idx" ON "SheinCardSale"("paymentMethod");
CREATE INDEX "SheinCardSale_denomination_idx" ON "SheinCardSale"("denomination");
CREATE INDEX "SheinCardSale_personId_idx" ON "SheinCardSale"("personId");
CREATE INDEX "SheinCardSale_currencyId_idx" ON "SheinCardSale"("currencyId");
CREATE UNIQUE INDEX "SheinCardSaleItem_cardId_key" ON "SheinCardSaleItem"("cardId");
CREATE INDEX "SheinCardSaleItem_saleId_idx" ON "SheinCardSaleItem"("saleId");

ALTER TABLE "SheinCardSale"
ADD CONSTRAINT "SheinCardSale_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "SheinCardSale_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "SheinCardSale_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SheinCardSaleItem"
ADD CONSTRAINT "SheinCardSaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "SheinCardSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "SheinCardSaleItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "SheinCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
