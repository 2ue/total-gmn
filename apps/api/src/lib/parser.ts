import { parse as parseCsv } from "csv-parse/sync";
import iconv from "iconv-lite";
import {
  formatAmount,
  mapDirection,
  parseChinaDateTime,
  NormalizedTransaction,
  SourceType
} from "@total-gmn/shared";

export interface ParsedImportPayload {
  sourceType: SourceType;
  billAccount: string;
  transactions: NormalizedTransaction[];
  rawMeta: Record<string, unknown>;
}

type RawRow = Record<string, string>;

const TEXT_SIGNALS = ["交易时间", "金额", "备注", "支付宝账户", "导出信息"];

function scoreDecodedText(text: string): number {
  return TEXT_SIGNALS.reduce(
    (score, signal) => score + (text.includes(signal) ? 1 : 0),
    0
  );
}

function decodeBestEffort(content: Buffer): { text: string; encoding: string } {
  const utf8 = content.toString("utf8");
  const gb18030 = iconv.decode(content, "gb18030");

  const utf8Score = scoreDecodedText(utf8);
  const gbScore = scoreDecodedText(gb18030);

  if (gbScore > utf8Score) {
    return { text: gb18030, encoding: "gb18030" };
  }

  return { text: utf8, encoding: "utf8" };
}

function normalizeKey(key: string): string {
  return key.replace(/^\uFEFF/, "").trim();
}

function normalizeRow(row: Record<string, unknown>): RawRow {
  const normalized: RawRow = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeKey(String(key))] = String(value ?? "").trim();
  }
  return normalized;
}

