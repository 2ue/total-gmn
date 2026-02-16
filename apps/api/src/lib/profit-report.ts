import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";
import { shouldIncludeClosedDirectionInProfit } from "./profit-mode.js";

export const MAIN_PENDING_STATUSES = [
  "等待对方确认收货",
  "等待发货",
  "等待对方付款",
  "等待确认收货"
] as const;

const SUCCESS_STATUS = "交易成功";
const MAIN_CATEGORIES = ["main_business", "manual_add"] as const;

export type ProfitMetric =
  | "main_settled_income"
  | "main_pending_income"
  | "main_expense"
  | "traffic_cost"
  | "platform_commission"
  | "main_closed"
  | "business_refund_expense";

export interface ProfitFilters {
  start?: Date;
  end?: Date;
  billAccount?: string;
}

export interface ProfitRecord {
  id: string;
  transactionTime: Date;
  billAccount: string;
  description: string;
  direction: string;
  amount: Prisma.Decimal | { toString(): string } | number;
  status: string;
  category: string;
  orderId: string;
  internalTransfer: boolean;
}

export interface ProfitSummaryNumbers {
  mainSettledIncome: number;
  mainPendingIncome: number;
  mainExpense: number;
  trafficCost: number;
  platformCommission: number;
  mainClosedAmount: number;
  mainClosedIncome: number;
  mainClosedExpense: number;
  mainClosedNeutral: number;
  businessRefundExpense: number;
  pureProfitSettled: number;
  pureProfitWithPending: number;
}

export interface ProfitSummary extends Record<string, string> {
  mainSettledIncome: string;
  mainPendingIncome: string;
  mainExpense: string;
  trafficCost: string;
  platformCommission: string;
  mainClosedAmount: string;
  mainClosedIncomeAmount: string;
  mainClosedExpenseAmount: string;
  mainClosedNeutralAmount: string;
  businessRefundExpense: string;
  pureProfitSettled: string;
  pureProfitWithPending: string;
}

type ProfitClient = PrismaClient | Prisma.TransactionClient;

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function decimalToNumber(value: ProfitRecord["amount"]): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value.toString());
}

export function formatAmount(value: number): string {
  return value.toFixed(2);
}

export function formatProfitSummary(summary: ProfitSummaryNumbers): ProfitSummary {
  return {
    mainSettledIncome: formatAmount(summary.mainSettledIncome),
    mainPendingIncome: formatAmount(summary.mainPendingIncome),
    mainExpense: formatAmount(summary.mainExpense),
    trafficCost: formatAmount(summary.trafficCost),
    platformCommission: formatAmount(summary.platformCommission),
    mainClosedAmount: formatAmount(summary.mainClosedAmount),
    mainClosedIncomeAmount: formatAmount(summary.mainClosedIncome),
    mainClosedExpenseAmount: formatAmount(summary.mainClosedExpense),
    mainClosedNeutralAmount: formatAmount(summary.mainClosedNeutral),
    businessRefundExpense: formatAmount(summary.businessRefundExpense),
    pureProfitSettled: formatAmount(summary.pureProfitSettled),
    pureProfitWithPending: formatAmount(summary.pureProfitWithPending)
  };
}

function isMainPendingStatus(status: string): boolean {
  return MAIN_PENDING_STATUSES.includes(status as (typeof MAIN_PENDING_STATUSES)[number]);
}

function isMainProfitCategory(category: string): boolean {
  return MAIN_CATEGORIES.includes(category as (typeof MAIN_CATEGORIES)[number]);
}

function buildTimeRangeFilter(filters: ProfitFilters): Prisma.DateTimeFilter | undefined {
  if (!filters.start && !filters.end) {
    return undefined;
  }

  const filter: Prisma.DateTimeFilter = {};
  if (filters.start) {
    filter.gte = filters.start;
  }
  if (filters.end) {
    filter.lte = filters.end;
  }
  return filter;
}

export function buildProfitBaseWhere(filters: ProfitFilters): Prisma.QualifiedTransactionWhereInput {
  const where: Prisma.QualifiedTransactionWhereInput = {
    category: {
      in: [
        "main_business",
        "manual_add",
        "traffic_cost",
        "platform_commission",
        "closed",
        "business_refund_expense"
      ]
    }
  };

  const transactionTimeFilter = buildTimeRangeFilter(filters);
  if (transactionTimeFilter) {
    where.transactionTime = transactionTimeFilter;
  }

  if (filters.billAccount) {
    where.billAccount = filters.billAccount;
  }

  return where;
}

