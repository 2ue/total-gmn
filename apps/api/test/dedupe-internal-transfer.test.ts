import { describe, expect, it } from "vitest";
import { classifyAndFilterTransactions, NormalizedTransaction, parseChinaDateTime } from "@total-gmn/shared";

function buildTx(partial: Partial<NormalizedTransaction>): NormalizedTransaction {
  return {
    sourceType: "alipay_csv",
    billAccount: "a@test.com",
    transactionTime: parseChinaDateTime("2026-01-02 10:00:00"),
    direction: "income",
    amount: "20.00",
    status: "交易成功",
    description: "闲鱼转账",
    orderId: "order-1",
    merchantOrderId: "",
    remark: "",
    rawRowJson: {},
    ...partial
  };
}

describe("dedupe and internal transfer", () => {
  it("keeps latest record for duplicate order id", () => {
    const output = classifyAndFilterTransactions([
      buildTx({
        orderId: "same-order",
        transactionTime: parseChinaDateTime("2026-01-02 10:00:00"),
        status: "等待对方确认收货"
      }),
      buildTx({
        orderId: "same-order",
        transactionTime: parseChinaDateTime("2026-01-03 10:00:00"),
        status: "交易成功"
      })
    ]);

    expect(output).toHaveLength(1);
    expect(output[0]?.status).toBe("交易成功");
  });

  it("marks income and expense under same order as internal transfer", () => {
    const output = classifyAndFilterTransactions([
      buildTx({
        orderId: "mirror-order",
        direction: "income",
        amount: "100.00",
        transactionTime: parseChinaDateTime("2026-01-03 10:00:00")
      }),
      buildTx({
        orderId: "mirror-order",
        direction: "expense",
        amount: "100.00",
        transactionTime: parseChinaDateTime("2026-01-03 10:01:00")
      })
    ]);

    expect(output).toHaveLength(2);
    expect(output.every((item) => item.category === "internal_transfer")).toBe(true);
    expect(output.every((item) => item.internalTransfer)).toBe(true);
  });
});
