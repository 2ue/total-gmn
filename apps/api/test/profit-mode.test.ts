import { afterEach, describe, expect, it } from "vitest";
import { computeProfitSummaryNumbers, ProfitRecord } from "../src/lib/profit-report.js";
import { getClosedProfitModeEnvKey } from "../src/lib/profit-mode.js";

const envKey = getClosedProfitModeEnvKey();
const originalEnvValue = process.env[envKey];

function buildRecord(partial: Partial<ProfitRecord>): ProfitRecord {
  return {
    id: "r1",
    transactionTime: new Date("2026-01-01T00:00:00.000Z"),
    billAccount: "a@test.com",
    description: "test",
    direction: "income",
    amount: 10,
    status: "交易成功",
    category: "main_business",
    orderId: "o1",
    internalTransfer: false,
    ...partial
  };
}

afterEach(() => {
  if (originalEnvValue === undefined) {
    delete process.env[envKey];
  } else {
    process.env[envKey] = originalEnvValue;
  }
});

describe("profit closed-mode toggle", () => {
  it("includes closed direction in pure profit by default", () => {
    delete process.env[envKey];

    const summary = computeProfitSummaryNumbers([
      buildRecord({
        id: "closed-income",
        category: "closed",
        direction: "income",
        status: "交易关闭",
        amount: 100
      })
    ]);

    expect(summary.mainClosedAmount).toBe(100);
    expect(summary.pureProfitSettled).toBe(100);
    expect(summary.pureProfitWithPending).toBe(100);
  });

  it("can disable closed-direction contribution via env", () => {
    process.env[envKey] = "false";

    const summary = computeProfitSummaryNumbers([
      buildRecord({
        id: "closed-income",
        category: "closed",
        direction: "income",
        status: "交易关闭",
        amount: 100
      })
    ]);

    expect(summary.mainClosedAmount).toBe(100);
    expect(summary.pureProfitSettled).toBe(0);
    expect(summary.pureProfitWithPending).toBe(0);
  });
});
