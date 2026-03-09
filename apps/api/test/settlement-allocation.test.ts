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
        findMany: async (args: { where?: { billAccount?: string } }) => {
          const account = args.where?.billAccount?.trim();
          if (!account) {
            return allRows;
          }
          return allRows.filter((item) => item.billAccount === account);
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
        findMany: async () => allRows
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

  it("compensates shareholder expenses before distributing profit", async () => {
    // Scenario: acc1 has income 300, expenses: mainExpense=50, trafficCost=20 => total expense=70
    // acc2 has income 200, expenses: trafficCost=30 => total expense=30
    // Total net = (300-50-20) + (200-30) = 230+170 = 400
    // But we query all accounts without billAccount filter => net=500-100=400
    const allIncomeRows = [
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
          amount: "50.00",
          direction: "expense",
          status: "交易成功",
          category: "main_business"
        }),
        id: "tx-acc1-exp-50"
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
          amount: "30.00",
          direction: "expense",
          status: "交易成功",
          category: "traffic_cost"
        }),
        id: "tx-acc2-traffic-30"
      }
    ];

    const mockClient = {
      qualifiedTransaction: {
        findMany: async (args: { where?: { billAccount?: string } }) => {
          const account = args.where?.billAccount?.trim();
          if (!account) {
            return allIncomeRows;
          }
          return allIncomeRows.filter((item) => item.billAccount === account);
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

    // cumulativeNetAmount = 300+200-50-20-30 = 400, periodNet=400
    // totalAvailable = 0 + 400 = 400
    // totalShareholderExpenses = 70 (acc1) + 30 (acc2) = 100
    // pureProfit = 400 - 100 = 300
    // carry = 300 * 0.3 = 90
    // profitPool = 300 - 90 = 210
    // paidAmount = 100 + 210 = 310
    expect(preview.totalShareholderExpenses).toBe(100);
    expect(preview.profitPoolAmount).toBe(210);
    expect(preview.carryForwardAmount).toBe(90);
    expect(preview.paidAmount).toBe(310);

    // Allocation:
    // p-owner1: expenseComp=70, profitShare=210*0.5=105, amount=175
    // p-owner2: expenseComp=30, profitShare=210*0.5=105, amount=135
    const owner1 = preview.allocations.find((item) => item.participantId === "p-owner1")!;
    const owner2 = preview.allocations.find((item) => item.participantId === "p-owner2")!;

    expect(owner1.expenseCompensation).toBe(70);
    expect(owner1.amount).toBe(175);
    expect(owner2.expenseCompensation).toBe(30);
    expect(owner2.amount).toBe(135);

    // Total conservation: paidAmount + carryForward = totalAvailable
    expect(preview.paidAmount + preview.carryForwardAmount).toBe(400);
  });
});
