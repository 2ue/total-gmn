/*
  Warnings:

  - Added the required column `dedupeKey` to the `QualifiedTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QualifiedTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
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
INSERT INTO "new_QualifiedTransaction" ("amount", "batchId", "billAccount", "category", "createdAt", "description", "direction", "id", "internalTransfer", "merchantOrderId", "orderId", "rawRowJson", "remark", "status", "transactionTime") SELECT "amount", "batchId", "billAccount", "category", "createdAt", "description", "direction", "id", "internalTransfer", "merchantOrderId", "orderId", "rawRowJson", "remark", "status", "transactionTime" FROM "QualifiedTransaction";
DROP TABLE "QualifiedTransaction";
ALTER TABLE "new_QualifiedTransaction" RENAME TO "QualifiedTransaction";
CREATE UNIQUE INDEX "QualifiedTransaction_dedupeKey_key" ON "QualifiedTransaction"("dedupeKey");
CREATE INDEX "QualifiedTransaction_transactionTime_idx" ON "QualifiedTransaction"("transactionTime");
CREATE INDEX "QualifiedTransaction_orderId_idx" ON "QualifiedTransaction"("orderId");
CREATE INDEX "QualifiedTransaction_category_idx" ON "QualifiedTransaction"("category");
CREATE INDEX "QualifiedTransaction_status_idx" ON "QualifiedTransaction"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
