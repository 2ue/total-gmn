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
  sourceType: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

const summaryQuerySchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  billAccount: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  direction: z.string().optional(),
  sourceType: z.string().optional()
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

const MAIN_PENDING_STATUSES = new Set([
  "等待对方确认收货",
  "等待发货",
  "等待对方付款",
  "等待确认收货"
]);

const MAIN_INCOME_CATEGORIES = new Set(["main_business", "manual_add"]);
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const AUTO_CONFIRM_DAYS = 10;

const PENDING_AGING_BUCKETS = [
  { key: "0_1", label: "0-1天", min: 0, max: 1 },
  { key: "2_3", label: "2-3天", min: 2, max: 3 },
  { key: "4_7", label: "4-7天", min: 4, max: 7 },
  { key: "8_14", label: "8-14天", min: 8, max: 14 },
  { key: "15_plus", label: "15天以上", min: 15, max: null }
] as const;

function findPendingAgingBucket(days: number): (typeof PENDING_AGING_BUCKETS)[number] {
  for (const bucket of PENDING_AGING_BUCKETS) {
    if (bucket.max === null) {
      if (days >= bucket.min) {
        return bucket;
      }
      continue;
    }
    if (days >= bucket.min && days <= bucket.max) {
      return bucket;
    }
  }
  return PENDING_AGING_BUCKETS[PENDING_AGING_BUCKETS.length - 1]!;
}

function calcExpectedArrivalTime(transactionTime: Date): Date {
  return new Date(transactionTime.getTime() + AUTO_CONFIRM_DAYS * MILLIS_PER_DAY);
}

function calcRemainingDays(expectedArrivalTime: Date, nowMs: number): number {
  return Math.ceil((expectedArrivalTime.getTime() - nowMs) / MILLIS_PER_DAY);
}

function toPercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return round2((numerator / denominator) * 100);
}