function metricWhere(metric: ProfitMetric): Prisma.QualifiedTransactionWhereInput {
  switch (metric) {
    case "main_settled_income":
      return {
        category: {
          in: [...MAIN_CATEGORIES]
        },
        direction: "income",
        status: SUCCESS_STATUS
      };
    case "main_pending_income":
      return {
        category: {
          in: [...MAIN_CATEGORIES]
        },
        direction: "income",
        status: {
          in: [...MAIN_PENDING_STATUSES]
        }
      };
    case "main_expense":
      return {
        category: {
          in: [...MAIN_CATEGORIES]
        },
        direction: "expense"
      };
    case "traffic_cost":
      return {
        category: "traffic_cost"
      };
    case "platform_commission":
      return {
        category: "platform_commission"
      };
    case "main_closed":
      return {
        category: "closed"
      };
    case "business_refund_expense":
      return {
        category: "business_refund_expense"
      };
    default:
      return {};
  }
}

export function computeProfitSummaryNumbers(records: ProfitRecord[]): ProfitSummaryNumbers {
  const summary: ProfitSummaryNumbers = {
    mainSettledIncome: 0,
    mainPendingIncome: 0,
    mainExpense: 0,
    trafficCost: 0,
    platformCommission: 0,
    mainClosedAmount: 0,
    mainClosedIncome: 0,
    mainClosedExpense: 0,
    mainClosedNeutral: 0,
    businessRefundExpense: 0,
    pureProfitSettled: 0,
    pureProfitWithPending: 0
  };

  for (const record of records) {
    if (record.internalTransfer) {
      continue;
    }

    const amount = decimalToNumber(record.amount);

    if (isMainProfitCategory(record.category)) {
      if (record.direction === "income") {
        if (record.status === SUCCESS_STATUS) {
          summary.mainSettledIncome += amount;
        } else if (isMainPendingStatus(record.status)) {
          summary.mainPendingIncome += amount;
        }
      } else if (record.direction === "expense") {
        summary.mainExpense += amount;
      }
      continue;
    }

    if (record.category === "traffic_cost") {
      summary.trafficCost += amount;
      continue;
    }

    if (record.category === "platform_commission") {
      summary.platformCommission += amount;
      continue;
    }

    if (record.category === "closed") {
      summary.mainClosedAmount += amount;
      if (record.direction === "income") {
        summary.mainClosedIncome += amount;
      } else if (record.direction === "expense") {
        summary.mainClosedExpense += amount;
      } else {
        summary.mainClosedNeutral += amount;
      }
      continue;
    }

    if (record.category === "business_refund_expense") {
      summary.businessRefundExpense += amount;
    }
  }

  summary.mainSettledIncome = round2(summary.mainSettledIncome);
  summary.mainPendingIncome = round2(summary.mainPendingIncome);
  summary.mainExpense = round2(summary.mainExpense);
  summary.trafficCost = round2(summary.trafficCost);
  summary.platformCommission = round2(summary.platformCommission);
  summary.mainClosedAmount = round2(summary.mainClosedAmount);
  summary.mainClosedIncome = round2(summary.mainClosedIncome);
  summary.mainClosedExpense = round2(summary.mainClosedExpense);
  summary.mainClosedNeutral = round2(summary.mainClosedNeutral);
  summary.businessRefundExpense = round2(summary.businessRefundExpense);

  const closedNetContribution = shouldIncludeClosedDirectionInProfit()
    ? round2(summary.mainClosedIncome - summary.mainClosedExpense)
    : 0;

  summary.pureProfitSettled = round2(
    summary.mainSettledIncome -
      summary.mainExpense -
      summary.trafficCost -
      summary.platformCommission +
      closedNetContribution
  );

  summary.pureProfitWithPending = round2(
    summary.mainSettledIncome +
      summary.mainPendingIncome -
      summary.mainExpense -
      summary.trafficCost -
      summary.platformCommission +
      closedNetContribution
  );

  return summary;
}

