import { Category, ClassifiedTransaction, NormalizedTransaction } from "./types.js";

export const CUTOFF_TIME = parseChinaDateTime("2025-12-30 00:00:00");

const MAIN_KEYWORDS = ["codex", "gemini", "90刀", "满血api", "90d"];
const EXCLUDE_KEYWORDS = ["批量", "批发"];
const TRAFFIC_KEYWORD = "闲鱼超级擦亮充值";
const COMMISSION_KEYWORD = "分账-";
const FISH_TRANSFER = "闲鱼转账";

const QUALIFIED_CATEGORIES: ReadonlySet<Category> = new Set([
  "main_business",
  "manual_add",
  "traffic_cost",
  "platform_commission",
  "business_refund_expense",
  "internal_transfer",
  "closed"
]);

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeLower(value: string): string {
  return normalizeText(value).toLowerCase();
}

export function parseChinaDateTime(value: string): Date {
  const trimmed = normalizeText(value);
  if (!trimmed) {
    return new Date(NaN);
  }

  const normalized = trimmed.replace(" ", "T");
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    return new Date(normalized);
  }

  return new Date(`${normalized}+08:00`);
}

export function isInBusinessWindow(date: Date): boolean {
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.getTime() >= CUTOFF_TIME.getTime();
}

export function mapDirection(value: string): NormalizedTransaction["direction"] {
  const normalized = normalizeText(value);
  if (normalized === "收入") {
    return "income";
  }
  if (normalized === "支出") {
    return "expense";
  }
  return "neutral";
}

export function formatAmount(input: number): string {
  return Math.abs(input).toFixed(2);
}

function isMainBusinessDescription(description: string): boolean {
  const normalized = normalizeText(description);
  if (!normalized) {
    return false;
  }

  if (normalized === FISH_TRANSFER) {
    return true;
  }

  const lowered = normalizeLower(normalized);
  const hasExclude = EXCLUDE_KEYWORDS.some((keyword) => lowered.includes(keyword));
  if (hasExclude) {
    return false;
  }

  return MAIN_KEYWORDS.some((keyword) => lowered.includes(keyword));
}

function classifySingle(tx: NormalizedTransaction): Category {
  const description = normalizeText(tx.description);
  const status = normalizeText(tx.status);

  if (description.includes(TRAFFIC_KEYWORD)) {
    return "traffic_cost";
  }

  if (description.includes(COMMISSION_KEYWORD)) {
    return "platform_commission";
  }

  const isRefund = status.includes("退款") || description.includes("退款");
  if (isRefund) {
    const refundBase = description.replace(/^退款-?/, "");
    if (isMainBusinessDescription(refundBase)) {
      return "business_refund_expense";
    }

    return "other_refund";
  }

  const isMain = isMainBusinessDescription(description);
  if (status === "交易关闭" && isMain) {
    return "closed";
  }

  if (isMain) {
    return "main_business";
  }

  return "other";
}

function pickLatest(records: ClassifiedTransaction[]): ClassifiedTransaction {
  return records.reduce((latest, current) =>
    latest.transactionTime.getTime() >= current.transactionTime.getTime() ? latest : current
  );
}

function dedupeAndMarkInternalTransfers(
  records: ClassifiedTransaction[]
): ClassifiedTransaction[] {
  const withOrderId = new Map<string, ClassifiedTransaction[]>();
  const noOrderId: ClassifiedTransaction[] = [];

  for (const record of records) {
    if (!record.orderId) {
      noOrderId.push(record);
      continue;
    }

    const list = withOrderId.get(record.orderId);
    if (list) {
      list.push(record);
    } else {
      withOrderId.set(record.orderId, [record]);
    }
  }

  const deduped: ClassifiedTransaction[] = [...noOrderId];

  for (const groupedRecords of withOrderId.values()) {
    const incomeRecords = groupedRecords.filter((item) => item.direction === "income");
    const expenseRecords = groupedRecords.filter((item) => item.direction === "expense");

    if (incomeRecords.length > 0 && expenseRecords.length > 0) {
      const incomeLatest = pickLatest(incomeRecords);
      const expenseLatest = pickLatest(expenseRecords);

      deduped.push({
        ...incomeLatest,
        category: "internal_transfer",
        internalTransfer: true
      });
      deduped.push({
        ...expenseLatest,
        category: "internal_transfer",
        internalTransfer: true
      });
      continue;
    }

    deduped.push(pickLatest(groupedRecords));
  }

  return deduped;
}

export function classifyAndFilterTransactions(
  transactions: NormalizedTransaction[]
): ClassifiedTransaction[] {
  const withinRange = transactions.filter((tx) => isInBusinessWindow(tx.transactionTime));

  const classified: ClassifiedTransaction[] = withinRange.map((tx) => ({
    ...tx,
    category: classifySingle(tx),
    internalTransfer: false
  }));

  const deduped = dedupeAndMarkInternalTransfers(classified);

  return deduped
    .filter((tx) => QUALIFIED_CATEGORIES.has(tx.category))
    .sort((left, right) => right.transactionTime.getTime() - left.transactionTime.getTime());
}

export function createCategoryCounter(): Record<Category, number> {
  return {
    main_business: 0,
    manual_add: 0,
    traffic_cost: 0,
    platform_commission: 0,
    business_refund_expense: 0,
    other_refund: 0,
    internal_transfer: 0,
    closed: 0,
    other: 0
  };
}
