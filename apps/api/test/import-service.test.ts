import { describe, expect, it } from "vitest";
import { NormalizedTransaction, parseChinaDateTime } from "@total-gmn/shared";
import { normalizeImportedTransactions } from "../src/lib/import-service.js";

function buildTx(partial: Partial<NormalizedTransaction>): NormalizedTransaction {
  return {
    sourceType: "alipay_csv",
    billAccount: "a@test.com",
    transactionTime: parseChinaDateTime("2026-01-01 10:00:00"),
    direction: "income",
    amount: "20.00",
    status: "交易成功",
    description: "Codex 月卡",
    orderId: "o-1",
    merchantOrderId: "m-1",
    remark: "",
    rawRowJson: {},
    ...partial
  };
}

describe("normalizeImportedTransactions", () => {
  it("promotes overdue pending shipment records to settled income for qualified alipay rows", () => {
    const now = parseChinaDateTime("2026-01-20 00:00:00");
    const input = [
      buildTx({
        status: "等待发货",
        direction: "neutral",
        transactionTime: parseChinaDateTime("2026-01-01 10:00:00"),
        description: "Codex 月卡每日90刀",
        orderId: "o-pending-overdue"
      })
    ];

    const output = normalizeImportedTransactions("alipay_csv", input, now);

    expect(output).toHaveLength(1);
    expect(output[0]?.status).toBe("交易成功");
    expect(output[0]?.direction).toBe("income");
  });

  it("keeps pending shipment records unchanged when not overdue", () => {
    const now = parseChinaDateTime("2026-01-08 00:00:00");
    const input = [
      buildTx({
        status: "等待发货",
        direction: "expense",
        transactionTime: parseChinaDateTime("2026-01-01 10:00:00"),
        description: "Codex 月卡每日90刀",
        orderId: "o-pending-recent"
      })
    ];

    const output = normalizeImportedTransactions("alipay_csv", input, now);

    expect(output).toHaveLength(1);
    expect(output[0]?.status).toBe("等待发货");
    expect(output[0]?.direction).toBe("expense");
  });

  it("keeps overdue pending shipment rows unchanged when they do not pass filter conditions", () => {
    const now = parseChinaDateTime("2026-01-20 00:00:00");
    const input = [
      buildTx({
        status: "等待发货",
        direction: "expense",
        transactionTime: parseChinaDateTime("2026-01-01 10:00:00"),
        description: "普通转账",
        orderId: "o-pending-unqualified"
      })
    ];

    const output = normalizeImportedTransactions("alipay_csv", input, now);

    expect(output).toHaveLength(1);
    expect(output[0]?.status).toBe("等待发货");
    expect(output[0]?.direction).toBe("expense");
  });

  it("does not apply the rule to non-alipay sources", () => {
    const now = parseChinaDateTime("2026-01-20 00:00:00");
    const input = [
      buildTx({
        sourceType: "simple_csv",
        status: "等待发货",
        direction: "expense",
        transactionTime: parseChinaDateTime("2026-01-01 10:00:00"),
        description: "Codex 月卡每日90刀",
        orderId: "o-non-alipay"
      })
    ];

    const output = normalizeImportedTransactions("simple_csv", input, now);

    expect(output).toHaveLength(1);
    expect(output[0]?.status).toBe("等待发货");
    expect(output[0]?.direction).toBe("expense");
  });
});
