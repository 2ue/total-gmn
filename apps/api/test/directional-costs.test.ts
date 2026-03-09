import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { computeProfitSummaryNumbers, ProfitRecord } from "../src/lib/profit-report.js";
import { previewSettlement } from "../src/lib/settlement.js";

function buildRecord(partial: Partial<ProfitRecord>): ProfitRecord {
  return {
    id: "r1",
    transactionTime: new Date("2026-03-04T00:00:00.000Z"),
    billAccount: "a@test.com",
    description: "test",
    direction: "expense",
    amount: 10,
    status: "交易成功",
    category: "platform_commission",
    orderId: "o1",
    internalTransfer: false,
    ...partial
  };
}

describe("directional cost handling", () => {
  it("nets platform commission refunds by direction in profit summary", () => {
    const summary = computeProfitSummaryNumbers([
      buildRecord({
        id: "income-main",
        category: "main_business",
        direction: "income",
        amount: 100
      }),
      buildRecord({
        id: "fee-expense",
        category: "platform_commission",
        direction: "expense",
        amount: 10
      }),
      buildRecord({
        id: "fee-refund",
        category: "platform_commission",
        direction: "income",
        amount: 2
      })
    ]);

    expect(summary.platformCommission).toBe(8);
    expect(summary.pureProfitSettled).toBe(92);
  });

  it("nets platform commission refunds in settlement preview", async () => {
    const rows = [
      {
        id: "income-main",
        transactionTime: new Date("2026-03-04T00:00:00.000Z"),
        billAccount: "a@test.com",
        description: "订单9106523",
        direction: "income",
        amount: new Prisma.Decimal("100.00"),
        status: "交易成功",
        category: "main_business",
        orderId: "o-main",
        internalTransfer: false
      },
      {
        id: "fee-expense",
        transactionTime: new Date("2026-03-04T00:01:00.000Z"),
        billAccount: "a@test.com",
        description: "服务费",
        direction: "expense",
        amount: new Prisma.Decimal("10.00"),
        status: "交易成功",
        category: "platform_commission",
        orderId: "o-fee",
        internalTransfer: false
      },
      {
        id: "fee-refund",
        transactionTime: new Date("2026-03-04T00:02:00.000Z"),
        billAccount: "a@test.com",
        description: "服务费退回",
        direction: "income",
        amount: new Prisma.Decimal("2.00"),
        status: "退费成功",
        category: "platform_commission",
        orderId: "o-fee-refund",
        internalTransfer: false
      }
    ];

    const mockClient = {
      qualifiedTransaction: {
        findMany: async () => rows
      },
      settlementBatch: {
        findFirst: async () => null
      },
      profitParticipant: {
        findMany: async () => [
          {
            id: "p-a",
            name: "A",
            billAccount: null,
            ratio: new Prisma.Decimal("1"),
            note: ""
          }
        ]
      },
      settlementAllocation: {
        findMany: async () => []
      }
    } as any;

    const preview = await previewSettlement(
      new Date("2026-03-04T23:59:59.000Z"),
      "cumulative",
      "",
      0,
      mockClient
    );

    expect(preview.cumulativeNetAmount).toBe(92);
    expect(preview.distributableAmount).toBe(92);
    expect(preview.paidAmount).toBe(92);
  });
});
