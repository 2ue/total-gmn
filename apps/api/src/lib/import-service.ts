import {
  Category,
  ClassifiedTransaction,
  classifyAndFilterTransactions,
  createCategoryCounter,
  formatAmount,
  ImportReport,
  NormalizedTransaction,
  SourceType
} from "@total-gmn/shared";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { parseStatementFile } from "./parser.js";

const MANUAL_SOURCE_TYPE = "manual_form";
const MANUAL_SUCCESS_STATUS = "交易成功";
const MANUAL_CATEGORY: Category = "manual_add";
const ALIPAY_SOURCE_TYPE: SourceType = "alipay_csv";
const PENDING_SHIPMENT_STATUSES = new Set(["等待发货", "待发货"]);
const AUTO_PROMOTE_DAYS = 10;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const SUCCESS_STATUS = "交易成功";
const SUCCESS_DIRECTION: NormalizedTransaction["direction"] = "income";

function toStableKey(input: {
  transactionTime: Date;
  orderId: string;
  direction: string;
  amount: string;
  status: string;
  description: string;
}): string {
  return [
    input.transactionTime.toISOString(),
    input.orderId,
    input.direction,
    input.amount,
    input.status,
    input.description
  ].join("|");
}

function buildCategorySummary(categories: Category[]): Record<Category, number> {
  const summary = createCategoryCounter();
  for (const category of categories) {
    summary[category] += 1;
  }
  return summary;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function buildDedupeKey(record: ClassifiedTransaction): string {
  if (record.orderId) {
    return [
      "order",
      normalizeToken(record.billAccount),
      normalizeToken(record.orderId),
      normalizeToken(record.direction)
    ].join("|");
  }

  return [
    "fallback",
    normalizeToken(record.billAccount),
    record.transactionTime.toISOString(),
    normalizeToken(record.direction),
    normalizeToken(record.amount),
    normalizeToken(record.status),
    normalizeToken(record.description),
    normalizeToken(record.remark)
  ].join("|");
}

function dedupeByDedupeKey(records: ClassifiedTransaction[]): Array<{
  dedupeKey: string;
  record: ClassifiedTransaction;
}> {
  const byKey = new Map<string, ClassifiedTransaction>();

  for (const record of records) {
    const dedupeKey = buildDedupeKey(record);
    const existing = byKey.get(dedupeKey);
    if (!existing || existing.transactionTime.getTime() <= record.transactionTime.getTime()) {
      byKey.set(dedupeKey, record);
    }
  }

  return [...byKey.entries()].map(([dedupeKey, record]) => ({ dedupeKey, record }));
}

interface PersistQualifiedInput {
  sourceType: SourceType;
  fileName: string;
  billAccount: string;
  totalParsed: number;
  rawMeta: Record<string, unknown>;
  qualified: ClassifiedTransaction[];
  unqualifiedRows: Array<Record<string, unknown>>;
}

function normalizeBillAccount(value?: string): string {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }
  return "unknown";
}

function buildManualOrderId(signature: string, seq: number): string {
  const digest = createHash("sha256").update(`${signature}|${seq}`).digest("hex").slice(0, 24);
  return `MANUAL${digest.toUpperCase()}`;
}

function isOverduePendingShipment(
  record: Pick<NormalizedTransaction, "status" | "transactionTime">,
  now: Date
): boolean {
  if (!PENDING_SHIPMENT_STATUSES.has(record.status)) {
    return false;
  }

  const transactionMs = record.transactionTime.getTime();
  if (Number.isNaN(transactionMs)) {
    return false;
  }

  const elapsedMs = now.getTime() - transactionMs;
  return elapsedMs > AUTO_PROMOTE_DAYS * MILLIS_PER_DAY;
}

function toStableTransactionKey(record: Pick<
  NormalizedTransaction,
  "transactionTime" | "orderId" | "direction" | "amount" | "status" | "description"
>): string {
  return toStableKey({
    transactionTime: record.transactionTime,
    orderId: record.orderId,
    direction: record.direction,
    amount: record.amount,
    status: record.status,
    description: record.description
  });
}

