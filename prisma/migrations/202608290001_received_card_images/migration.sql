ALTER TABLE "ReceivedCustomerCard"
  ADD COLUMN "cardImageDataUrl" TEXT,
  ADD COLUMN "cardThumbnailDataUrl" TEXT,
  ADD COLUMN "cardImageMimeType" TEXT,
  ADD COLUMN "cardImageSize" INTEGER,
  ADD COLUMN "cardImageUpdatedAt" TIMESTAMP(3);
