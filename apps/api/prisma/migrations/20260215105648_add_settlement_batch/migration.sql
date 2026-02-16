-- CreateTable
CREATE TABLE "SettlementBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchNo" TEXT NOT NULL,
    "settlementTime" DATETIME NOT NULL,
    "cumulativeNetAmount" DECIMAL NOT NULL,
    "settledBaseAmount" DECIMAL NOT NULL,
    "distributableAmount" DECIMAL NOT NULL,
    "paidAmount" DECIMAL NOT NULL,
    "carryForwardAmount" DECIMAL NOT NULL,
    "cumulativeSettledAmount" DECIMAL NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "isEffective" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "SettlementBatch_batchNo_key" ON "SettlementBatch"("batchNo");

-- CreateIndex
CREATE INDEX "SettlementBatch_settlementTime_idx" ON "SettlementBatch"("settlementTime");

-- CreateIndex
CREATE INDEX "SettlementBatch_isEffective_idx" ON "SettlementBatch"("isEffective");