function buildTransactionWhere(input: {
  start?: string | undefined;
  end?: string | undefined;
  billAccount?: string | undefined;
  category?: string | undefined;
  status?: string | undefined;
  direction?: string | undefined;
  sourceType?: string | undefined;
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
  if (input.sourceType) {
    where.batch = {
      is: {
        sourceType: input.sourceType
      }
    };
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
    const records = await prisma.qualifiedTransaction.groupBy({
      by: ["direction", "status"],
      where,
      _count: {
        _all: true
      },
      _sum: {
        amount: true
      }
    });

    let incomeAmount = 0;
    let expenseAmount = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    let successCount = 0;
    let totalCount = 0;

    for (const record of records) {
      const amount = Number(record._sum.amount?.toString() ?? "0");
      const count = record._count._all;
      totalCount += count;
      if (record.direction === "income") {
        incomeAmount += amount;
        incomeCount += count;
      } else if (record.direction === "expense") {
        expenseAmount += amount;
        expenseCount += count;
      }

      if (record.status === "交易成功") {
        successCount += count;
      }
    }

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
        batchId: true,
        transactionTime: true,
        billAccount: true,
        category: true,
        status: true,
        direction: true,
        amount: true
      }
    });

    const batchIdSet = new Set(records.map((record) => record.batchId));
    const sourceTypeByBatchId = new Map<string, string>();
    if (batchIdSet.size > 0) {
      const batchRows = await prisma.importBatch.findMany({
        where: {
          id: {
            in: [...batchIdSet]
          }
        },
        select: {
          id: true,
          sourceType: true
        }
      });
      for (const row of batchRows) {
        sourceTypeByBatchId.set(row.id, row.sourceType);
      }
    }

    const settlementWhere: Prisma.SettlementBatchWhereInput = {};
    if (parsed.data.start || parsed.data.end) {
      settlementWhere.settlementTime = {};
      if (parsed.data.start) {
        const start = new Date(parsed.data.start);
        if (!Number.isNaN(start.getTime())) {
          settlementWhere.settlementTime.gte = start;
        }
      }
      if (parsed.data.end) {
        const end = new Date(parsed.data.end);
        if (!Number.isNaN(end.getTime())) {
          settlementWhere.settlementTime.lte = end;
        }
      }
    }
    if (parsed.data.billAccount) {
      settlementWhere.billAccount = parsed.data.billAccount;
    }

    const settlementRows = await prisma.settlementBatch.findMany({
      where: settlementWhere,
      orderBy: {
        settlementTime: "asc"
      },
      select: {
        batchNo: true,
        strategy: true,
        settlementTime: true,
        distributableAmount: true,
        paidAmount: true,
        carryForwardAmount: true,
        isEffective: true
      }
    });

    const categoryAgg = new Map<string, { count: number; income: number; expense: number }>();
    const accountAgg = new Map<string, { count: number; income: number; expense: number }>();
    const dayAgg = new Map<string, { count: number; income: number; expense: number }>();
    const statusAgg = new Map<string, number>();
    const directionAgg = new Map<string, { count: number; amount: number }>();
    const statusDirectionAgg = new Map<string, { status: string; direction: string; count: number; amount: number }>();
    const pendingAgingAgg = new Map<string, {
      label: string;
      minDays: number;
      maxDays: number | null;
      count: number;
      amount: number;
    }>();
    const accountCategoryAgg = new Map<string, {
      billAccount: string;
      category: string;
      count: number;
      income: number;
      expense: number;
    }>();
    const sourceTypeAgg = new Map<string, {
      sourceType: string;
      count: number;
      income: number;
      expense: number;
    }>();
    const closedRefundDayAgg = new Map<string, {
      day: string;
      closedAmount: number;
      refundAmount: number;
      closedCount: number;
      refundCount: number;
    }>();
    const pendingExpectedDayAgg = new Map<string, {
      day: string;
      count: number;
      amount: number;
    }>();
    const pendingAccountAgg = new Map<string, {
      billAccount: string;
      count: number;
      amount: number;
      dueSoon3Count: number;
      dueSoon3Amount: number;
      overdueCount: number;
      overdueAmount: number;
    }>();

    let mainSettledIncome = 0;
    let mainPendingIncome = 0;
    let mainExpense = 0;
    let trafficCost = 0;
    let platformCommission = 0;
    let mainClosedAmount = 0;
    let mainClosedIncome = 0;
    let mainClosedExpense = 0;
    let businessRefundExpense = 0;
    let pendingCount = 0;
    let pendingAmount = 0;
    let pendingDueSoon1Count = 0;
    let pendingDueSoon1Amount = 0;
    let pendingDueSoon3Count = 0;
    let pendingDueSoon3Amount = 0;
    let pendingDueSoon7Count = 0;
    let pendingDueSoon7Amount = 0;
    let pendingOverdueCount = 0;
    let pendingOverdueAmount = 0;
    const nowMs = Date.now();

    for (const record of records) {
      const amount = Number(record.amount.toString());
      const categoryKey = record.category || "unknown";
      const accountKey = record.billAccount || "unknown";
      const dayKey = toDateKeyInChina(record.transactionTime);
      const statusKey = record.status || "unknown";
      const directionKey = record.direction || "neutral";
      const sourceTypeKey = sourceTypeByBatchId.get(record.batchId) || "unknown";
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

      const statusDirectionKey = `${statusKey}__${directionKey}`;
      const statusDirectionPrev = statusDirectionAgg.get(statusDirectionKey) ?? {
        status: statusKey,
        direction: directionKey,
        count: 0,
        amount: 0
      };
      statusDirectionAgg.set(statusDirectionKey, {
        ...statusDirectionPrev,
        count: statusDirectionPrev.count + 1,
        amount: statusDirectionPrev.amount + amount
      });

      const accountCategoryKey = `${accountKey}__${categoryKey}`;
      const accountCategoryPrev = accountCategoryAgg.get(accountCategoryKey) ?? {
        billAccount: accountKey,
        category: categoryKey,
        count: 0,
        income: 0,
        expense: 0
      };
      accountCategoryAgg.set(accountCategoryKey, {
        ...accountCategoryPrev,
        count: accountCategoryPrev.count + 1,
        income: accountCategoryPrev.income + (isIncome ? amount : 0),
        expense: accountCategoryPrev.expense + (isExpense ? amount : 0)
      });

      const sourceTypePrev = sourceTypeAgg.get(sourceTypeKey) ?? {
        sourceType: sourceTypeKey,
        count: 0,
        income: 0,
        expense: 0
      };
      sourceTypeAgg.set(sourceTypeKey, {
        ...sourceTypePrev,
        count: sourceTypePrev.count + 1,
        income: sourceTypePrev.income + (isIncome ? amount : 0),
        expense: sourceTypePrev.expense + (isExpense ? amount : 0)
      });

      if (
        MAIN_INCOME_CATEGORIES.has(categoryKey) &&
        directionKey === "income" &&
        MAIN_PENDING_STATUSES.has(statusKey)
      ) {
        const ageDays = Math.max(
          0,
          Math.floor((nowMs - record.transactionTime.getTime()) / MILLIS_PER_DAY)
        );
        const bucket = findPendingAgingBucket(ageDays);
        const pendingPrev = pendingAgingAgg.get(bucket.key) ?? {
          label: bucket.label,
          minDays: bucket.min,
          maxDays: bucket.max,
          count: 0,
          amount: 0
        };
        pendingAgingAgg.set(bucket.key, {
          ...pendingPrev,
          count: pendingPrev.count + 1,
          amount: pendingPrev.amount + amount
        });

        pendingCount += 1;
        pendingAmount += amount;

        const expectedArrivalTime = calcExpectedArrivalTime(record.transactionTime);
        const expectedArrivalDay = toDateKeyInChina(expectedArrivalTime);
        const expectedDayPrev = pendingExpectedDayAgg.get(expectedArrivalDay) ?? {
          day: expectedArrivalDay,
          count: 0,
          amount: 0
        };
        pendingExpectedDayAgg.set(expectedArrivalDay, {
          ...expectedDayPrev,
          count: expectedDayPrev.count + 1,
          amount: expectedDayPrev.amount + amount
        });

        const remainDays = calcRemainingDays(expectedArrivalTime, nowMs);
        const isOverdue = remainDays < 0;
        const isDueSoon1 = remainDays >= 0 && remainDays <= 1;
        const isDueSoon3 = remainDays >= 0 && remainDays <= 3;
        const isDueSoon7 = remainDays >= 0 && remainDays <= 7;

        if (isDueSoon1) {
          pendingDueSoon1Count += 1;
          pendingDueSoon1Amount += amount;
        }
        if (isDueSoon3) {
          pendingDueSoon3Count += 1;
          pendingDueSoon3Amount += amount;
        }
        if (isDueSoon7) {
          pendingDueSoon7Count += 1;
          pendingDueSoon7Amount += amount;
        }
        if (isOverdue) {
          pendingOverdueCount += 1;
          pendingOverdueAmount += amount;
        }

        const pendingAccountPrev = pendingAccountAgg.get(accountKey) ?? {
          billAccount: accountKey,
          count: 0,
          amount: 0,
          dueSoon3Count: 0,
          dueSoon3Amount: 0,
          overdueCount: 0,
          overdueAmount: 0
        };
        pendingAccountAgg.set(accountKey, {
          billAccount: accountKey,
          count: pendingAccountPrev.count + 1,
          amount: pendingAccountPrev.amount + amount,
          dueSoon3Count: pendingAccountPrev.dueSoon3Count + (isDueSoon3 ? 1 : 0),
          dueSoon3Amount: pendingAccountPrev.dueSoon3Amount + (isDueSoon3 ? amount : 0),
          overdueCount: pendingAccountPrev.overdueCount + (isOverdue ? 1 : 0),
          overdueAmount: pendingAccountPrev.overdueAmount + (isOverdue ? amount : 0)
        });
      }

      if (categoryKey === "closed" || categoryKey === "business_refund_expense") {
        const dayPrev = closedRefundDayAgg.get(dayKey) ?? {
          day: dayKey,
          closedAmount: 0,
          refundAmount: 0,
          closedCount: 0,
          refundCount: 0
        };
        if (categoryKey === "closed") {
          dayPrev.closedAmount += amount;
          dayPrev.closedCount += 1;
        }
        if (categoryKey === "business_refund_expense") {
          dayPrev.refundAmount += amount;
          dayPrev.refundCount += 1;
        }
        closedRefundDayAgg.set(dayKey, dayPrev);
      }

      if (MAIN_INCOME_CATEGORIES.has(categoryKey)) {
        if (directionKey === "income") {
          if (statusKey === "交易成功") {
            mainSettledIncome += amount;
          } else if (MAIN_PENDING_STATUSES.has(statusKey)) {
            mainPendingIncome += amount;
          }
        } else if (directionKey === "expense") {
          mainExpense += amount;
        }
      } else if (categoryKey === "traffic_cost") {
        trafficCost += amount;
      } else if (categoryKey === "platform_commission") {
        platformCommission += amount;
      } else if (categoryKey === "closed") {
        mainClosedAmount += amount;
        if (directionKey === "income") {
          mainClosedIncome += amount;
        } else if (directionKey === "expense") {
          mainClosedExpense += amount;
        }
      } else if (categoryKey === "business_refund_expense") {
        businessRefundExpense += amount;
      }
    }

    const closedDirectionDelta = mainClosedIncome - mainClosedExpense;
    const pureProfitSettled = mainSettledIncome - mainExpense - trafficCost - platformCommission - businessRefundExpense + closedDirectionDelta;
    const pureProfitWithPending = pureProfitSettled + mainPendingIncome;
    const mainIncomeBase = mainSettledIncome + mainPendingIncome;

    const settlementByStrategyMap = new Map<string, {
      strategy: string;
      count: number;
      distributableAmount: number;
      paidAmount: number;
      carryForwardAmount: number;
    }>();
    const settlementByDayMap = new Map<string, {
      day: string;
      batchCount: number;
      distributableAmount: number;
      paidAmount: number;
      carryForwardAmount: number;
    }>();

    let effectiveBatchNo: string | null = null;
    for (const batch of settlementRows) {
      if (batch.isEffective) {
        effectiveBatchNo = batch.batchNo;
      }

      const strategyPrev = settlementByStrategyMap.get(batch.strategy) ?? {
        strategy: batch.strategy,
        count: 0,
        distributableAmount: 0,
        paidAmount: 0,
        carryForwardAmount: 0
      };
      strategyPrev.count += 1;
      strategyPrev.distributableAmount += Number(batch.distributableAmount.toString());
      strategyPrev.paidAmount += Number(batch.paidAmount.toString());
      strategyPrev.carryForwardAmount += Number(batch.carryForwardAmount.toString());
      settlementByStrategyMap.set(batch.strategy, strategyPrev);

      const dayKey = toDateKeyInChina(batch.settlementTime);
      const dayPrev = settlementByDayMap.get(dayKey) ?? {
        day: dayKey,
        batchCount: 0,
        distributableAmount: 0,
        paidAmount: 0,
        carryForwardAmount: 0
      };
      dayPrev.batchCount += 1;
      dayPrev.distributableAmount += Number(batch.distributableAmount.toString());
      dayPrev.paidAmount += Number(batch.paidAmount.toString());
      dayPrev.carryForwardAmount += Number(batch.carryForwardAmount.toString());
      settlementByDayMap.set(dayKey, dayPrev);
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
        .sort((left, right) => right.count - left.count),
      byStatusDirection: [...statusDirectionAgg.values()]
        .map((item) => ({
          status: item.status,
          direction: item.direction,
          count: item.count,
          amount: round2(item.amount)
        }))
        .sort((left, right) => right.count - left.count),
      pendingAging: PENDING_AGING_BUCKETS.map((bucket) => {
        const row = pendingAgingAgg.get(bucket.key);
        return {
          bucket: bucket.key,
          label: bucket.label,
          minDays: bucket.min,
          maxDays: bucket.max,
          count: row?.count ?? 0,
          amount: round2(row?.amount ?? 0)
        };
      }),
      pendingOverview: {
        autoConfirmDays: AUTO_CONFIRM_DAYS,
        pendingCount,
        pendingAmount: round2(pendingAmount),
        dueSoon1Count: pendingDueSoon1Count,
        dueSoon1Amount: round2(pendingDueSoon1Amount),
        dueSoon3Count: pendingDueSoon3Count,
        dueSoon3Amount: round2(pendingDueSoon3Amount),
        dueSoon7Count: pendingDueSoon7Count,
        dueSoon7Amount: round2(pendingDueSoon7Amount),
        overdueCount: pendingOverdueCount,
        overdueAmount: round2(pendingOverdueAmount)
      },
      pendingExpectedByDay: [...pendingExpectedDayAgg.values()]
        .map((item) => ({
          day: item.day,
          count: item.count,
          amount: round2(item.amount)
        }))
        .sort((left, right) => left.day.localeCompare(right.day)),
      pendingByBillAccount: [...pendingAccountAgg.values()]
        .map((item) => ({
          billAccount: item.billAccount,
          count: item.count,
          amount: round2(item.amount),
          dueSoon3Count: item.dueSoon3Count,
          dueSoon3Amount: round2(item.dueSoon3Amount),
          overdueCount: item.overdueCount,
          overdueAmount: round2(item.overdueAmount)
        }))
        .sort((left, right) => right.amount - left.amount),
      byAccountCategory: [...accountCategoryAgg.values()]
        .map((item) => ({
          billAccount: item.billAccount,
          category: item.category,
          count: item.count,
          incomeAmount: round2(item.income),
          expenseAmount: round2(item.expense),
          netAmount: round2(item.income - item.expense)
        }))
        .sort((left, right) => Math.abs(right.netAmount) - Math.abs(left.netAmount)),
      bySourceType: [...sourceTypeAgg.values()]
        .map((item) => ({
          sourceType: item.sourceType,
          count: item.count,
          incomeAmount: round2(item.income),
          expenseAmount: round2(item.expense),
          netAmount: round2(item.income - item.expense)
        }))
        .sort((left, right) => right.count - left.count),
      keyRatios: {
        mainIncomeBase: round2(mainIncomeBase),
        pureProfitSettled: round2(pureProfitSettled),
        pureProfitWithPending: round2(pureProfitWithPending),
        pendingIncomeRate: toPercent(mainPendingIncome, mainIncomeBase),
        trafficCostRate: toPercent(trafficCost, mainIncomeBase),
        platformCommissionRate: toPercent(platformCommission, mainIncomeBase),
        closedAmountRate: toPercent(mainClosedAmount, mainIncomeBase),
        refundAmountRate: toPercent(businessRefundExpense, mainIncomeBase),
        pureProfitSettledRate: toPercent(pureProfitSettled, mainSettledIncome || 0),
        pureProfitWithPendingRate: toPercent(pureProfitWithPending, mainIncomeBase)
      },
      byClosedRefundDay: [...closedRefundDayAgg.values()]
        .map((item) => ({
          day: item.day,
          closedCount: item.closedCount,
          refundCount: item.refundCount,
          closedAmount: round2(item.closedAmount),
          refundAmount: round2(item.refundAmount)
        }))
        .sort((left, right) => left.day.localeCompare(right.day)),
      settlementOverview: {
        totalBatches: settlementRows.length,
        effectiveBatchNo,
        byStrategy: [...settlementByStrategyMap.values()]
          .map((item) => ({
            strategy: item.strategy,
            count: item.count,
            distributableAmount: round2(item.distributableAmount),
            paidAmount: round2(item.paidAmount),
            carryForwardAmount: round2(item.carryForwardAmount)
          }))
          .sort((left, right) => right.count - left.count),
        byDay: [...settlementByDayMap.values()]
          .map((item) => ({
            day: item.day,
            batchCount: item.batchCount,
            distributableAmount: round2(item.distributableAmount),
            paidAmount: round2(item.paidAmount),
            carryForwardAmount: round2(item.carryForwardAmount)
          }))
          .sort((left, right) => left.day.localeCompare(right.day))
      }
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
