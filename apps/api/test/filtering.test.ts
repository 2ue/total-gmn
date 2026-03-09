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

  it("classifies SMM merchant orders and sys account service fees into business categories", () => {
    const input = [
      makeTx({
        orderId: "smm-success",
        description: "订单9123645",
        merchantOrderId: "SMMDLREA0CFFB3637164254058F2D3B8",
        direction: "income",
        status: "交易成功"
      }),
      makeTx({
        orderId: "smm-closed",
        description: "订单9017145",
        merchantOrderId: "SMM1OUBZ3501B0531AD12DDE0BB8BE13",
        direction: "neutral",
        status: "交易关闭"
      }),
      makeTx({
        orderId: "smm-refund",
        description: "退款-订单9101955",
        merchantOrderId: "SMMBN3S5U9EB970E8C90AB98A22350C4",
        direction: "expense",
        status: "退款成功"
      }),
      makeTx({
        orderId: "sys-fee",
        description: "服务费[2026030522001469111452688183]",
        merchantOrderId: "2026030522001469111452688183",
        direction: "expense",
        status: "交易成功",
        rawRowJson: {
          对方账号: "sys***@alipay.com"
        }
      }),
      makeTx({
        orderId: "sys-fee-refund",
        description: "服务费退回(2026030422001498321423143981)",
        merchantOrderId: "2026030422001498321423143981-r-20260304155122UwYwy6eOL3-",
        direction: "income",
        status: "退费成功",
        rawRowJson: {
          对方账号: "sys***@alipay.com"
        }
      })
    ];

    const output = classifyAndFilterTransactions(input);

    expect(output).toHaveLength(5);
    expect(output.find((item) => item.orderId === "smm-success")?.category).toBe("main_business");
    expect(output.find((item) => item.orderId === "smm-closed")?.category).toBe("closed");
    expect(output.find((item) => item.orderId === "smm-refund")?.category).toBe(
      "business_refund_expense"
    );
    expect(output.find((item) => item.orderId === "sys-fee")?.category).toBe("platform_commission");
    expect(output.find((item) => item.orderId === "sys-fee-refund")?.category).toBe(
      "platform_commission"
    );
  });
});
