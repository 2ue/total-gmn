import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const querySchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  billAccount: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  direction: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

const summaryQuerySchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  billAccount: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  direction: z.string().optional()
});

const idParamSchema = z.object({
  id: z.string().min(1)
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_ROOT_DIR = path.resolve(__dirname, "../../");
const STORAGE_ROOT_DIR = path.resolve(API_ROOT_DIR, "storage");

interface ScreenshotMeta {
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  storagePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toScreenshotMeta(raw: Prisma.JsonValue): ScreenshotMeta | null {
  if (!isRecord(raw)) {
    return null;
  }

  const screenshot = raw["screenshot"];
  if (!isRecord(screenshot)) {
    return null;
  }

  const fileName = screenshot["fileName"];
  const mimeType = screenshot["mimeType"];
  const size = screenshot["size"];
  const sha256 = screenshot["sha256"];
  const storagePath = screenshot["storagePath"];

  if (
    typeof fileName !== "string" ||
    typeof mimeType !== "string" ||
    typeof sha256 !== "string" ||
    typeof storagePath !== "string" ||
    typeof size !== "number"
  ) {
    return null;
  }

  return {
    fileName,
    mimeType,
    size,
    sha256,
    storagePath
  };
}

function resolveStoragePath(storagePath: string): string | null {
  const absolutePath = path.resolve(API_ROOT_DIR, storagePath);
  const normalizedRoot = `${STORAGE_ROOT_DIR}${path.sep}`;
  if (!absolutePath.startsWith(normalizedRoot)) {
    return null;
  }
  return absolutePath;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function toDateKeyInChina(date: Date): string {
  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return chinaTime.toISOString().slice(0, 10);
}

function buildTransactionWhere(input: {
  start?: string | undefined;
  end?: string | undefined;
  billAccount?: string | undefined;
  category?: string | undefined;
  status?: string | undefined;
  direction?: string | undefined;
}): Prisma.QualifiedTransactionWhereInput {
  const where: Prisma.QualifiedTransactionWhereInput = {};

  if (input.start || input.end) {
    where.transactionTime = {};
    if (input.start) {
      const date = new Date(input.start);
      if (!Number.isNaN(date.getTime())) {
        where.transactionTime.gte = date;
      }
    }
    if (input.end) {
      const date = new Date(input.end);
      if (!Number.isNaN(date.getTime())) {
        where.transactionTime.lte = date;
      }
    }
  }

  if (input.billAccount) {
    where.billAccount = input.billAccount;
  }

  if (input.category) {
    where.category = input.category;
  }

  if (input.status) {
    where.status = input.status;
  }
  if (input.direction) {
    where.direction = input.direction;
  }

  return where;
}

export async function registerTransactionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/transactions", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "查询参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const { page, pageSize, ...filters } = parsed.data;
    const where = buildTransactionWhere(filters);

    const skip = (page - 1) * pageSize;

    const [total, records] = await prisma.$transaction([
      prisma.qualifiedTransaction.count({ where }),
      prisma.qualifiedTransaction.findMany({
        where,
        orderBy: { transactionTime: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          transactionTime: true,
          billAccount: true,
          description: true,
          direction: true,
          amount: true,
          status: true,
          category: true,
          orderId: true,
          internalTransfer: true,
          incrementalSettledAt: true,
          rawRowJson: true
        }
      })
    ]);

    return reply.send({
      total,
      page,
      pageSize,
      items: records.map((record) => ({
        id: record.id,
        transactionTime: record.transactionTime,
        billAccount: record.billAccount,
        description: record.description,
        direction: record.direction,
        amount: record.amount.toString(),
        status: record.status,
        category: record.category,
        orderId: record.orderId,
        internalTransfer: record.internalTransfer,
        deletable: record.incrementalSettledAt === null,
        hasScreenshot: toScreenshotMeta(record.rawRowJson) !== null
      }))
    });
  });

  app.get("/transactions/summary", async (request, reply) => {
    const parsed = summaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "查询参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const where = buildTransactionWhere(parsed.data);
    const records = await prisma.qualifiedTransaction.findMany({
      where,
      select: {
        amount: true,
        direction: true,
        status: true
      }
    });

    let incomeAmount = 0;
    let expenseAmount = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    let successCount = 0;

    for (const record of records) {
      const amount = Number(record.amount.toString());
      if (record.direction === "income") {
        incomeAmount += amount;
        incomeCount += 1;
      } else if (record.direction === "expense") {
        expenseAmount += amount;
        expenseCount += 1;
      }

      if (record.status === "交易成功") {
        successCount += 1;
      }
    }

    const totalCount = records.length;
    const pendingCount = totalCount - successCount;

    return reply.send({
      totalCount,
      incomeCount,
      expenseCount,
      successCount,
      pendingCount,
      incomeAmount: round2(incomeAmount).toFixed(2),
      expenseAmount: round2(expenseAmount).toFixed(2),
      netAmount: round2(incomeAmount - expenseAmount).toFixed(2)
    });
  });

  app.get("/transactions/charts", async (request, reply) => {
    const parsed = summaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "查询参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const where = buildTransactionWhere(parsed.data);
    const records = await prisma.qualifiedTransaction.findMany({
      where,
      select: {
        transactionTime: true,
        billAccount: true,
        category: true,
        status: true,
        direction: true,
        amount: true
      }
    });

    const categoryAgg = new Map<string, { count: number; income: number; expense: number }>();
    const accountAgg = new Map<string, { count: number; income: number; expense: number }>();
    const dayAgg = new Map<string, { count: number; income: number; expense: number }>();
    const statusAgg = new Map<string, number>();
    const directionAgg = new Map<string, { count: number; amount: number }>();

    for (const record of records) {
      const amount = Number(record.amount.toString());
      const categoryKey = record.category || "unknown";
      const accountKey = record.billAccount || "unknown";
      const dayKey = toDateKeyInChina(record.transactionTime);
      const statusKey = record.status || "unknown";
      const directionKey = record.direction || "neutral";
      const isIncome = directionKey === "income";
      const isExpense = directionKey === "expense";

      const categoryPrev = categoryAgg.get(categoryKey) ?? { count: 0, income: 0, expense: 0 };
      categoryAgg.set(categoryKey, {
        count: categoryPrev.count + 1,
        income: categoryPrev.income + (isIncome ? amount : 0),
        expense: categoryPrev.expense + (isExpense ? amount : 0)
      });

      const accountPrev = accountAgg.get(accountKey) ?? { count: 0, income: 0, expense: 0 };
      accountAgg.set(accountKey, {
        count: accountPrev.count + 1,
        income: accountPrev.income + (isIncome ? amount : 0),
        expense: accountPrev.expense + (isExpense ? amount : 0)
      });

      const dayPrev = dayAgg.get(dayKey) ?? { count: 0, income: 0, expense: 0 };
      dayAgg.set(dayKey, {
        count: dayPrev.count + 1,
        income: dayPrev.income + (isIncome ? amount : 0),
        expense: dayPrev.expense + (isExpense ? amount : 0)
      });

      statusAgg.set(statusKey, (statusAgg.get(statusKey) ?? 0) + 1);

      const directionPrev = directionAgg.get(directionKey) ?? { count: 0, amount: 0 };
      directionAgg.set(directionKey, {
        count: directionPrev.count + 1,
        amount: directionPrev.amount + amount
      });
    }

    return reply.send({
      totalCount: records.length,
      byCategory: [...categoryAgg.entries()]
        .map(([category, item]) => ({
          category,
          count: item.count,
          incomeAmount: round2(item.income),
          expenseAmount: round2(item.expense),
          netAmount: round2(item.income - item.expense)
        }))
        .sort((left, right) => Math.abs(right.netAmount) - Math.abs(left.netAmount)),
      byBillAccount: [...accountAgg.entries()]
        .map(([billAccount, item]) => ({
          billAccount,
          count: item.count,
          incomeAmount: round2(item.income),
          expenseAmount: round2(item.expense),
          netAmount: round2(item.income - item.expense)
        }))
        .sort((left, right) => Math.abs(right.netAmount) - Math.abs(left.netAmount)),
      byDay: [...dayAgg.entries()]
        .map(([day, item]) => ({
          day,
          count: item.count,
          incomeAmount: round2(item.income),
          expenseAmount: round2(item.expense),
          netAmount: round2(item.income - item.expense)
        }))
        .sort((left, right) => left.day.localeCompare(right.day)),
      byStatus: [...statusAgg.entries()]
        .map(([status, count]) => ({
          status,
          count
        }))
        .sort((left, right) => right.count - left.count),
      byDirection: [...directionAgg.entries()]
        .map(([direction, item]) => ({
          direction,
          count: item.count,
          amount: round2(item.amount)
        }))
        .sort((left, right) => right.count - left.count)
    });
  });

  app.get("/transactions/:id", async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "路径参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const record = await prisma.qualifiedTransaction.findUnique({
      where: {
        id: parsed.data.id
      },
      select: {
        id: true,
        transactionTime: true,
        billAccount: true,
        description: true,
        direction: true,
        amount: true,
        status: true,
        category: true,
        orderId: true,
        merchantOrderId: true,
        remark: true,
        internalTransfer: true,
        incrementalSettledAt: true,
        incrementalSettlementBatchId: true,
        rawRowJson: true
      }
    });

    if (!record) {
      return reply.status(404).send({
        message: "交易记录不存在"
      });
    }

    const screenshot = toScreenshotMeta(record.rawRowJson);
    return reply.send({
      id: record.id,
      transactionTime: record.transactionTime,
      billAccount: record.billAccount,
      description: record.description,
      direction: record.direction,
      amount: record.amount.toString(),
      status: record.status,
      category: record.category,
      orderId: record.orderId,
      merchantOrderId: record.merchantOrderId,
      remark: record.remark,
      internalTransfer: record.internalTransfer,
      incrementalSettledAt: record.incrementalSettledAt,
      incrementalSettlementBatchId: record.incrementalSettlementBatchId,
      deletable: record.incrementalSettledAt === null,
      hasScreenshot: screenshot !== null,
      screenshot: screenshot
        ? {
            fileName: screenshot.fileName,
            mimeType: screenshot.mimeType,
            size: screenshot.size,
            sha256: screenshot.sha256,
            storagePath: screenshot.storagePath,
            url: `/api/transactions/${record.id}/screenshot`
          }
        : null,
      rawRowJson: record.rawRowJson
    });
  });

  app.get("/transactions/:id/screenshot", async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "路径参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const record = await prisma.qualifiedTransaction.findUnique({
      where: {
        id: parsed.data.id
      },
      select: {
        id: true,
        rawRowJson: true
      }
    });
    if (!record) {
      return reply.status(404).send({
        message: "交易记录不存在"
      });
    }

    const screenshot = toScreenshotMeta(record.rawRowJson);
    if (!screenshot) {
      return reply.status(404).send({
        message: "该交易没有截图"
      });
    }

    const absolutePath = resolveStoragePath(screenshot.storagePath);
    if (!absolutePath) {
      return reply.status(400).send({
        message: "截图路径无效"
      });
    }

    try {
      await access(absolutePath);
      const buffer = await readFile(absolutePath);
      reply.header("content-type", screenshot.mimeType || "application/octet-stream");
      reply.header("content-disposition", `inline; filename=\"${encodeURIComponent(screenshot.fileName)}\"`);
      return reply.send(buffer);
    } catch {
      return reply.status(404).send({
        message: "截图文件不存在"
      });
    }
  });

  app.delete("/transactions/:id", async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "路径参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const existing = await prisma.qualifiedTransaction.findUnique({
      where: {
        id: parsed.data.id
      },
      select: {
        id: true,
        incrementalSettledAt: true,
        incrementalSettlementBatchId: true
      }
    });
    if (!existing) {
      return reply.status(404).send({
        message: "交易记录不存在"
      });
    }

    if (existing.incrementalSettledAt || existing.incrementalSettlementBatchId) {
      return reply.status(409).send({
        message: "该记录已被增量分润标记，不能删除"
      });
    }

    await prisma.qualifiedTransaction.delete({
      where: {
        id: existing.id
      }
    });

    return reply.send({
      deletedId: existing.id
    });
  });
}