export async function queryProfitSummaryNumbers(
  filters: ProfitFilters,
  client: ProfitClient = prisma
): Promise<ProfitSummaryNumbers> {
  const groupedQuery = (
    client.qualifiedTransaction as unknown as {
      groupBy?: typeof client.qualifiedTransaction.groupBy;
    }
  ).groupBy;

  if (typeof groupedQuery !== "function") {
    const records = await client.qualifiedTransaction.findMany({
      where: buildProfitBaseWhere(filters),
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
        internalTransfer: true
      }
    });

    return computeProfitSummaryNumbers(records);
  }

  const groupedRows = await client.qualifiedTransaction.groupBy({
    by: ["category", "direction", "status"],
    where: {
      ...buildProfitBaseWhere(filters),
      internalTransfer: false
    },
    _sum: {
      amount: true
    }
  });

  const summary: ProfitSummaryNumbers = {
    mainSettledIncome: 0,
    mainPendingIncome: 0,
    mainExpense: 0,
    trafficCost: 0,
    platformCommission: 0,
    mainClosedAmount: 0,
    mainClosedIncome: 0,
    mainClosedExpense: 0,
    mainClosedNeutral: 0,
    businessRefundExpense: 0,
    pureProfitSettled: 0,
    pureProfitWithPending: 0
  };

  for (const row of groupedRows) {
    const amount = Number(row._sum.amount?.toString() ?? "0");
    if (amount === 0) {
      continue;
    }

    if (isMainProfitCategory(row.category)) {
      if (row.direction === "income") {
        if (row.status === SUCCESS_STATUS) {
          summary.mainSettledIncome += amount;
        } else if (isMainPendingStatus(row.status)) {
          summary.mainPendingIncome += amount;
        }
      } else if (row.direction === "expense") {
        summary.mainExpense += amount;
      }
      continue;
    }

    if (row.category === "traffic_cost") {
      summary.trafficCost += amount;
      continue;
    }

    if (row.category === "platform_commission") {
      summary.platformCommission += amount;
      continue;
    }

    if (row.category === "closed") {
      summary.mainClosedAmount += amount;
      if (row.direction === "income") {
        summary.mainClosedIncome += amount;
      } else if (row.direction === "expense") {
        summary.mainClosedExpense += amount;
      } else {
        summary.mainClosedNeutral += amount;
      }
      continue;
    }

    if (row.category === "business_refund_expense") {
      summary.businessRefundExpense += amount;
    }
  }

  summary.mainSettledIncome = round2(summary.mainSettledIncome);
  summary.mainPendingIncome = round2(summary.mainPendingIncome);
  summary.mainExpense = round2(summary.mainExpense);
  summary.trafficCost = round2(summary.trafficCost);
  summary.platformCommission = round2(summary.platformCommission);
  summary.mainClosedAmount = round2(summary.mainClosedAmount);
  summary.mainClosedIncome = round2(summary.mainClosedIncome);
  summary.mainClosedExpense = round2(summary.mainClosedExpense);
  summary.mainClosedNeutral = round2(summary.mainClosedNeutral);
  summary.businessRefundExpense = round2(summary.businessRefundExpense);

  const closedNetContribution = shouldIncludeClosedDirectionInProfit()
    ? round2(summary.mainClosedIncome - summary.mainClosedExpense)
    : 0;

  // Keep existing report口径兼容：pureProfit不额外扣除businessRefundExpense。
  summary.pureProfitSettled = round2(
    summary.mainSettledIncome -
      summary.mainExpense -
      summary.trafficCost -
      summary.platformCommission +
      closedNetContribution
  );

  summary.pureProfitWithPending = round2(
    summary.mainSettledIncome +
      summary.mainPendingIncome -
      summary.mainExpense -
      summary.trafficCost -
      summary.platformCommission +
      closedNetContribution
  );

  return summary;
}

export async function queryProfitSummary(
  filters: ProfitFilters,
  client: ProfitClient = prisma
): Promise<ProfitSummary> {
  const numbers = await queryProfitSummaryNumbers(filters, client);
  return formatProfitSummary(numbers);
}

export interface ProfitDetailQuery {
  filters: ProfitFilters;
  metric: ProfitMetric;
  page: number;
  pageSize: number;
}

export async function queryProfitDetails(query: ProfitDetailQuery): Promise<{
  total: number;
  page: number;
  pageSize: number;
  items: Array<{
    id: string;
    transactionTime: Date;
    billAccount: string;
    description: string;
    direction: string;
    amount: string;
    status: string;
    category: string;
    orderId: string;
    internalTransfer: boolean;
  }>;
}> {
  const where: Prisma.QualifiedTransactionWhereInput = {
    AND: [buildProfitBaseWhere(query.filters), metricWhere(query.metric)]
  };

  const skip = (query.page - 1) * query.pageSize;

  const [total, records] = await prisma.$transaction([
    prisma.qualifiedTransaction.count({ where }),
    prisma.qualifiedTransaction.findMany({
      where,
      orderBy: { transactionTime: "desc" },
      skip,
      take: query.pageSize,
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
        internalTransfer: true
      }
    })
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    items: records.map((record) => ({
      ...record,
      amount: record.amount.toString()
    }))
  };
}
