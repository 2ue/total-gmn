import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { previewSettlement } from "../src/lib/settlement.js";

function buildQualifiedRow(partial: {
  billAccount: string;
  amount: string;
  direction: "income" | "expense" | "neutral";
  status: string;
  category: string;
}) {
  return {
    id: `tx-${partial.billAccount}-${partial.amount}`,
    transactionTime: new Date("2026-02-16T10:00:00.000Z"),
    billAccount: partial.billAccount,
    description: "测试交易",
    direction: partial.direction,
    amount: new Prisma.Decimal(partial.amount),
    status: partial.status,
    category: partial.category,
    orderId: `order-${partial.billAccount}-${partial.amount}`,
    internalTransfer: false
  };
}

function buildMockProfitSummary(overrides: Partial<{
  mainSettledIncome: number;
  mainPendingIncome: number;
  mainExpense: number;
  trafficCost: number;
  platformCommission: number;
  mainClosedAmount: number;
  mainClosedIncome: number;
  mainClosedExpense: number;
  mainClosedNeutral: number;
  businessRefundExpense: number;
  pureProfitSettled: number;
  pureProfitWithPending: number;
}> = {}) {
  return {
    mainSettledIncome: overrides.mainSettledIncome ?? 0,
    mainPendingIncome: overrides.mainPendingIncome ?? 0,
    mainExpense: overrides.mainExpense ?? 0,
    trafficCost: overrides.trafficCost ?? 0,
    platformCommission: overrides.platformCommission ?? 0,
    mainClosedAmount: overrides.mainClosedAmount ?? 0,
    mainClosedIncome: overrides.mainClosedIncome ?? 0,
    mainClosedExpense: overrides.mainClosedExpense ?? 0,
    mainClosedNeutral: overrides.mainClosedNeutral ?? 0,
    businessRefundExpense: overrides.businessRefundExpense ?? 0,
    pureProfitSettled: overrides.pureProfitSettled ?? 0,
    pureProfitWithPending: overrides.pureProfitWithPending ?? 0
  };
}

