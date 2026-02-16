import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";
import { formatAmount, queryProfitSummaryNumbers } from "./profit-report.js";
import { shouldIncludeClosedDirectionInProfit } from "./profit-mode.js";

export const SETTLEMENT_STRATEGIES = ["cumulative", "incremental"] as const;
export type SettlementStrategy = (typeof SETTLEMENT_STRATEGIES)[number];

interface SettlementAmounts {
  distributableAmount: number;
  paidAmount: number;
  carryForwardAmount: number;
  cumulativeSettledAmount: number;
}

interface SettlementAllocationNumbers {
  participantId: string;
  participantName: string;
  participantBillAccount: string | null;
  ratio: number;
  amount: number;
  accountHeldAmount: number;
  actualTransferAmount: number;
  note: string;
}

interface SettlementAllocation {
  participantId: string;
  participantName: string;
  participantBillAccount: string | null;
  ratio: string;
  amount: string;
  accountHeldAmount: string;
  actualTransferAmount: string;
  note: string;
}

export interface SettlementPreviewNumbers extends SettlementAmounts {
  strategy: SettlementStrategy;
  billAccount: string;
  settlementTime: Date;
  carryRatio: number;
  periodNetAmount: number;
  previousCarryForwardAmount: number;
  cumulativeNetAmount: number;
  settledBaseAmount: number;
  effectiveBatchId: string | null;
  effectiveBatchNo: string | null;
  allocationBaseAmount: number;
  allocations: SettlementAllocationNumbers[];
}

export interface SettlementPreview {
  strategy: SettlementStrategy;
  billAccount: string;
  settlementTime: string;
  carryRatio: string;
  periodNetAmount: string;
  previousCarryForwardAmount: string;
  cumulativeNetAmount: string;
  settledBaseAmount: string;
  distributableAmount: string;
  paidAmount: string;
  carryForwardAmount: string;
  cumulativeSettledAmount: string;
  effectiveBatchId: string | null;
  effectiveBatchNo: string | null;
  allocationBaseAmount: string;
  allocations: SettlementAllocation[];
}

const DECIMAL_ZERO = new Prisma.Decimal("0.00");
const SUCCESS_STATUS = "交易成功";

type SettlementClient = PrismaClient | Prisma.TransactionClient;

interface IncrementalPeriodResult {
  periodNetAmount: number;
  candidateIds: string[];
}