function getValue(row: RawRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function parseAmount(value: string): number {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function parseBillAccountFromMeta(text: string): string {
  const match = text.match(/支付宝账户[:：]\s*([^\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1]?.trim() ?? "";
}

function parseFlatCsvRecords(text: string): RawRow[] {
  const records = parseCsv(text, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true
  }) as Record<string, unknown>[];

  return records
    .map(normalizeRow)
    .filter((row) => Object.values(row).some((value) => value.trim().length > 0));
}

function parseWhitespaceSimpleRows(text: string): RawRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headerIndex = lines.findIndex((line) =>
    /^金额[\s\t]+备注(?:[\s\t].*)?$/u.test(line)
  );
  if (headerIndex < 0) {
    return [];
  }

  const rows: RawRow[] = [];
  const amountPattern = /^[+-]?\d+(?:\.\d+)?$/;

  for (const line of lines.slice(headerIndex + 1)) {
    const match = line.match(/^(\S+)(?:[\s\t]+(.*))?$/u);
    if (!match) {
      continue;
    }

    const amount = match[1]?.trim() ?? "";
    const remark = match[2]?.trim() ?? "";
    if (!amountPattern.test(amount)) {
      continue;
    }

    rows.push({
      金额: amount,
      备注: remark
    });
  }

  return rows;
}

function normalizeAlipayDirection(
  row: RawRow,
  amountNumber: number,
  status: string
): NormalizedTransaction["direction"] {
  const rawDirection = getValue(row, ["收/支", "direction"]);
  const explicit = mapDirection(rawDirection);
  if (explicit !== "neutral") {
    return explicit;
  }

  // For closed trades, keep explicit neutral from source and do not infer by amount sign.
  if (status === "交易关闭" && rawDirection.trim().length > 0) {
    return "neutral";
  }

  if (amountNumber > 0) {
    return "income";
  }
  if (amountNumber < 0) {
    return "expense";
  }

  return "neutral";
}

function toNormalizedTransaction(
  row: RawRow,
  sourceType: SourceType,
  fallbackBillAccount: string,
  fallbackTime: Date
): NormalizedTransaction {
  const amountNumber = parseAmount(getValue(row, ["金额", "amount"]));
  const status = getValue(row, ["交易状态", "status"]) || "交易成功";
  const transactionTimeRaw = getValue(row, ["交易时间", "transactionTime", "时间"]);
  const parsedTransactionTime = parseChinaDateTime(transactionTimeRaw);
  const transactionTime = Number.isNaN(parsedTransactionTime.getTime())
    ? fallbackTime
    : parsedTransactionTime;

  const billAccount = getValue(row, ["账单所属账号", "支付宝账户", "billAccount"]) || fallbackBillAccount;
  const description =
    getValue(row, ["商品说明", "description", "备注", "remark"]) ||
    getValue(row, ["备注", "remark"]);

  return {
    sourceType,
    billAccount: billAccount || "unknown",
    transactionTime,
    direction: normalizeAlipayDirection(row, amountNumber, status),
    amount: formatAmount(amountNumber),
    status,
    description,
    orderId: getValue(row, ["交易订单号", "orderId"]).replace(/\s+/g, ""),
    merchantOrderId: getValue(row, ["商家订单号", "merchantOrderId"]).replace(/\s+/g, ""),
    remark: getValue(row, ["备注", "remark"]),
    rawRowJson: row
  };
}

function parseOriginalAlipayCsv(
  text: string,
  fileName: string,
  encoding: string
): ParsedImportPayload {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    line.includes("交易时间,交易分类,交易对方")
  );

  if (headerIndex < 0) {
    throw new Error("未找到支付宝原始账单明细表头");
  }

  const metaText = lines.slice(0, headerIndex).join("\n");
  const billAccount = parseBillAccountFromMeta(metaText) || "unknown";
  const tableText = lines.slice(headerIndex).join("\n");
  const rows = parseFlatCsvRecords(tableText);

  const now = new Date();
  const transactions = rows.map((row) => toNormalizedTransaction(row, "alipay_csv", billAccount, now));

  return {
    sourceType: "alipay_csv",
    billAccount,
    transactions,
    rawMeta: {
      encoding,
      fileName,
      parser: "alipay_original",
      totalRows: rows.length
    }
  };
}

function parseFlatCsv(
  text: string,
  fileName: string,
  encoding: string
): ParsedImportPayload {
  let rows = parseFlatCsvRecords(text);

  if (rows.length === 0) {
    rows = parseWhitespaceSimpleRows(text);
  }

  if (rows.length === 0) {
    throw new Error("CSV 无可解析记录");
  }

  const firstRow = rows[0] ?? {};
  const headers = new Set(Object.keys(firstRow));

  const hasTransactionFields =
    headers.has("交易时间") && headers.has("收/支") && headers.has("金额");
  const hasSimpleFields = headers.has("金额") && headers.has("备注");

  if (!hasTransactionFields && !hasSimpleFields) {
    rows = parseWhitespaceSimpleRows(text);
    const fallbackFirstRow = rows[0] ?? {};
    const fallbackHeaders = new Set(Object.keys(fallbackFirstRow));
    const fallbackHasSimpleFields = fallbackHeaders.has("金额") && fallbackHeaders.has("备注");
    if (!fallbackHasSimpleFields) {
      throw new Error("CSV 缺少必要字段：至少需要 金额,备注 或完整支付宝字段");
    }
  }

  const sourceType: SourceType = hasTransactionFields ? "alipay_csv" : "simple_csv";
  const accountRow = rows.find((row) =>
    getValue(row, ["账单所属账号", "支付宝账户", "billAccount"])
  );
  const accountFromRows = accountRow
    ? getValue(accountRow, ["账单所属账号", "支付宝账户", "billAccount"])
    : "";

  const now = new Date();
  const transactions = rows.map((row) => toNormalizedTransaction(row, sourceType, accountFromRows, now));

  return {
    sourceType,
    billAccount: accountFromRows || "unknown",
    transactions,
    rawMeta: {
      encoding,
      fileName,
      parser: sourceType === "simple_csv" ? "simple_csv" : "flat_alipay_like",
      totalRows: rows.length
    }
  };
}

export function parseStatementFile(fileName: string, content: Buffer): ParsedImportPayload {
  const { text, encoding } = decodeBestEffort(content);

  if (text.includes("导出信息") && text.includes("交易时间,交易分类,交易对方")) {
    return parseOriginalAlipayCsv(text, fileName, encoding);
  }

  return parseFlatCsv(text, fileName, encoding);
}
