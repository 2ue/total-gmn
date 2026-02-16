import { describe, expect, it } from "vitest";
import { parseStatementFile } from "../src/lib/parser.js";

describe("parseStatementFile", () => {
  it("parses original alipay csv and extracts bill account", () => {
    const content = Buffer.from(
      [
        "导出信息：",
        "支付宝账户：test@example.com",
        "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注",
        "2026-01-01 10:00:00,收入,张三,foo@example.com,Codex 月卡,收入,90.00,,交易成功,OID1,MID1,备注A"
      ].join("\n"),
      "utf8"
    );

    const parsed = parseStatementFile("demo.csv", content);

    expect(parsed.sourceType).toBe("alipay_csv");
    expect(parsed.billAccount).toBe("test@example.com");
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0]?.description).toContain("Codex");
    expect(parsed.transactions[0]?.direction).toBe("income");
    expect(parsed.transactions[0]?.amount).toBe("90.00");
  });

  it("keeps closed transaction direction as neutral when source column is 不计收支", () => {
    const content = Buffer.from(
      [
        "导出信息：",
        "支付宝账户：test@example.com",
        "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注",
        "2026-01-01 10:00:00,收入,张三,foo@example.com,Codex 月卡,不计收支,90.00,,交易关闭,OID1,MID1,备注A"
      ].join("\n"),
      "utf8"
    );

    const parsed = parseStatementFile("demo.csv", content);

    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0]?.status).toBe("交易关闭");
    expect(parsed.transactions[0]?.direction).toBe("neutral");
    expect(parsed.transactions[0]?.amount).toBe("90.00");
  });

  it("parses simple csv with amount and remark", () => {
    const content = Buffer.from(
      ["金额,备注", "20.5,Codex 90d", "-8.3,分账-服务费", "0,测试零金额"].join("\n"),
      "utf8"
    );

    const parsed = parseStatementFile("simple.csv", content);

    expect(parsed.sourceType).toBe("simple_csv");
    expect(parsed.transactions).toHaveLength(3);
    expect(parsed.transactions[0]?.direction).toBe("income");
    expect(parsed.transactions[1]?.direction).toBe("expense");
    expect(parsed.transactions[1]?.amount).toBe("8.30");
    expect(parsed.transactions[2]?.amount).toBe("0.00");
    expect(parsed.transactions[0]?.description).toBe("Codex 90d");
  });

  it("parses whitespace-delimited simple table with amount and remark", () => {
    const content = Buffer.from(
      [
        "金额  备注",
        "40    codex40元90刀月卡",
        "-200  netcup服务器新购1个月",
        "-30   codex40元90刀月卡退款30元"
      ].join("\n"),
      "utf8"
    );

    const parsed = parseStatementFile("simple-space.txt", content);

    expect(parsed.sourceType).toBe("simple_csv");
    expect(parsed.transactions).toHaveLength(3);
    expect(parsed.transactions[0]?.amount).toBe("40.00");
    expect(parsed.transactions[1]?.amount).toBe("200.00");
    expect(parsed.transactions[2]?.amount).toBe("30.00");
    expect(parsed.transactions[0]?.direction).toBe("income");
    expect(parsed.transactions[1]?.direction).toBe("expense");
    expect(parsed.transactions[2]?.description).toBe("codex40元90刀月卡退款30元");
  });

  it("ignores consecutive blank lines and separator-only rows", () => {
    const content = Buffer.from(
      [
        "金额,备注",
        "",
        "40,codex40元90刀月卡",
        ",",
        "   ",
        "-200,netcup服务器新购1个月",
        "",
        "",
        "-30,codex40元90刀月卡退款30元",
        ""
      ].join("\n"),
      "utf8"
    );

    const parsed = parseStatementFile("simple-with-blanks.csv", content);

    expect(parsed.sourceType).toBe("simple_csv");
    expect(parsed.transactions).toHaveLength(3);
    expect(parsed.transactions[0]?.amount).toBe("40.00");
    expect(parsed.transactions[1]?.amount).toBe("200.00");
    expect(parsed.transactions[2]?.amount).toBe("30.00");
  });
});