export function normalizeImportedTransactions(
  sourceType: SourceType,
  transactions: NormalizedTransaction[],
  now: Date = new Date()
): NormalizedTransaction[] {
  if (sourceType !== ALIPAY_SOURCE_TYPE || transactions.length === 0) {
    return transactions;
  }

  const qualifiedBeforeNormalize = classifyAndFilterTransactions(transactions);
  const candidateKeys = new Set(
    qualifiedBeforeNormalize.map((record) => toStableTransactionKey(record))
  );

  if (candidateKeys.size === 0) {
    return transactions;
  }

  let changed = false;
  const normalized: NormalizedTransaction[] = transactions.map((record): NormalizedTransaction => {
    const key = toStableTransactionKey(record);
    if (!candidateKeys.has(key) || !isOverduePendingShipment(record, now)) {
      return record;
    }

    changed = true;
    return {
      ...record,
      status: SUCCESS_STATUS,
      direction: SUCCESS_DIRECTION
    };
  });

  return changed ? normalized : transactions;
}

async function persistQualifiedTransactions(input: PersistQualifiedInput): Promise<ImportReport> {
  const dedupedQualified = dedupeByDedupeKey(input.qualified);
  const categorySummary = buildCategorySummary(dedupedQualified.map((item) => item.record.category));

  const batch = await prisma.$transaction(async (tx) => {
    const createdBatch = await tx.importBatch.create({
      data: {
        sourceType: input.sourceType,
        fileName: input.fileName,
        billAccount: input.billAccount,
        rawMetaJson: toPrismaJson({
          ...input.rawMeta,
          totalParsed: input.totalParsed,
          qualifiedCount: dedupedQualified.length,
          unqualifiedCount: input.unqualifiedRows.length,
          unqualifiedRows: input.unqualifiedRows
        })
      }
    });

    if (dedupedQualified.length > 0) {
      const dedupeKeys = dedupedQualified.map((item) => item.dedupeKey);

      const existing = await tx.qualifiedTransaction.findMany({
        where: {
          dedupeKey: {
            in: dedupeKeys
          }
        },
        select: {
          id: true,
          dedupeKey: true,
          transactionTime: true
        }
      });

      const existingByKey = new Map(existing.map((item) => [item.dedupeKey, item]));

      const createData: Prisma.QualifiedTransactionCreateManyInput[] = [];
      const updateData: Array<{
        id: string;
        dedupeKey: string;
        record: ClassifiedTransaction;
      }> = [];

      for (const item of dedupedQualified) {
        const existingRecord = existingByKey.get(item.dedupeKey);
        if (!existingRecord) {
          createData.push({
            batchId: createdBatch.id,
            dedupeKey: item.dedupeKey,
            transactionTime: item.record.transactionTime,
            orderId: item.record.orderId,
            merchantOrderId: item.record.merchantOrderId,
            description: item.record.description,
            direction: item.record.direction,
            amount: item.record.amount,
            status: item.record.status,
            category: item.record.category,
            internalTransfer: item.record.internalTransfer,
            billAccount: item.record.billAccount,
            remark: item.record.remark,
            rawRowJson: toPrismaJson(item.record.rawRowJson)
          });
          continue;
        }

        if (existingRecord.transactionTime.getTime() <= item.record.transactionTime.getTime()) {
          updateData.push({
            id: existingRecord.id,
            dedupeKey: item.dedupeKey,
            record: item.record
          });
        }
      }

      if (createData.length > 0) {
        await tx.qualifiedTransaction.createMany({
          data: createData
        });
      }

      if (updateData.length > 0) {
        await Promise.all(
          updateData.map((item) =>
            tx.qualifiedTransaction.update({
              where: {
                id: item.id
              },
              data: {
                batchId: createdBatch.id,
                transactionTime: item.record.transactionTime,
                orderId: item.record.orderId,
                merchantOrderId: item.record.merchantOrderId,
                description: item.record.description,
                direction: item.record.direction,
                amount: item.record.amount,
                status: item.record.status,
                category: item.record.category,
                internalTransfer: item.record.internalTransfer,
                billAccount: item.record.billAccount,
                remark: item.record.remark,
                rawRowJson: toPrismaJson(item.record.rawRowJson),
                dedupeKey: item.dedupeKey
              }
            })
          )
        );
      }
    }

    return createdBatch;
  });

  return {
    batchId: batch.id,
    sourceType: input.sourceType,
    billAccount: input.billAccount,
    fileName: input.fileName,
    totalParsed: input.totalParsed,
    qualifiedCount: dedupedQualified.length,
    byCategory: categorySummary
  };
}

export interface ManualScreenshotMeta {
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  storagePath: string;
}

export interface ManualImportRowInput {
  direction: "income" | "expense";
  transactionTime?: string | Date;
  amount: number;
  description: string;
  billAccount?: string;
  screenshot?: ManualScreenshotMeta;
}

