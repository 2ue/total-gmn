-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "billAccount" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawMetaJson" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "QualifiedTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "transactionTime" DATETIME NOT NULL,
    "orderId" TEXT NOT NULL,
    "merchantOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "internalTransfer" BOOLEAN NOT NULL DEFAULT false,
    "billAccount" TEXT NOT NULL,
    "remark" TEXT NOT NULL,
    "rawRowJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QualifiedTransaction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "QualifiedTransaction_transactionTime_idx" ON "QualifiedTransaction"("transactionTime");

-- CreateIndex
CREATE INDEX "QualifiedTransaction_orderId_idx" ON "QualifiedTransaction"("orderId");

-- CreateIndex
CREATE INDEX "QualifiedTransaction_category_idx" ON "QualifiedTransaction"("category");

-- CreateIndex
CREATE INDEX "QualifiedTransaction_status_idx" ON "QualifiedTransaction"("status");
