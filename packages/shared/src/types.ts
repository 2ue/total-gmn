export const SOURCE_TYPES = ["alipay_csv", "simple_csv", "manual_form"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const DIRECTIONS = ["income", "expense", "neutral"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const CATEGORIES = [
  "main_business",
  "manual_add",
  "traffic_cost",
  "platform_commission",
  "business_refund_expense",
  "other_refund",
  "internal_transfer",
  "closed",
  "other"
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface NormalizedTransaction {
  sourceType: SourceType;
  billAccount: string;
  transactionTime: Date;
  direction: Direction;
  amount: string;
  status: string;
  description: string;
  orderId: string;
  merchantOrderId: string;
  remark: string;
  rawRowJson: Record<string, unknown>;
}

export interface ClassifiedTransaction extends NormalizedTransaction {
  category: Category;
  internalTransfer: boolean;
}

export interface ImportSummary {
  totalParsed: number;
  qualifiedCount: number;
  byCategory: Record<Category, number>;
}

export interface ImportReport extends ImportSummary {
  batchId: string;
  sourceType: SourceType;
  billAccount: string;
  fileName: string;
}
