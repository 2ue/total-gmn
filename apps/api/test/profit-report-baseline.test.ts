import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyAndFilterTransactions } from "@total-gmn/shared";
import { parseStatementFile } from "../src/lib/parser.js";
import { computeProfitSummaryNumbers, ProfitRecord } from "../src/lib/profit-report.js";

describe("profit summary baseline", () => {
  it("matches confirmed baseline values for reference statements", async () => {
    const files = [
      "支付宝交易明细(20251115-20260215).csv",
      "支付宝交易明细(20251115-20260215)-wx.csv"
    ];

    const records: ProfitRecord[] = [];

    for (const fileName of files) {
      const absolutePath = resolveFixturePath(fileName);
      const content = await readFile(absolutePath);
      const parsed = parseStatementFile(path.basename(absolutePath), content);
      const qualified = classifyAndFilterTransactions(parsed.transactions);

      for (const tx of qualified) {
        records.push({
          id: `${fileName}:${tx.orderId}:${tx.transactionTime.toISOString()}`,
          transactionTime: tx.transactionTime,
          billAccount: tx.billAccount,
          description: tx.description,
          direction: tx.direction,
          amount: {
            toString: () => tx.amount
          },
          status: tx.status,
          category: tx.category,
          orderId: tx.orderId,
          internalTransfer: tx.internalTransfer
        });
      }
    }

    const summary = computeProfitSummaryNumbers(records);

    expect(summary.mainSettledIncome).toBe(40628.6);
    expect(summary.mainPendingIncome).toBe(44270.4);
    expect(summary.mainExpense).toBe(545.2);
    expect(summary.trafficCost).toBe(8426.42);
    expect(summary.platformCommission).toBe(393.23);
    expect(summary.mainClosedAmount).toBe(5687.6);
    expect(summary.pureProfitSettled).toBe(32580.05);
    expect(summary.pureProfitWithPending).toBe(76850.45);
  });
});

function resolveFixturePath(fileName: string): string {
  const candidates = [
    path.resolve(process.cwd(), "../../data", fileName),
    path.resolve(process.cwd(), "../../", fileName)
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) {
    return found;
  }
  throw new Error(`Missing baseline fixture: ${fileName}`);
}
