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

    const unbound = preview.allocations.find((item) => item.participantId === "p-unbound");
    expect(unbound).toBeDefined();
    expect(unbound?.participantBillAccount).toBeNull();
    expect(unbound?.accountHeldAmount).toBe(0);
    expect(unbound?.amount).toBe(50);
    expect(unbound?.actualTransferAmount).toBe(50);
  });
});
