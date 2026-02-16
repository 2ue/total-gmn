import { describe, expect, it } from "vitest";
import { classifyAndFilterTransactions, NormalizedTransaction, parseChinaDateTime } from "@total-gmn/shared";

function makeTx(partial: Partial<NormalizedTransaction>): NormalizedTransaction {
  return {
    sourceType: "alipay_csv",
    billAccount: "x@test.com",
    transactionTime: parseChinaDateTime("2026-01-01 10:00:00"),
    direction: "income",
    amount: "10.00",
    status: "交易成功",
    description: "Codex 月卡",
    orderId: "o-default",
    merchantOrderId: "m-default",
    remark: "",
    rawRowJson: {},
    ...partial
  };
}

describe("classifyAndFilterTransactions", () => {
  it("applies keyword and exclusion rules", () => {
    const input = [
      makeTx({ orderId: "o1", description: "codex 满血api" }),
      makeTx({ orderId: "o2", description: "codex 批发" }),
      makeTx({ orderId: "o3", description: "闲鱼超级擦亮充值", direction: "expense" }),
      makeTx({ orderId: "o4", description: "分账-基础软件服务费", direction: "expense" })
    ];

    const output = classifyAndFilterTransactions(input);

    expect(output.map((item) => item.orderId)).toEqual(["o1", "o3", "o4"]);
    expect(output.find((item) => item.orderId === "o1")?.category).toBe("main_business");
    expect(output.find((item) => item.orderId === "o3")?.category).toBe("traffic_cost");
    expect(output.find((item) => item.orderId === "o4")?.category).toBe("platform_commission");
  });

  it("filters out transactions before cutoff time", () => {
    const input = [
      makeTx({ orderId: "o1", transactionTime: parseChinaDateTime("2025-12-29 23:59:59") }),
      makeTx({ orderId: "o2", transactionTime: parseChinaDateTime("2025-12-30 00:00:00") })
    ];

    const output = classifyAndFilterTransactions(input);

    expect(output.map((item) => item.orderId)).toEqual(["o2"]);
  });
});