describe("settlement allocation account held", () => {
  it("keeps accountHeldAmount at 0 for unbound participants", async () => {
    const allRows = [
      buildQualifiedRow({
        billAccount: "acc1@example.com",
        amount: "100.00",
        direction: "income",
        status: "交易成功",
        category: "main_business"
      })
    ];

    const mockClient = {
      qualifiedTransaction: {
        findMany: async (args: { where?: Record<string, unknown> }) => {
          const where = args.where ?? {};
          const account = (where.billAccount as string)?.trim?.();
          const catFilter = where.category;
          const dirFilter = where.direction as string | undefined;
          return allRows.filter((row) => {
            if (account && row.billAccount !== account) return false;
            if (typeof catFilter === "string" && row.category !== catFilter) return false;
            if (catFilter && typeof catFilter === "object" && "in" in catFilter) {
              if (!(catFilter as { in: string[] }).in.includes(row.category)) return false;
            }
            if (dirFilter && row.direction !== dirFilter) return false;
            return true;
          });
        }
      },
      settlementBatch: {
        findFirst: async () => null
      },
      profitParticipant: {
        findMany: async () => [
          {
            id: "p-bound",
            name: "绑定账号分润者",
            billAccount: "acc1@example.com",
            ratio: new Prisma.Decimal("0.5"),
            note: ""
          },
          {
            id: "p-unbound",
            name: "未绑定账号分润者",
            billAccount: null,
            ratio: new Prisma.Decimal("0.5"),
            note: ""
          }
        ]
      },
      settlementAllocation: {
        findMany: async () => []
      }
    } as any;

    const preview = await previewSettlement(
      new Date("2026-02-16T23:59:59.000Z"),
      "cumulative",
      "",
      0,
      mockClient
    );

    // totalAvailable = 0 + 100 = 100
    // totalShareholderExpenses = 0 (bound account has no expenses in this data set)
    // pureProfit = 100 - 0 = 100, carry=0, profitPool=100, paidAmount=0+100=100
    const unbound = preview.allocations.find((item) => item.participantId === "p-unbound");
    expect(unbound).toBeDefined();
    expect(unbound?.participantBillAccount).toBeNull();
    expect(unbound?.accountHeldAmount).toBe(0);
    expect(unbound?.expenseCompensation).toBe(0);
    expect(unbound?.amount).toBe(50);
    expect(unbound?.actualTransferAmount).toBe(50);
  });

  it("pays previous carry in full and applies carry ratio only to current period net", async () => {
    const allRows = [
      buildQualifiedRow({
        billAccount: "acc1@example.com",
        amount: "120.00",
        direction: "income",
        status: "交易成功",
        category: "main_business"
      })
    ];

    const mockClient = {
      qualifiedTransaction: {
        findMany: async (args: { where?: Record<string, unknown> }) => {
          const where = args.where ?? {};
          const catFilter = where.category;
          const dirFilter = where.direction as string | undefined;
          return allRows.filter((row) => {
            if (typeof catFilter === "string" && row.category !== catFilter) return false;
            if (catFilter && typeof catFilter === "object" && "in" in catFilter) {
              if (!(catFilter as { in: string[] }).in.includes(row.category)) return false;
            }
            if (dirFilter && row.direction !== dirFilter) return false;
            return true;
          });
        }
      },
      settlementBatch: {
        findFirst: async () => ({
          id: "batch-prev",
          batchNo: "SBPREV",
          cumulativeNetAmount: new Prisma.Decimal("100.00"),
          cumulativeSettledAmount: new Prisma.Decimal("70.00"),
          carryForwardAmount: new Prisma.Decimal("30.00"),
          distributableAmount: new Prisma.Decimal("30.00")
        })
      },
      profitParticipant: {
        findMany: async () => [
          {
            id: "p-a",
            name: "A",
            billAccount: null,
            ratio: new Prisma.Decimal("0.6"),
            note: ""
          },
          {
            id: "p-b",
            name: "B",
            billAccount: null,
            ratio: new Prisma.Decimal("0.4"),
            note: ""
          }
        ]
      },
      settlementAllocation: {
        findMany: async () => []
      }
    } as any;

    const preview = await previewSettlement(
      new Date("2026-02-16T23:59:59.000Z"),
      "cumulative",
      "",
      0.2,
      mockClient
    );

    // previous carry=30; current period net=20 => totalAvailable=30+20=50
    // no shareholder expenses (all billAccount=null) => totalShareholderExpenses=0
    // pureProfit=50-0=50; carry=50*0.2=10; profitPool=50-10=40; paidAmount=0+40=40
    expect(preview.previousCarryForwardAmount).toBe(30);
    expect(preview.periodNetAmount).toBe(20);
    expect(preview.totalShareholderExpenses).toBe(0);
    expect(preview.profitPoolAmount).toBe(40);
    expect(preview.distributableAmount).toBe(50);
    expect(preview.paidAmount).toBe(40);
    expect(preview.carryForwardAmount).toBe(10);
    expect(preview.cumulativeSettledAmount).toBe(110);

    expect(preview.allocations.map((item) => item.amount)).toEqual([24, 16]);
    expect(preview.allocations.map((item) => item.expenseCompensation)).toEqual([0, 0]);
  });

  it("compensates only manual_add expenses before distributing profit", async () => {
    // Scenario:
    // acc1: income 300 (main_business), manual_add expense 70, traffic_cost 20
    // acc2: income 200 (main_business), manual_add expense 30, traffic_cost 10
    // Net = (300+200) - (70+30) - (20+10) = 500-100-30 = 370
    // Only manual_add expenses count for shareholder compensation:
    //   acc1 manual expense = 70, acc2 manual expense = 30 => totalShareholderExpenses = 100
    const allRows = [
      buildQualifiedRow({
        billAccount: "acc1@example.com",
        amount: "300.00",
        direction: "income",
        status: "交易成功",
        category: "main_business"
      }),
      buildQualifiedRow({
        billAccount: "acc2@example.com",
        amount: "200.00",
        direction: "income",
        status: "交易成功",
        category: "main_business"
      }),
      {
        ...buildQualifiedRow({
          billAccount: "acc1@example.com",
          amount: "70.00",
          direction: "expense",
          status: "交易成功",
          category: "manual_add"
        }),
        id: "tx-acc1-manual-exp-70"
      },
      {
        ...buildQualifiedRow({
          billAccount: "acc2@example.com",
          amount: "30.00",
          direction: "expense",
          status: "交易成功",
          category: "manual_add"
        }),
        id: "tx-acc2-manual-exp-30"
      },
      {
        ...buildQualifiedRow({
          billAccount: "acc1@example.com",
          amount: "20.00",
          direction: "expense",
          status: "交易成功",
          category: "traffic_cost"
        }),
        id: "tx-acc1-traffic-20"
      },
      {
        ...buildQualifiedRow({
          billAccount: "acc2@example.com",
          amount: "10.00",
          direction: "expense",
          status: "交易成功",
          category: "traffic_cost"
        }),
        id: "tx-acc2-traffic-10"
      }
    ];

    const mockClient = {
      qualifiedTransaction: {
        findMany: async (args: { where?: Record<string, unknown> }) => {
          const where = args.where ?? {};
          const account = (where.billAccount as string)?.trim?.();
          const catFilter = where.category;
          const dirFilter = where.direction as string | undefined;
          // Filter by all where conditions to support both contribution and expense queries
          return allRows.filter((row) => {
            if (account && row.billAccount !== account) return false;
            if (typeof catFilter === "string" && row.category !== catFilter) return false;
            if (catFilter && typeof catFilter === "object" && "in" in catFilter) {
              if (!(catFilter as { in: string[] }).in.includes(row.category)) return false;
            }
            if (dirFilter && row.direction !== dirFilter) return false;
            return true;
          });
        }
      },
      settlementBatch: {
        findFirst: async () => null
      },
      profitParticipant: {
        findMany: async () => [
          {
            id: "p-owner1",
            name: "股东1",
            billAccount: "acc1@example.com",
            ratio: new Prisma.Decimal("0.5"),
            note: ""
          },
          {
            id: "p-owner2",
            name: "股东2",
            billAccount: "acc2@example.com",
            ratio: new Prisma.Decimal("0.5"),
            note: ""
          }
        ]
      },
      settlementAllocation: {
        findMany: async () => []
      }
    } as any;

    const preview = await previewSettlement(
      new Date("2026-02-16T23:59:59.000Z"),
      "cumulative",
      "",
      0.3,
      mockClient
    );

    // cumulativeNetAmount = 300+200 - 70-30 - 20-10 = 370, periodNet=370
    // totalAvailable = 0 + 370 = 370
    // totalShareholderExpenses = 70 + 30 = 100 (only manual_add expenses)
    // pureProfit = 370 - 100 = 270
    // carry = 270 * 0.3 = 81
    // profitPool = 270 - 81 = 189
    // paidAmount = 100 + 189 = 289
    expect(preview.totalShareholderExpenses).toBe(100);
    expect(preview.profitPoolAmount).toBe(189);
    expect(preview.carryForwardAmount).toBe(81);
    expect(preview.paidAmount).toBe(289);

    // Allocation:
    // p-owner1: expenseComp=70, profitShare=189*0.5=94.5, amount=164.5
    // p-owner2: expenseComp=30, profitShare=189*0.5=94.5, amount=124.5
    const owner1 = preview.allocations.find((item) => item.participantId === "p-owner1")!;
    const owner2 = preview.allocations.find((item) => item.participantId === "p-owner2")!;

    expect(owner1.expenseCompensation).toBe(70);
    expect(owner1.amount).toBe(164.5);
    expect(owner2.expenseCompensation).toBe(30);
    expect(owner2.amount).toBe(124.5);

    // Total conservation: paidAmount + carryForward = totalAvailable
    expect(preview.paidAmount + preview.carryForwardAmount).toBe(370);
  });
});