interface SettlementPreviewComputation {
  preview: SettlementPreviewNumbers;
  incrementalCandidateIds: string[];
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function toNumber(value: Prisma.Decimal | null | undefined): number {
  if (!value) {
    return 0;
  }
  return Number(value.toString());
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

function toDecimalByScale(value: number, scale: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(scale));
}

function createBatchNo(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SB${yyyy}${mm}${dd}${hh}${mi}${ss}${suffix}`;
}

function normalizeSettlementStrategy(input?: SettlementStrategy | string): SettlementStrategy {
  return input === "incremental" ? "incremental" : "cumulative";
}

function normalizeBillAccount(input?: string): string {
  return input?.trim() ?? "";
}

function clampCarryRatio(input?: number): number {
  if (input === undefined || Number.isNaN(input)) {
    return 0;
  }

  if (input < 0) {
    return 0;
  }

  if (input > 1) {
    return 1;
  }

  return round2(input);
}

function calculateCumulativeSettlementTargets(cumulativeNetAmount: number, carryRatio: number): {
  cumulativeSettledAmount: number;
  carryForwardAmount: number;
} {
  const safeCarryRatio = clampCarryRatio(carryRatio);
  const cumulativeSettledAmount = round2(cumulativeNetAmount * (1 - safeCarryRatio));
  const carryForwardAmount = round2(cumulativeNetAmount - cumulativeSettledAmount);
  return {
    cumulativeSettledAmount,
    carryForwardAmount
  };
}

interface ParticipantRow {
  id: string;
  name: string;
  billAccount: string | null;
  ratio: number;
  note: string;
}

async function listParticipantRows(client: SettlementClient): Promise<ParticipantRow[]> {
  const rows = await client.profitParticipant.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      billAccount: true,
      ratio: true,
      note: true
    }
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    billAccount: row.billAccount,
    ratio: Number(row.ratio.toString()),
    note: row.note
  }));
}

function pickAdjustIndexByAbsWeight(weights: number[]): number {
  if (weights.length === 0) {
    return -1;
  }

  let pickedIndex = 0;
  let pickedWeight = Math.abs(weights[0] ?? 0);

  for (let index = 1; index < weights.length; index += 1) {
    const currentWeight = Math.abs(weights[index] ?? 0);
    if (currentWeight > pickedWeight) {
      pickedWeight = currentWeight;
      pickedIndex = index;
    }
  }

  return pickedIndex;
}

function resolveAllocationBaseAmount(paidAmount: number, distributableAmount: number): number {
  if (distributableAmount < 0) {
    return distributableAmount;
  }
  return paidAmount;
}

function buildAmountByRatio(values: number[], baseAmount: number): number[] {
  if (values.length === 0) {
    return [];
  }

  const roundedAmounts = values.map((value) => round2(baseAmount * value));
  const roundedTotal = round2(roundedAmounts.reduce((sum, amount) => sum + amount, 0));
  const delta = round2(baseAmount - roundedTotal);
  if (delta !== 0) {
    const adjustIndex = pickAdjustIndexByAbsWeight(values);
    if (adjustIndex >= 0) {
      roundedAmounts[adjustIndex] = round2((roundedAmounts[adjustIndex] ?? 0) + delta);
    }
  }

  return roundedAmounts;
}

async function queryBoundAccountContributionMap(
  settlementTime: Date,
  strategy: SettlementStrategy,
  participants: ParticipantRow[],
  includeClosedDirectionInProfit: boolean,
  client: SettlementClient
): Promise<Map<string, number>> {
  const boundAccounts = [
    ...new Set(
      participants
        .map((item) => item.billAccount)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  ];
  if (boundAccounts.length === 0) {
    return new Map<string, number>();
  }

  const accountRows = await Promise.all(
    boundAccounts.map(async (account) => {
      if (strategy === "incremental") {
        const cumulative = await queryIncrementalNet(
          settlementTime,
          account,
          false,
          includeClosedDirectionInProfit,
          client
        );
        return [account, cumulative.periodNetAmount] as const;
      }

      const summary = await queryProfitSummaryNumbers(
        {
          end: settlementTime,
          billAccount: account
        },
        client
      );
      const netAmount = round2(
        summary.mainSettledIncome -
          summary.mainExpense -
          summary.trafficCost -
          summary.platformCommission -
          summary.businessRefundExpense +
          (includeClosedDirectionInProfit
            ? round2(summary.mainClosedIncome - summary.mainClosedExpense)
            : 0)
      );
      return [account, netAmount] as const;
    })
  );

  return new Map<string, number>(accountRows);
}

function buildAccountHeldMap(
  accountContributionMap: Map<string, number>,
  allocationBaseAmount: number
): Map<string, number> {
  if (accountContributionMap.size === 0) {
    return new Map<string, number>();
  }

  const entries = [...accountContributionMap.entries()];
  const totalNet = round2(entries.reduce((sum, [, amount]) => sum + amount, 0));
  if (totalNet === 0) {
    return new Map(entries.map(([account]) => [account, 0]));
  }

  const scale = allocationBaseAmount / totalNet;
  const scaledAmounts = entries.map(([, netAmount]) => netAmount * scale);
  const roundedHeldAmounts = scaledAmounts.map((amount) => round2(amount));
  const roundedTotal = round2(roundedHeldAmounts.reduce((sum, amount) => sum + amount, 0));
  const delta = round2(allocationBaseAmount - roundedTotal);
  if (delta !== 0) {
    const adjustIndex = pickAdjustIndexByAbsWeight(entries.map(([, netAmount]) => netAmount));
    if (adjustIndex >= 0) {
      roundedHeldAmounts[adjustIndex] = round2((roundedHeldAmounts[adjustIndex] ?? 0) + delta);
    }
  }

  return new Map(entries.map(([account], index) => [account, roundedHeldAmounts[index] ?? 0]));
}

async function queryPreviousAllocationSumsByParticipant(
  strategy: SettlementStrategy,
  billAccount: string,
  client: SettlementClient
): Promise<Map<string, { amount: number; held: number }>> {
  const rows = await client.settlementAllocation.findMany({
    where: {
      settlementBatch: {
        strategy,
        billAccount
      }
    },
    select: {
      participantId: true,
      participantName: true,
      participantBillAccount: true,
      amount: true,
      accountHeldAmount: true
    }
  });

  const sums = new Map<string, { amount: number; held: number }>();
  for (const row of rows) {
    const key = row.participantId || `${row.participantName}|${row.participantBillAccount || ""}`;
    const existing = sums.get(key) ?? { amount: 0, held: 0 };
    sums.set(key, {
      amount: round2(existing.amount + toNumber(row.amount)),
      held: round2(existing.held + toNumber(row.accountHeldAmount))
    });
  }

  return sums;
}

async function buildSettlementAllocations(
  participants: ParticipantRow[],
  cumulativeAllocationBaseAmount: number,
  batchAllocationBaseAmount: number,
  settlementTime: Date,
  strategy: SettlementStrategy,
  billAccount: string,
  includeClosedDirectionInProfit: boolean,
  client: SettlementClient
): Promise<SettlementAllocationNumbers[]> {
  if (participants.length === 0) {
    return [];
  }

  const batchShouldAmounts = buildAmountByRatio(
    participants.map((participant) => participant.ratio),
    batchAllocationBaseAmount
  );
  const cumulativeHeldTargetsByRatio = buildAmountByRatio(
    participants.map((participant) => participant.ratio),
    cumulativeAllocationBaseAmount
  );
  const accountContributionMap = await queryBoundAccountContributionMap(
    settlementTime,
    strategy,
    participants,
    includeClosedDirectionInProfit,
    client
  );
  const cumulativeHeldTargetsByAccount = buildAccountHeldMap(
    accountContributionMap,
    cumulativeAllocationBaseAmount
  );
  const previousSums = await queryPreviousAllocationSumsByParticipant(strategy, billAccount, client);

  const allocations = participants.map((participant, index) => {
    const participantKey = participant.id || `${participant.name}|${participant.billAccount || ""}`;
    const previous = previousSums.get(participantKey) ?? { amount: 0, held: 0 };
    const amount = batchShouldAmounts[index] ?? 0;
    const participantBillAccount = participant.billAccount?.trim() ?? "";
    const cumulativeHeldTarget = cumulativeHeldTargetsByAccount.get(participantBillAccount) ?? 0;
    const accountHeldAmount = round2(cumulativeHeldTarget - previous.held);
    const actualTransferAmount = round2(amount - accountHeldAmount);

    return {
      participantId: participant.id,
      participantName: participant.name,
      participantBillAccount: participant.billAccount,
      ratio: participant.ratio,
      amount,
      accountHeldAmount,
      actualTransferAmount,
      note: participant.note
    };
  });

  const heldDelta = round2(
    batchAllocationBaseAmount - allocations.reduce((sum, item) => sum + item.accountHeldAmount, 0)
  );
  // Only correct tiny rounding deltas; large delta can be expected when unbound participants exist.
  if (heldDelta !== 0 && Math.abs(heldDelta) <= 0.05) {
    const adjustIndex = pickAdjustIndexByAbsWeight(
      allocations.map((allocation) => allocation.accountHeldAmount)
    );
    if (adjustIndex >= 0) {
      allocations[adjustIndex]!.accountHeldAmount = round2(
        allocations[adjustIndex]!.accountHeldAmount + heldDelta
      );
      allocations[adjustIndex]!.actualTransferAmount = round2(
        allocations[adjustIndex]!.amount - allocations[adjustIndex]!.accountHeldAmount
      );
    }
  }

  return allocations;
}

function calculatePayoutAmounts(
  distributableAmount: number,
  settledBaseAmount: number,
  carryRatio: number
): SettlementAmounts {
  let paidAmount = 0;
  let carryForwardAmount = 0;

  if (distributableAmount > 0) {
    carryForwardAmount = round2(distributableAmount * carryRatio);
    paidAmount = round2(distributableAmount - carryForwardAmount);
  } else if (distributableAmount < 0) {
    paidAmount = 0;
    carryForwardAmount = round2(Math.abs(distributableAmount));
  }

  const cumulativeSettledAmount = round2(settledBaseAmount + paidAmount);

  return {
    distributableAmount,
    paidAmount,
    carryForwardAmount,
    cumulativeSettledAmount
  };
}

export function calculateSettlementAmounts(
  cumulativeNetAmount: number,
  settledBaseAmount: number,
  carryRatio = 0
): SettlementAmounts {
  const distributableAmount = round2(cumulativeNetAmount - settledBaseAmount);
  const safeCarryRatio = clampCarryRatio(carryRatio);
  return calculatePayoutAmounts(distributableAmount, settledBaseAmount, safeCarryRatio);
}

function formatPreview(input: SettlementPreviewNumbers): SettlementPreview {
  return {
    strategy: input.strategy,
    billAccount: input.billAccount,
    settlementTime: input.settlementTime.toISOString(),
    carryRatio: formatAmount(input.carryRatio),
    periodNetAmount: formatAmount(input.periodNetAmount),
    previousCarryForwardAmount: formatAmount(input.previousCarryForwardAmount),
    cumulativeNetAmount: formatAmount(input.cumulativeNetAmount),
    settledBaseAmount: formatAmount(input.settledBaseAmount),
    distributableAmount: formatAmount(input.distributableAmount),
    paidAmount: formatAmount(input.paidAmount),
    carryForwardAmount: formatAmount(input.carryForwardAmount),
    cumulativeSettledAmount: formatAmount(input.cumulativeSettledAmount),
    effectiveBatchId: input.effectiveBatchId,
    effectiveBatchNo: input.effectiveBatchNo,
    allocationBaseAmount: formatAmount(input.allocationBaseAmount),
    allocations: input.allocations.map((item) => ({
      participantId: item.participantId,
      participantName: item.participantName,
      participantBillAccount: item.participantBillAccount,
      ratio: item.ratio.toFixed(6),
      amount: formatAmount(item.amount),
      accountHeldAmount: formatAmount(item.accountHeldAmount),
      actualTransferAmount: formatAmount(item.actualTransferAmount),
      note: item.note
    }))
  };
}

async function getEffectiveBatchByStrategy(
  client: SettlementClient,
  strategy: SettlementStrategy,
  billAccount: string
): Promise<{
  id: string;
  batchNo: string;
  cumulativeNetAmount: Prisma.Decimal;
  cumulativeSettledAmount: Prisma.Decimal;
  carryForwardAmount: Prisma.Decimal;
  distributableAmount: Prisma.Decimal;
} | null> {
  return client.settlementBatch.findFirst({
    where: {
      isEffective: true,
      strategy,
      billAccount
    },
    orderBy: [{ settlementTime: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      batchNo: true,
      cumulativeNetAmount: true,
      cumulativeSettledAmount: true,
      carryForwardAmount: true,
      distributableAmount: true
    }
  });
}

function buildIncrementalCandidateWhere(
  settlementTime: Date,
  billAccount: string,
  unsettledOnly: boolean,
  includeClosedDirectionInProfit: boolean
): Prisma.QualifiedTransactionWhereInput {
  const orFilters: Prisma.QualifiedTransactionWhereInput[] = [
    {
      category: "main_business",
      direction: "income",
      status: SUCCESS_STATUS
    },
    {
      category: "manual_add",
      direction: "income",
      status: SUCCESS_STATUS
    },
    {
      category: "main_business",
      direction: "expense"
    },
    {
      category: "manual_add",
      direction: "expense"
    },
    {
      category: "traffic_cost"
    },
    {
      category: "platform_commission"
    },
    {
      category: "business_refund_expense"
    }
  ];
  if (includeClosedDirectionInProfit) {
    orFilters.push(
      {
        category: "closed",
        direction: "income"
      },
      {
        category: "closed",
        direction: "expense"
      }
    );
  }

  return {
    transactionTime: {
      lte: settlementTime
    },
    ...(billAccount
      ? {
          billAccount
        }
      : {}),
    internalTransfer: false,
    ...(unsettledOnly
      ? {
          incrementalSettledAt: null
        }
      : {}),
    OR: orFilters
  };
}

async function queryIncrementalNet(
  settlementTime: Date,
  billAccount: string,
  unsettledOnly: boolean,
  includeClosedDirectionInProfit: boolean,
  client: SettlementClient
): Promise<IncrementalPeriodResult> {
  const rows = await client.qualifiedTransaction.findMany({
    where: buildIncrementalCandidateWhere(
      settlementTime,
      billAccount,
      unsettledOnly,
      includeClosedDirectionInProfit
    ),
    select: {
      id: true,
      category: true,
      direction: true,
      status: true,
      amount: true
    }
  });

  let settledIncome = 0;
  let mainExpense = 0;
  let trafficCost = 0;
  let platformCommission = 0;
  let businessRefundExpense = 0;

  for (const row of rows) {
    const amount = toNumber(row.amount);

    if (row.category === "main_business" || row.category === "manual_add") {
      if (row.direction === "income" && row.status === SUCCESS_STATUS) {
        settledIncome += amount;
      } else if (row.direction === "expense") {
        mainExpense += amount;
      }
      continue;
    }

    if (row.category === "traffic_cost") {
      trafficCost += amount;
      continue;
    }

    if (row.category === "platform_commission") {
      platformCommission += amount;
      continue;
    }

    if (row.category === "business_refund_expense") {
      businessRefundExpense += amount;
      continue;
    }

    if (includeClosedDirectionInProfit && row.category === "closed") {
      if (row.direction === "income") {
        settledIncome += amount;
      } else if (row.direction === "expense") {
        mainExpense += amount;
      }
    }
  }

  const periodNetAmount = round2(
    settledIncome - mainExpense - trafficCost - platformCommission - businessRefundExpense
  );

  return {
    periodNetAmount,
    candidateIds: unsettledOnly ? rows.map((row) => row.id) : []
  };
}

async function buildSettlementPreview(
  settlementTime: Date,
  strategy: SettlementStrategy,
  billAccount: string,
  carryRatio: number,
  client: SettlementClient
): Promise<SettlementPreviewComputation> {
  const safeCarryRatio = clampCarryRatio(carryRatio);
  const includeClosedDirectionInProfit = shouldIncludeClosedDirectionInProfit();
  type SettlementPreviewCore = Omit<SettlementPreviewNumbers, "allocationBaseAmount" | "allocations">;

  let corePreview: SettlementPreviewCore;
  let incrementalCandidateIds: string[] = [];

  if (strategy === "incremental") {
    const [period, cumulative, effectiveBatch] = await Promise.all([
      queryIncrementalNet(settlementTime, billAccount, true, includeClosedDirectionInProfit, client),
      queryIncrementalNet(settlementTime, billAccount, false, includeClosedDirectionInProfit, client),
      getEffectiveBatchByStrategy(client, strategy, billAccount)
    ]);

    const previousCumulativeNetAmount = round2(toNumber(effectiveBatch?.cumulativeNetAmount ?? DECIMAL_ZERO));
    const settledBaseAmount = round2(toNumber(effectiveBatch?.cumulativeSettledAmount ?? DECIMAL_ZERO));
    const cumulativeNetAmount = cumulative.periodNetAmount;
    const previousCarryForwardAmount = round2(previousCumulativeNetAmount - settledBaseAmount);
    const targets = calculateCumulativeSettlementTargets(cumulativeNetAmount, safeCarryRatio);
    const distributableAmount = round2(cumulativeNetAmount - settledBaseAmount);
    const paidAmount = round2(targets.cumulativeSettledAmount - settledBaseAmount);

    corePreview = {
      strategy,
      billAccount,
      settlementTime,
      carryRatio: safeCarryRatio,
      periodNetAmount: period.periodNetAmount,
      previousCarryForwardAmount,
      cumulativeNetAmount,
      settledBaseAmount,
      distributableAmount,
      paidAmount,
      carryForwardAmount: targets.carryForwardAmount,
      cumulativeSettledAmount: targets.cumulativeSettledAmount,
      effectiveBatchId: effectiveBatch?.id ?? null,
      effectiveBatchNo: effectiveBatch?.batchNo ?? null
    };
    incrementalCandidateIds = period.candidateIds;
  } else {
    const [summary, effectiveBatch] = await Promise.all([
      queryProfitSummaryNumbers(
        {
          end: settlementTime,
          ...(billAccount
            ? {
                billAccount
              }
            : {})
        },
        client
      ),
      getEffectiveBatchByStrategy(client, strategy, billAccount)
    ]);

    const previousCumulativeNetAmount = round2(toNumber(effectiveBatch?.cumulativeNetAmount ?? DECIMAL_ZERO));
    const closedNetContribution = includeClosedDirectionInProfit
      ? round2(summary.mainClosedIncome - summary.mainClosedExpense)
      : 0;
    const cumulativeNetAmount = round2(
      summary.mainSettledIncome -
        summary.mainExpense -
        summary.trafficCost -
        summary.platformCommission -
        summary.businessRefundExpense +
        closedNetContribution
    );
    const settledBaseAmount = round2(toNumber(effectiveBatch?.cumulativeSettledAmount ?? DECIMAL_ZERO));
    const previousCarryForwardAmount = round2(previousCumulativeNetAmount - settledBaseAmount);
    const targets = calculateCumulativeSettlementTargets(cumulativeNetAmount, safeCarryRatio);
    const distributableAmount = round2(cumulativeNetAmount - settledBaseAmount);
    const paidAmount = round2(targets.cumulativeSettledAmount - settledBaseAmount);

    corePreview = {
      strategy,
      billAccount,
      settlementTime,
      carryRatio: safeCarryRatio,
      periodNetAmount: round2(cumulativeNetAmount - previousCumulativeNetAmount),
      previousCarryForwardAmount,
      cumulativeNetAmount,
      settledBaseAmount,
      distributableAmount,
      paidAmount,
      carryForwardAmount: targets.carryForwardAmount,
      cumulativeSettledAmount: targets.cumulativeSettledAmount,
      effectiveBatchId: effectiveBatch?.id ?? null,
      effectiveBatchNo: effectiveBatch?.batchNo ?? null
    };
  }

  const participants = await listParticipantRows(client);
  const allocationBaseAmount = corePreview.paidAmount;
  const allocations = await buildSettlementAllocations(
    participants,
    corePreview.cumulativeSettledAmount,
    allocationBaseAmount,
    settlementTime,
    strategy,
    billAccount,
    includeClosedDirectionInProfit,
    client
  );

  return {
    preview: {
      ...corePreview,
      allocationBaseAmount,
      allocations
    },
    incrementalCandidateIds
  };
}

function chunkIds(ids: string[], chunkSize: number): string[][] {
  if (ids.length === 0) {
    return [];
  }

  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function previewSettlement(
  settlementTime: Date,
  strategy: SettlementStrategy = "cumulative",
  billAccount?: string,
  carryRatio = 0,
  client: SettlementClient = prisma
): Promise<SettlementPreviewNumbers> {
  const safeStrategy = normalizeSettlementStrategy(strategy);
  const safeBillAccount = normalizeBillAccount(billAccount);
  const computed = await buildSettlementPreview(
    settlementTime,
    safeStrategy,
    safeBillAccount,
    carryRatio,
    client
  );
  return computed.preview;
}

export async function previewSettlementFormatted(
  settlementTime: Date,
  strategy: SettlementStrategy = "cumulative",
  billAccount?: string,
  carryRatio = 0
): Promise<SettlementPreview> {
  const preview = await previewSettlement(settlementTime, strategy, billAccount, carryRatio);
  return formatPreview(preview);
}

export async function createSettlementBatch(input: {
  settlementTime: Date;
  strategy?: SettlementStrategy;
  billAccount?: string;
  carryRatio?: number;
  note?: string;
}): Promise<{
  id: string;
  batchNo: string;
  strategy: SettlementStrategy;
  billAccount: string;
  settlementTime: string;
  carryRatio: string;
  periodNetAmount: string;
  previousCarryForwardAmount: string;
  cumulativeNetAmount: string;
  settledBaseAmount: string;
  distributableAmount: string;
  paidAmount: string;
  carryForwardAmount: string;
  cumulativeSettledAmount: string;
  note: string;
  isEffective: boolean;
  createdAt: string;
}> {
  const strategy = normalizeSettlementStrategy(input.strategy);
  const billAccount = normalizeBillAccount(input.billAccount);
  const safeCarryRatio = clampCarryRatio(input.carryRatio);

  const created = await prisma.$transaction(async (tx) => {
    const computed = await buildSettlementPreview(
      input.settlementTime,
      strategy,
      billAccount,
      safeCarryRatio,
      tx
    );

    await tx.settlementBatch.updateMany({
      where: {
        strategy,
        billAccount
      },
      data: {
        isEffective: false
      }
    });

    const createdBatch = await tx.settlementBatch.create({
      data: {
        batchNo: createBatchNo(),
        strategy,
        billAccount,
        settlementTime: input.settlementTime,
        carryRatio: toDecimal(safeCarryRatio),
        periodNetAmount: toDecimal(computed.preview.periodNetAmount),
        previousCarryForwardAmount: toDecimal(computed.preview.previousCarryForwardAmount),
        cumulativeNetAmount: toDecimal(computed.preview.cumulativeNetAmount),
        settledBaseAmount: toDecimal(computed.preview.settledBaseAmount),
        distributableAmount: toDecimal(computed.preview.distributableAmount),
        paidAmount: toDecimal(computed.preview.paidAmount),
        carryForwardAmount: toDecimal(computed.preview.carryForwardAmount),
        cumulativeSettledAmount: toDecimal(computed.preview.cumulativeSettledAmount),
        note: input.note?.trim() ?? "",
        isEffective: true
      }
    });

    if (computed.preview.allocations.length > 0) {
      await tx.settlementAllocation.createMany({
        data: computed.preview.allocations.map((allocation) => ({
          settlementBatchId: createdBatch.id,
          participantId: allocation.participantId || null,
          participantName: allocation.participantName,
          participantBillAccount: allocation.participantBillAccount,
          ratio: toDecimalByScale(allocation.ratio, 6),
          amount: toDecimal(allocation.amount),
          accountHeldAmount: toDecimal(allocation.accountHeldAmount),
          actualTransferAmount: toDecimal(allocation.actualTransferAmount),
          note: allocation.note
        }))
      });
    }

    if (strategy === "incremental" && computed.incrementalCandidateIds.length > 0) {
      for (const idChunk of chunkIds(computed.incrementalCandidateIds, 500)) {
        await tx.qualifiedTransaction.updateMany({
          where: {
            id: {
              in: idChunk
            }
          },
          data: {
            incrementalSettledAt: input.settlementTime,
            incrementalSettlementBatchId: createdBatch.id
          }
        });
      }
    }

    return createdBatch;
  });

  return {
    id: created.id,
    batchNo: created.batchNo,
    strategy: normalizeSettlementStrategy(created.strategy),
    billAccount: created.billAccount,
    settlementTime: created.settlementTime.toISOString(),
    carryRatio: formatAmount(toNumber(created.carryRatio)),
    periodNetAmount: formatAmount(toNumber(created.periodNetAmount)),
    previousCarryForwardAmount: formatAmount(toNumber(created.previousCarryForwardAmount)),
    cumulativeNetAmount: formatAmount(toNumber(created.cumulativeNetAmount)),
    settledBaseAmount: formatAmount(toNumber(created.settledBaseAmount)),
    distributableAmount: formatAmount(toNumber(created.distributableAmount)),
    paidAmount: formatAmount(toNumber(created.paidAmount)),
    carryForwardAmount: formatAmount(toNumber(created.carryForwardAmount)),
    cumulativeSettledAmount: formatAmount(toNumber(created.cumulativeSettledAmount)),
    note: created.note,
    isEffective: created.isEffective,
    createdAt: created.createdAt.toISOString()
  };
}

export async function listSettlementBatches(strategy?: SettlementStrategy, billAccount?: string): Promise<
  Array<{
    id: string;
    batchNo: string;
    strategy: SettlementStrategy;
    billAccount: string;
    settlementTime: string;
    carryRatio: string;
    periodNetAmount: string;
    previousCarryForwardAmount: string;
    cumulativeNetAmount: string;
    settledBaseAmount: string;
    distributableAmount: string;
    paidAmount: string;
    carryForwardAmount: string;
    cumulativeSettledAmount: string;
    note: string;
    isEffective: boolean;
    createdAt: string;
    allocations: SettlementAllocation[];
  }>
> {
  const safeStrategy = strategy ? normalizeSettlementStrategy(strategy) : undefined;
  const safeBillAccount = normalizeBillAccount(billAccount);
  const findManyArgs: Prisma.SettlementBatchFindManyArgs = {
    orderBy: [{ settlementTime: "desc" }, { createdAt: "desc" }]
  };
  if (safeStrategy || safeBillAccount) {
    findManyArgs.where = {
      ...(safeStrategy
        ? {
            strategy: safeStrategy
          }
        : {}),
      ...(safeBillAccount
        ? {
            billAccount: safeBillAccount
          }
        : {})
    };
  }

  const batches = await prisma.settlementBatch.findMany({
    ...findManyArgs,
    include: {
      settlementAllocations: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    }
  });

  return batches.map((batch) => ({
    id: batch.id,
    batchNo: batch.batchNo,
    strategy: normalizeSettlementStrategy(batch.strategy),
    billAccount: batch.billAccount,
    settlementTime: batch.settlementTime.toISOString(),
    carryRatio: formatAmount(toNumber(batch.carryRatio)),
    periodNetAmount: formatAmount(toNumber(batch.periodNetAmount)),
    previousCarryForwardAmount: formatAmount(toNumber(batch.previousCarryForwardAmount)),
    cumulativeNetAmount: formatAmount(toNumber(batch.cumulativeNetAmount)),
    settledBaseAmount: formatAmount(toNumber(batch.settledBaseAmount)),
    distributableAmount: formatAmount(toNumber(batch.distributableAmount)),
    paidAmount: formatAmount(toNumber(batch.paidAmount)),
    carryForwardAmount: formatAmount(toNumber(batch.carryForwardAmount)),
    cumulativeSettledAmount: formatAmount(toNumber(batch.cumulativeSettledAmount)),
    note: batch.note,
    isEffective: batch.isEffective,
    createdAt: batch.createdAt.toISOString(),
    allocations: batch.settlementAllocations.map((item) => ({
      participantId: item.participantId ?? "",
      participantName: item.participantName,
      participantBillAccount: item.participantBillAccount,
      ratio: Number(item.ratio.toString()).toFixed(6),
      amount: formatAmount(toNumber(item.amount)),
      accountHeldAmount: formatAmount(toNumber(item.accountHeldAmount)),
      actualTransferAmount: formatAmount(toNumber(item.actualTransferAmount)),
      note: item.note
    }))
  }));
}

export async function deleteSettlementBatch(batchId: string): Promise<{
  deletedId: string;
  newEffectiveBatchId: string | null;
}> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.settlementBatch.findUnique({
      where: {
        id: batchId
      },
      select: {
        id: true,
        strategy: true,
        billAccount: true
      }
    });

    if (!existing) {
      throw new Error("分润批次不存在");
    }

    await tx.settlementBatch.delete({
      where: {
        id: batchId
      }
    });

    const latest = await tx.settlementBatch.findFirst({
      where: {
        strategy: existing.strategy,
        billAccount: existing.billAccount
      },
      orderBy: [{ settlementTime: "desc" }, { createdAt: "desc" }],
      select: {
        id: true
      }
    });

    await tx.settlementBatch.updateMany({
      where: {
        strategy: existing.strategy,
        billAccount: existing.billAccount
      },
      data: {
        isEffective: false
      }
    });

    if (latest) {
      await tx.settlementBatch.update({
        where: {
          id: latest.id
        },
        data: {
          isEffective: true
        }
      });
    }

    return {
      deletedId: batchId,
      newEffectiveBatchId: latest?.id ?? null
    };
  });
}