export async function importQualifiedTransactions(
  fileName: string,
  content: Buffer,
  extraRawMeta: Record<string, unknown> = {}
): Promise<ImportReport> {
  const parsed = parseStatementFile(fileName, content);
  const normalizedTransactions = normalizeImportedTransactions(parsed.sourceType, parsed.transactions);
  const qualified = classifyAndFilterTransactions(normalizedTransactions);
  const qualifiedKeys = new Set(
    qualified.map((item) => toStableTransactionKey(item))
  );

  const unqualifiedRows = normalizedTransactions
    .filter(
      (item) =>
        !qualifiedKeys.has(toStableTransactionKey(item))
    )
    .map((item) => item.rawRowJson);

  return persistQualifiedTransactions({
    sourceType: parsed.sourceType,
    fileName,
    billAccount: parsed.billAccount,
    totalParsed: normalizedTransactions.length,
    rawMeta: {
      ...parsed.rawMeta,
      ...extraRawMeta
    },
    qualified,
    unqualifiedRows
  });
}

export async function importManualTransactions(input: {
  fileName: string;
  rows: ManualImportRowInput[];
}): Promise<ImportReport> {
  const now = new Date();
  const signatureCounter = new Map<string, number>();
  const normalizedRows = input.rows.map((row, index) => {
    const amount = Math.abs(Number(row.amount));
    const normalizedAmount = formatAmount(Number.isFinite(amount) ? amount : 0);
    const normalizedDescription = row.description.trim() || "手动添加";
    const normalizedBillAccount = normalizeBillAccount(row.billAccount);
    const parsedTransactionTime =
      row.transactionTime instanceof Date ? row.transactionTime : row.transactionTime ? new Date(row.transactionTime) : null;
    const transactionTimeSignature =
      parsedTransactionTime && !Number.isNaN(parsedTransactionTime.getTime())
        ? parsedTransactionTime.toISOString()
        : "";
    const normalizedTransactionTime =
      parsedTransactionTime && !Number.isNaN(parsedTransactionTime.getTime())
        ? parsedTransactionTime
        : new Date(now.getTime() + index);
    const screenshot = row.screenshot
      ? {
          fileName: row.screenshot.fileName,
          mimeType: row.screenshot.mimeType,
          size: row.screenshot.size,
          sha256: row.screenshot.sha256,
          storagePath: row.screenshot.storagePath
        }
      : undefined;
    const signatureParts = [
      normalizedBillAccount.toLowerCase(),
      row.direction,
      normalizedAmount,
      normalizedDescription,
      screenshot?.sha256 ?? ""
    ];
    if (transactionTimeSignature) {
      signatureParts.splice(1, 0, transactionTimeSignature);
    }
    const signature = signatureParts.join("|");
    const nextSeq = (signatureCounter.get(signature) ?? 0) + 1;
    signatureCounter.set(signature, nextSeq);

    return {
      billAccount: normalizedBillAccount,
      direction: row.direction,
      transactionTime: normalizedTransactionTime,
      amount: normalizedAmount,
      description: normalizedDescription,
      screenshot,
      orderId: buildManualOrderId(signature, nextSeq)
    };
  });

  const qualified: ClassifiedTransaction[] = normalizedRows.map((row) => ({
    sourceType: MANUAL_SOURCE_TYPE,
    billAccount: row.billAccount,
    transactionTime: row.transactionTime,
    direction: row.direction,
    amount: row.amount,
    status: MANUAL_SUCCESS_STATUS,
    description: row.description,
    orderId: row.orderId,
    merchantOrderId: "",
    remark: row.screenshot ? `手动添加截图:${row.screenshot.fileName}` : "手动添加",
    rawRowJson: {
      source: MANUAL_SOURCE_TYPE,
      direction: row.direction,
      amount: row.amount,
      status: MANUAL_SUCCESS_STATUS,
      description: row.description,
      billAccount: row.billAccount,
      screenshot: row.screenshot ?? null
    },
    category: MANUAL_CATEGORY,
    internalTransfer: false
  }));

  const accountSet = [...new Set(normalizedRows.map((row) => row.billAccount))];

  return persistQualifiedTransactions({
    sourceType: MANUAL_SOURCE_TYPE,
    fileName: input.fileName,
    billAccount: accountSet.length === 1 ? accountSet[0] ?? "unknown" : "multiple",
    totalParsed: input.rows.length,
    rawMeta: {
      parser: "manual_form",
      accountCount: accountSet.length
    },
    qualified,
    unqualifiedRows: []
  });
}
