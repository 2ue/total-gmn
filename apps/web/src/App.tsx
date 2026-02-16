import { Download, Eye, RefreshCw, Trash2, Upload, WalletCards } from "lucide-react";
import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, Category } from "@total-gmn/shared";

type Tab =
  | "import"
  | "details"
  | "charts"
  | "report"
  | "settings"
  | "settlement_cumulative"
  | "settlement_incremental";

type SettlementStrategy = "cumulative" | "incremental";
type ImportMode = "file" | "manual";

type ProfitMetric =
  | "main_settled_income"
  | "main_pending_income"
  | "main_expense"
  | "traffic_cost"
  | "platform_commission"
  | "main_closed"
  | "business_refund_expense";

interface ImportReport {
  batchId: string;
  sourceType: string;
  billAccount: string;
  fileName: string;
  totalParsed: number;
  qualifiedCount: number;
  byCategory: Record<string, number>;
}

interface ImportBatchItem {
  id: string;
  batchId: string;
  sourceType: string;
  fileName: string;
  billAccount: string;
  importedAt: string;
  totalParsed: number;
  qualifiedCount: number;
  hasUploadedFile: boolean;
  originalFileName: string | null;
  storedFileName: string | null;
  downloadPath: string | null;
}

interface ImportBatchListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: ImportBatchItem[];
}

interface ManualBatchRowResponse {
  id: string;
  direction: "income" | "expense";
  transactionTime: string;
  amount: string;
  description: string;
  billAccount: string;
  status: string;
  category: string;
  orderId: string;
  remark: string;
  screenshot?: {
    fileName: string;
    mimeType: string;
    size: number;
    sha256: string;
    storagePath: string;
    url?: string;
  } | null;
}

interface ManualBatchRowsResponse {
  batchId: string;
  sourceType: string;
  fileName: string;
  billAccount: string;
  importedAt: string;
  locked: boolean;
  items: ManualBatchRowResponse[];
}

interface TransactionItem {
  id: string;
  transactionTime: string;
  billAccount: string;
  description: string;
  direction: string;
  amount: string;
  status: string;
  category: string;
  orderId: string;
  internalTransfer: boolean;
  deletable?: boolean;
  hasScreenshot?: boolean;
}

interface TransactionResponse {
  total: number;
  page: number;
  pageSize: number;
  items: TransactionItem[];
}

interface TransactionDetailResponse extends Partial<TransactionItem> {
  merchantOrderId?: string;
  remark?: string;
  incrementalSettledAt?: string | null;
  incrementalSettlementBatchId?: string | null;
  rawRowJson?: Record<string, unknown>;
  screenshot?: {
    fileName?: string;
    mimeType?: string;
    size?: number;
    sha256?: string;
    storagePath?: string;
    url?: string;
  } | null;
}

interface TransactionDetail extends TransactionItem {
  merchantOrderId: string;
  remark: string;
  incrementalSettledAt: string | null;
  incrementalSettlementBatchId: string | null;
  rawRowJson: Record<string, unknown>;
  screenshotUrl: string | null;
  screenshotFileName: string;
  screenshotMimeType: string;
  screenshotStoragePath: string;
}

interface TransactionFilterInput {
  start: string;
  end: string;
  billAccount: string;
  category: string;
  status: string;
  direction?: string;
}

interface TransactionQuerySummary {
  totalCount: number;
  incomeCount: number;
  expenseCount: number;
  successCount: number;
  pendingCount: number;
  incomeAmount: string;
  expenseAmount: string;
  netAmount: string;
}

interface TransactionChartsData {
  totalCount: number;
  byCategory: Array<{
    category: string;
    count: number;
    incomeAmount: number;
    expenseAmount: number;
    netAmount: number;
  }>;
  byBillAccount: Array<{
    billAccount: string;
    count: number;
    incomeAmount: number;
    expenseAmount: number;
    netAmount: number;
  }>;
  byDay: Array<{
    day: string;
    count: number;
    incomeAmount: number;
    expenseAmount: number;
    netAmount: number;
  }>;
  byStatus: Array<{
    status: string;
    count: number;
  }>;
  byDirection: Array<{
    direction: string;
    count: number;
    amount: number;
  }>;
}

interface ChartDetailFilters {
  start?: string;
  end?: string;
  billAccount?: string;
  category?: string;
  status?: string;
  direction?: string;
}

interface ProfitSummary {
  mainSettledIncome: string;
  mainPendingIncome: string;
  mainExpense: string;
  trafficCost: string;
  platformCommission: string;
  mainClosedAmount: string;
  businessRefundExpense: string;
  pureProfitSettled: string;
  pureProfitWithPending: string;
}

interface SettlementAllocation {
  participantId: string;
  participantName: string;
  participantBillAccount: string | null;
  ratioPercent: string;
  amount: string;
  accountHeldAmount: string;
  actualTransferAmount: string;
  note: string;
}

interface SettlementAllocationResponse {
  participantId?: string;
  participantName?: string;
  participantBillAccount?: string | null;
  ratio?: string;
  amount?: string;
  accountHeldAmount?: string;
  actualTransferAmount?: string;
  note?: string;
}

interface SettlementPreview {
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

type SettlementBatchResponse = Omit<Partial<SettlementBatch>, "allocations"> & {
  allocations?: SettlementAllocationResponse[];
};
type SettlementPreviewApiResponse = Omit<Partial<SettlementPreview>, "allocations"> & {
  allocations?: SettlementAllocationResponse[];
};

interface SettlementBatch {
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
}

type AccountResponse = {
  items: Array<{
    billAccount: string;
    count: number;
  }>;
};

interface ProfitParticipantItem {
  id: string;
  name: string;
  billAccount: string | null;
  ratio: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

type ProfitParticipantsResponse = {
  items: ProfitParticipantItem[];
  totalRatio: string;
};

interface ParticipantFormItem {
  tempId: string;
  id?: string;
  name: string;
  billAccount: string;
  ratioPercent: string;
  note: string;
}

interface ManualImportRowFormItem {
  tempId: string;
  recordId?: string;
  direction: "income" | "expense";
  transactionTime: string;
  amount: string;
  description: string;
  billAccount: string;
  screenshotFile: File | null;
  existingScreenshot?: {
    fileName: string;
    mimeType: string;
    size: number;
    sha256: string;
    storagePath: string;
    url?: string;
  } | null;
}

interface ManualBulkParsedRow {
  direction: "income" | "expense";
  transactionTime: string;
  amount: string;
  description: string;
  billAccount: string;
}

const API_BASE =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE ??
  "http://localhost:3001/api";

const CATEGORY_LABEL: Record<Category, string> = {
  main_business: "主营",
  manual_add: "手动添加",
  traffic_cost: "流量消耗",
  platform_commission: "平台抽成",
  business_refund_expense: "主营退款支出",
  other_refund: "其他退款",
  internal_transfer: "内部互转",
  closed: "交易关闭",
  other: "其他"
};

const METRIC_LABEL: Record<ProfitMetric, string> = {
  main_settled_income: "主营已到账收入",
  main_pending_income: "主营待到账收入",
  main_expense: "主营支出",
  traffic_cost: "流量消耗",
  platform_commission: "平台抽成",
  main_closed: "主营关闭交易金额",
  business_refund_expense: "主营退款支出"
};

const IMPORT_SUBMIT_THROTTLE_MS = 1200;
const MANUAL_BULK_HEADER_TEXT = "金额  说明  时间  账号\n";

export default function App() {
  const [tab, setTab] = useState<Tab>("import");

  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("file");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [manualImportText, setManualImportText] = useState(MANUAL_BULK_HEADER_TEXT);
  const [manualImportRows, setManualImportRows] = useState<ManualImportRowFormItem[]>([
    {
      tempId: createTempId(),
      direction: "income",
      transactionTime: toDateTimeInputValue(new Date()),
      amount: "",
      description: "",
      billAccount: "",
      screenshotFile: null,
      existingScreenshot: null
    }
  ]);
  const [editingManualBatch, setEditingManualBatch] = useState<{
    batchId: string;
    fileName: string;
  } | null>(null);
  const [importBatches, setImportBatches] = useState<ImportBatchListResponse | null>(null);
  const [importBatchesLoading, setImportBatchesLoading] = useState(false);
  const [importBatchesError, setImportBatchesError] = useState("");
  const [importBatchesPage, setImportBatchesPage] = useState(1);
  const [accountOptions, setAccountOptions] = useState<Array<{ billAccount: string; count: number }>>([]);
  const [accountError, setAccountError] = useState("");
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastImportSubmitAtRef = useRef(0);

  const [loadingRows, setLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState("");
  const [rows, setRows] = useState<TransactionResponse | null>(null);
  const [detailsPage, setDetailsPage] = useState(1);
  const [transactionSummary, setTransactionSummary] = useState<TransactionQuerySummary | null>(null);
  const [transactionDetailLoading, setTransactionDetailLoading] = useState(false);
  const [transactionDetail, setTransactionDetail] = useState<TransactionDetail | null>(null);
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);

  const [chartFilters, setChartFilters] = useState({
    start: "",
    end: "",
    billAccount: ""
  });
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState("");
  const [chartData, setChartData] = useState<TransactionChartsData | null>(null);
  const [chartDetailVisible, setChartDetailVisible] = useState(false);
  const [chartDetailTitle, setChartDetailTitle] = useState("");
  const [chartDetailFilters, setChartDetailFilters] = useState<ChartDetailFilters | null>(null);
  const [chartDetailRows, setChartDetailRows] = useState<TransactionResponse | null>(null);
  const [chartDetailLoading, setChartDetailLoading] = useState(false);
  const [chartDetailError, setChartDetailError] = useState("");
  const [chartDetailPageSize] = useState("50");

  const [filters, setFilters] = useState({
    start: "",
    end: "",
    billAccount: "",
    category: "",
    status: "",
    pageSize: "50"
  });

  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportFilters, setReportFilters] = useState({
    start: "",
    end: "",
    billAccount: ""
  });
  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  const [detailMetric, setDetailMetric] = useState<ProfitMetric>("main_settled_income");
  const [detailRows, setDetailRows] = useState<TransactionResponse | null>(null);
  const [reportDetailPage, setReportDetailPage] = useState(1);
  const [reportDetailPageSize, setReportDetailPageSize] = useState("50");
  const [participantRows, setParticipantRows] = useState<ParticipantFormItem[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsSaving, setParticipantsSaving] = useState(false);
  const [participantsError, setParticipantsError] = useState("");

  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementDetailLoading, setSettlementDetailLoading] = useState(false);
  const [settlementError, setSettlementError] = useState("");
  const [settlementTime, setSettlementTime] = useState(() => toDateInputValue(new Date()));
  const [settlementCarryPercent, setSettlementCarryPercent] = useState("20");
  const [settlementNote, setSettlementNote] = useState("");
  const [settlementPreview, setSettlementPreview] = useState<SettlementPreview | null>(null);
  const [settlementDetailBillAccount, setSettlementDetailBillAccount] = useState("");
  const [settlementDetailPreview, setSettlementDetailPreview] = useState<SettlementPreview | null>(null);
  const [settlementBatches, setSettlementBatches] = useState<SettlementBatch[]>([]);
  const [expandedSettlementBatchIds, setExpandedSettlementBatchIds] = useState<Record<string, boolean>>({});
  const [participantRatioPanelExpanded, setParticipantRatioPanelExpanded] = useState(false);
  const activeSettlementStrategy: SettlementStrategy =
    tab === "settlement_incremental" ? "incremental" : "cumulative";
  const isSettlementTab = tab === "settlement_cumulative" || tab === "settlement_incremental";

  const categoryOptions = useMemo(
    () =>
      CATEGORIES.filter((category) => category !== "other" && category !== "other_refund").map(
        (category) => ({
          value: category,
          label: CATEGORY_LABEL[category]
        })
      ),
    []
  );

  const participantRatioTotal = useMemo(() => sumParticipantPercent(participantRows), [participantRows]);
  const isParticipantRatioValid = Math.abs(participantRatioTotal - 100) < 0.0001;

  useEffect(() => {
    void Promise.all([fetchAccountOptions(), fetchParticipants()]);
  }, []);

  useEffect(() => {
    setSettlementDetailBillAccount((prev) => {
      if (prev && accountOptions.some((item) => item.billAccount === prev)) {
        return prev;
      }
      return accountOptions[0]?.billAccount ?? "";
    });
  }, [accountOptions]);

  useEffect(() => {
    if (editingManualBatch) {
      return;
    }

    const fallbackBillAccount = accountOptions[0]?.billAccount ?? "";
    if (!fallbackBillAccount) {
      return;
    }

    setManualImportRows((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.billAccount.trim().length > 0) {
          return row;
        }
        changed = true;
        return {
          ...row,
          billAccount: fallbackBillAccount
        };
      });
      return changed ? next : prev;
    });
  }, [accountOptions, editingManualBatch]);

  useEffect(() => {
    if (!isSettlementTab || !settlementDetailBillAccount) {
      return;
    }
    void fetchSettlementDetailPreview(activeSettlementStrategy, settlementDetailBillAccount);
  }, [isSettlementTab, settlementDetailBillAccount, activeSettlementStrategy]);

  useEffect(() => {
    if (tab === "import") {
      clearImportFileSelection();
      void fetchImportBatches(1);
      return;
    }

    if (tab === "details") {
      setDetailsPage(1);
      void fetchTransactions(1);
      return;
    }

    if (tab === "charts") {
      void fetchTransactionCharts();
      return;
    }

    if (tab === "report") {
      void loadReportDefaultData();
      return;
    }

    if (tab === "settings") {
      void fetchParticipants();
      return;
    }

    if (tab === "settlement_cumulative") {
      void Promise.all([loadSettlementDefaultData("cumulative"), fetchParticipants()]);
      return;
    }

    if (tab === "settlement_incremental") {
      void Promise.all([loadSettlementDefaultData("incremental"), fetchParticipants()]);
    }
  }, [tab]);

  function shouldThrottleImport(): boolean {
    const now = Date.now();
    if (now - lastImportSubmitAtRef.current < IMPORT_SUBMIT_THROTTLE_MS) {
      setImportError("导入操作过于频繁，请稍后再试");
      return true;
    }
    lastImportSubmitAtRef.current = now;
    return false;
  }

  function clearImportFileSelection() {
    setSelectedFile(null);
    if (importFileInputRef.current) {
      importFileInputRef.current.value = "";
    }
  }

  function addManualImportRow() {
    setManualImportRows((prev) => [
      ...prev,
      {
        tempId: createTempId(),
        direction: "income",
        transactionTime: toDateTimeInputValue(new Date()),
        amount: "",
        description: "",
        billAccount: accountOptions[0]?.billAccount ?? "",
        screenshotFile: null,
        existingScreenshot: null
      }
    ]);
  }

  function removeManualImportRow(tempId: string) {
    setManualImportRows((prev) => {
      const next = prev.filter((row) => row.tempId !== tempId);
      if (next.length > 0) {
        return next;
      }
      return [
        {
          tempId: createTempId(),
          direction: "income",
          transactionTime: toDateTimeInputValue(new Date()),
          amount: "",
          description: "",
          billAccount: accountOptions[0]?.billAccount ?? "",
          screenshotFile: null,
          existingScreenshot: null
        }
      ];
    });
  }

  function updateManualImportRow(
    tempId: string,
    updater: (current: ManualImportRowFormItem) => ManualImportRowFormItem
  ) {
    setManualImportRows((prev) => prev.map((row) => (row.tempId === tempId ? updater(row) : row)));
  }

  function resetManualImportRows() {
    setManualImportRows([
      {
        tempId: createTempId(),
        direction: "income",
        transactionTime: toDateTimeInputValue(new Date()),
        amount: "",
        description: "",
        billAccount: accountOptions[0]?.billAccount ?? "",
        screenshotFile: null,
        existingScreenshot: null
      }
    ]);
  }

  async function handleFileImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) {
      return;
    }

    if (!selectedFile) {
      setImportError("请先选择账单文件");
      return;
    }

    if (shouldThrottleImport()) {
      return;
    }

    setImportError("");
    setImportResult(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch(`${API_BASE}/imports`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "导入失败");
      }

      const body = (await response.json()) as ImportReport;
      setImportResult(body);
      void fetchAccountOptions();
      void fetchImportBatches(1);
      setEditingManualBatch(null);
      clearImportFileSelection();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setUploading(false);
    }
  }

  function handleFillManualRowsFromText() {
    const text = manualImportText.trim();
    if (!text) {
      setImportError("请先输入批量文本");
      return;
    }

    const parsed = parseManualRowsFromText(
      text,
      accountOptions[0]?.billAccount ?? "",
      toDateTimeInputValue(new Date())
    );
    if (parsed.rows.length === 0) {
      setImportError("未识别到可导入行，请检查格式");
      return;
    }

    setManualImportRows((prev) => {
      const hasMeaningfulRow = prev.some(
        (row) =>
          row.amount.trim().length > 0 ||
          row.description.trim().length > 0 ||
          row.billAccount.trim().length > 0
      );
      const baseRows = hasMeaningfulRow ? prev : [];
      const appendedRows = parsed.rows.map((row) => ({
        tempId: createTempId(),
        direction: row.direction,
        transactionTime: row.transactionTime,
        amount: row.amount,
        description: row.description,
        billAccount: row.billAccount,
        screenshotFile: null,
        existingScreenshot: null
      }));
      return [...baseRows, ...appendedRows];
    });

    if (parsed.skippedCount > 0) {
      setImportError(`已追加 ${parsed.rows.length} 条，跳过 ${parsed.skippedCount} 条无效行`);
    } else {
      setImportError("");
    }
    setImportResult(null);
  }

  async function handleManualRowsImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) {
      return;
    }

    const normalizedRows = manualImportRows
      .map((row) => ({
        ...row,
        transactionTime: row.transactionTime.trim(),
        amountNum: Number(row.amount),
        description: row.description.trim(),
        billAccount: row.billAccount.trim() || accountOptions[0]?.billAccount || "",
        transactionTimeIso: toIsoFromDateTimeInput(row.transactionTime)
      }))
      .filter((row) => row.description.length > 0 || row.amount.length > 0 || row.billAccount.length > 0);

    if (normalizedRows.length === 0) {
      setImportError("请至少填写一条手动记录");
      return;
    }

    const invalidRowIndex = normalizedRows.findIndex(
      (row) =>
        !Number.isFinite(row.amountNum) ||
        row.amountNum === 0 ||
        !row.description ||
        !row.transactionTimeIso ||
        !row.billAccount
    );
    if (invalidRowIndex >= 0) {
      const invalidRow = normalizedRows[invalidRowIndex];
      const issues: string[] = [];
      if (!invalidRow || !Number.isFinite(invalidRow.amountNum) || invalidRow.amountNum === 0) {
        issues.push("金额需非 0");
      }
      if (!invalidRow?.description) {
        issues.push("说明必填");
      }
      if (!invalidRow?.transactionTimeIso) {
        issues.push("时间格式不合法或为空");
      }
      if (!invalidRow?.billAccount) {
        issues.push("账号必填");
      }
      setImportError(`第 ${invalidRowIndex + 1} 条记录不合法：${issues.join("，")}`);
      return;
    }

    if (shouldThrottleImport()) {
      return;
    }

    setImportError("");
    setImportResult(null);
    setUploading(true);

    try {
      if (editingManualBatch) {
        const newScreenshotIndex = normalizedRows.findIndex((row) => row.screenshotFile !== null);
        if (newScreenshotIndex >= 0) {
          throw new Error(
            `第 ${newScreenshotIndex + 1} 条含新截图文件，当前批次编辑仅支持保留已存在截图，不支持新增截图上传`
          );
        }

        const response = await fetch(`${API_BASE}/imports/${editingManualBatch.batchId}/manual-rows`, {
          method: "PUT",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            rows: normalizedRows.map((row) => ({
              id: row.recordId || undefined,
              direction: row.direction,
              transactionTime: row.transactionTimeIso ?? undefined,
              amount: Math.abs(row.amountNum),
              description: row.description,
              billAccount: row.billAccount,
              screenshot: row.existingScreenshot ?? undefined
            }))
          })
        });

        if (!response.ok) {
          const body = (await response.json()) as { message?: string };
          throw new Error(body.message ?? "手动批次更新失败");
        }

        const body = (await response.json()) as ImportReport;
        setImportResult(body);
        setEditingManualBatch(null);
        resetManualImportRows();
        setManualImportText(MANUAL_BULK_HEADER_TEXT);
        clearImportFileSelection();
        void fetchAccountOptions();
        void fetchImportBatches(importBatchesPage);
      } else {
        const formData = new FormData();
        const payloadRows = normalizedRows.map((row, index) => {
          const screenshotField = row.screenshotFile ? `screenshot_${index}` : undefined;
          if (screenshotField && row.screenshotFile) {
            formData.append(screenshotField, row.screenshotFile);
          }
          return {
            direction: row.direction,
            transactionTime: row.transactionTimeIso ?? undefined,
            amount: Math.abs(row.amountNum),
            description: row.description,
            billAccount: row.billAccount || undefined,
            screenshotField
          };
        });

        formData.append(
          "payload",
          JSON.stringify({
            fileName: "manual-form",
            rows: payloadRows
          })
        );

        const response = await fetch(`${API_BASE}/imports/manual`, {
          method: "POST",
          body: formData
        });
        if (!response.ok) {
          const body = (await response.json()) as { message?: string };
          throw new Error(body.message ?? "手动导入失败");
        }

        const body = (await response.json()) as ImportReport;
        setImportResult(body);
        resetManualImportRows();
        setManualImportText(MANUAL_BULK_HEADER_TEXT);
        clearImportFileSelection();
        void fetchAccountOptions();
        void fetchImportBatches(1);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "手动导入/更新失败");
    } finally {
      setUploading(false);
    }
  }

  function buildTransactionFilterQuery(input: TransactionFilterInput): URLSearchParams {
    const query = buildDateFilterQuery(reportFilterToDateRange(input.start, input.end));
    if (input.billAccount) {
      query.set("billAccount", input.billAccount);
    }
    if (input.category) {
      query.set("category", input.category);
    }
    if (input.status) {
      query.set("status", input.status);
    }
    if (input.direction) {
      query.set("direction", input.direction);
    }
    return query;
  }

  async function queryTransactionSummary(input: TransactionFilterInput): Promise<TransactionQuerySummary> {
    const query = buildTransactionFilterQuery(input);
    const response = await fetch(`${API_BASE}/transactions/summary?${query.toString()}`);
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "查询汇总失败");
    }

    const body = (await response.json()) as Partial<TransactionQuerySummary>;
    return {
      totalCount: body.totalCount ?? 0,
      incomeCount: body.incomeCount ?? 0,
      expenseCount: body.expenseCount ?? 0,
      successCount: body.successCount ?? 0,
      pendingCount: body.pendingCount ?? 0,
      incomeAmount: body.incomeAmount ?? "0.00",
      expenseAmount: body.expenseAmount ?? "0.00",
      netAmount: body.netAmount ?? "0.00"
    };
  }

  async function queryTransactionCharts(): Promise<TransactionChartsData> {
    const query = buildDateFilterQuery(reportFilterToDateRange(chartFilters.start, chartFilters.end));
    if (chartFilters.billAccount) {
      query.set("billAccount", chartFilters.billAccount);
    }

    const response = await fetch(`${API_BASE}/transactions/charts?${query.toString()}`);
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "图表数据查询失败");
    }

    const body = (await response.json()) as Partial<TransactionChartsData>;
    return {
      totalCount: body.totalCount ?? 0,
      byCategory: body.byCategory ?? [],
      byBillAccount: body.byBillAccount ?? [],
      byDay: body.byDay ?? [],
      byStatus: body.byStatus ?? [],
      byDirection: body.byDirection ?? []
    };
  }

  async function fetchTransactionCharts() {
    setChartLoading(true);
    setChartError("");

    try {
      const data = await queryTransactionCharts();
      setChartData(data);
    } catch (error) {
      setChartError(error instanceof Error ? error.message : "图表数据查询失败");
    } finally {
      setChartLoading(false);
    }
  }

  function buildChartBaseDetailFilters(): ChartDetailFilters {
    const dateRange = reportFilterToDateRange(chartFilters.start, chartFilters.end);
    const base: ChartDetailFilters = {
      ...dateRange
    };
    if (chartFilters.billAccount) {
      base.billAccount = chartFilters.billAccount;
    }
    return base;
  }

  async function fetchChartDetail(input: ChartDetailFilters | null, page = 1) {
    if (!input) {
      return;
    }

    setChartDetailLoading(true);
    setChartDetailError("");

    try {
      const dateRange: { start?: string; end?: string } = {};
      if (input.start) {
        dateRange.start = input.start;
      }
      if (input.end) {
        dateRange.end = input.end;
      }
      const query = buildDateFilterQuery(dateRange);
      if (input.billAccount) {
        query.set("billAccount", input.billAccount);
      }
      if (input.category) {
        query.set("category", input.category);
      }
      if (input.status) {
        query.set("status", input.status);
      }
      if (input.direction) {
        query.set("direction", input.direction);
      }
      query.set("page", String(page));
      query.set("pageSize", chartDetailPageSize);

      const response = await fetch(`${API_BASE}/transactions?${query.toString()}`);
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "加载图表明细失败");
      }

      const body = (await response.json()) as TransactionResponse;
      setChartDetailRows(body);
    } catch (error) {
      setChartDetailError(error instanceof Error ? error.message : "加载图表明细失败");
    } finally {
      setChartDetailLoading(false);
    }
  }

  function openChartDetail(title: string, input: ChartDetailFilters) {
    setChartDetailVisible(true);
    setChartDetailTitle(title);
    setChartDetailFilters(input);
    setChartDetailRows(null);
    setChartDetailError("");
    void fetchChartDetail(input, 1);
  }

  function closeChartDetail() {
    setChartDetailVisible(false);
    setChartDetailTitle("");
    setChartDetailFilters(null);
    setChartDetailRows(null);
    setChartDetailError("");
  }

  async function fetchTransactions(page = detailsPage) {
    setLoadingRows(true);
    setRowsError("");

    try {
      const input: TransactionFilterInput = {
        start: filters.start,
        end: filters.end,
        billAccount: filters.billAccount,
        category: filters.category,
        status: filters.status
      };
      const query = buildTransactionFilterQuery(input);
      query.set("page", String(page));
      query.set("pageSize", filters.pageSize);

      const [rowsResponse, summary] = await Promise.all([
        fetch(`${API_BASE}/transactions?${query.toString()}`),
        queryTransactionSummary(input)
      ]);

      if (!rowsResponse.ok) {
        const body = (await rowsResponse.json()) as { message?: string };
        throw new Error(body.message ?? "查询失败");
      }

      const body = (await rowsResponse.json()) as TransactionResponse;
      setRows(body);
      setTransactionSummary(summary);
      setDetailsPage(body.page);
    } catch (error) {
      setRowsError(error instanceof Error ? error.message : "查询失败");
    } finally {
      setLoadingRows(false);
    }
  }

  async function fetchTransactionDetailById(id: string) {
    setTransactionDetailLoading(true);
    setRowsError("");
    try {
      const response = await fetch(`${API_BASE}/transactions/${id}`);
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "交易详情加载失败");
      }

      const body = (await response.json()) as TransactionDetailResponse;
      setTransactionDetail({
        id: body.id ?? "",
        transactionTime: body.transactionTime ?? "",
        billAccount: body.billAccount ?? "",
        description: body.description ?? "",
        direction: body.direction ?? "neutral",
        amount: body.amount ?? "0.00",
        status: body.status ?? "",
        category: body.category ?? "other",
        orderId: body.orderId ?? "",
        internalTransfer: body.internalTransfer ?? false,
        deletable: body.deletable ?? true,
        merchantOrderId: body.merchantOrderId ?? "",
        remark: body.remark ?? "",
        incrementalSettledAt: body.incrementalSettledAt ?? null,
        incrementalSettlementBatchId: body.incrementalSettlementBatchId ?? null,
        rawRowJson: body.rawRowJson ?? {},
        screenshotUrl: body.screenshot?.url ? resolveApiResourceUrl(body.screenshot.url) : null,
        screenshotFileName: body.screenshot?.fileName ?? "",
        screenshotMimeType: body.screenshot?.mimeType ?? "",
        screenshotStoragePath: body.screenshot?.storagePath ?? ""
      });
    } catch (error) {
      setRowsError(error instanceof Error ? error.message : "交易详情加载失败");
    } finally {
      setTransactionDetailLoading(false);
    }
  }

  async function deleteTransactionById(id: string) {
    const confirmed = window.confirm("确定删除该记录？已被增量分润标记的记录不能删除。");
    if (!confirmed) {
      return;
    }

    setDeletingTransactionId(id);
    setRowsError("");
    try {
      const response = await fetch(`${API_BASE}/transactions/${id}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "删除失败");
      }

      if (transactionDetail?.id === id) {
        setTransactionDetail(null);
      }
      await fetchTransactions(detailsPage);
    } catch (error) {
      setRowsError(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeletingTransactionId(null);
    }
  }

  async function queryAccountOptions(): Promise<Array<{ billAccount: string; count: number }>> {
    const response = await fetch(`${API_BASE}/accounts`);
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "账单账号查询失败");
    }

    const body = (await response.json()) as AccountResponse;
    return body.items;
  }

  async function fetchAccountOptions() {
    try {
      const items = await queryAccountOptions();
      setAccountOptions(items);
      setAccountError("");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "账单账号查询失败");
    }
  }

  async function queryImportBatches(page: number, pageSize = 10): Promise<ImportBatchListResponse> {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });
    const response = await fetch(`${API_BASE}/imports?${query.toString()}`);
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "导入记录查询失败");
    }
    const body = (await response.json()) as ImportBatchListResponse;
    return {
      total: body.total ?? 0,
      page: body.page ?? page,
      pageSize: body.pageSize ?? pageSize,
      items: body.items ?? []
    };
  }

  async function fetchImportBatches(page = importBatchesPage) {
    setImportBatchesLoading(true);
    setImportBatchesError("");
    try {
      const result = await queryImportBatches(page);
      setImportBatches(result);
      setImportBatchesPage(result.page);
    } catch (error) {
      setImportBatchesError(error instanceof Error ? error.message : "导入记录查询失败");
    } finally {
      setImportBatchesLoading(false);
    }
  }

  async function loadManualBatchForEdit(batchId: string, fileName: string) {
    setImportError("");
    setImportResult(null);
    setUploading(true);
    try {
      const response = await fetch(`${API_BASE}/imports/${batchId}/manual-rows`);
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "手动批次加载失败");
      }

      const body = (await response.json()) as ManualBatchRowsResponse;
      if (body.locked) {
        throw new Error("该批次存在已分润标记记录，不能批量编辑");
      }

      const rows = (body.items ?? []).map((item) => ({
        tempId: createTempId(),
        recordId: item.id,
        direction: item.direction,
        transactionTime: toDateTimeInputValue(new Date(item.transactionTime)),
        amount: normalizeManualAmountInput(item.amount),
        description: item.description,
        billAccount: item.billAccount,
        screenshotFile: null,
        existingScreenshot: item.screenshot ?? null
      }));

      setManualImportRows(
        rows.length > 0
          ? rows
          : [
              {
                tempId: createTempId(),
                direction: "income",
                transactionTime: toDateTimeInputValue(new Date()),
                amount: "",
                description: "",
                billAccount: accountOptions[0]?.billAccount ?? "",
                screenshotFile: null,
                existingScreenshot: null
              }
            ]
      );
      setEditingManualBatch({
        batchId,
        fileName
      });
      setImportMode("manual");
      setManualImportText(MANUAL_BULK_HEADER_TEXT);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "手动批次加载失败");
    } finally {
      setUploading(false);
    }
  }

  function cancelManualBatchEditing() {
    setEditingManualBatch(null);
    resetManualImportRows();
    setImportError("");
  }

  async function queryProfitParticipants(): Promise<ProfitParticipantItem[]> {
    const response = await fetch(`${API_BASE}/profit-participants`);
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "分润者配置查询失败");
    }

    const body = (await response.json()) as ProfitParticipantsResponse;
    return body.items;
  }

  async function fetchParticipants() {
    setParticipantsLoading(true);
    try {
      const items = await queryProfitParticipants();
      setParticipantRows(items.map(toParticipantFormItem));
      setParticipantsError("");
    } catch (error) {
      setParticipantsError(error instanceof Error ? error.message : "分润者配置查询失败");
    } finally {
      setParticipantsLoading(false);
    }
  }

  async function saveParticipants(nextRows = participantRows) {
    setParticipantsSaving(true);
    setParticipantsError("");

    try {
      const items = nextRows.map((item) => ({
        id: item.id,
        name: item.name.trim(),
        billAccount: item.billAccount.trim() || undefined,
        ratio: normalizePercentDecimalInput(item.ratioPercent) / 100,
        note: item.note.trim() || undefined
      }));

      const response = await fetch(`${API_BASE}/profit-participants`, {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ items })
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "分润者配置保存失败");
      }

      const body = (await response.json()) as ProfitParticipantsResponse;
      setParticipantRows(body.items.map(toParticipantFormItem));
      if (isSettlementTab) {
        await fetchSettlementPreview(activeSettlementStrategy);
      }
    } catch (error) {
      setParticipantsError(error instanceof Error ? error.message : "分润者配置保存失败");
    } finally {
      setParticipantsSaving(false);
    }
  }

  function updateParticipantRow(tempId: string, updater: (prev: ParticipantFormItem) => ParticipantFormItem) {
    setParticipantRows((prev) => prev.map((item) => (item.tempId === tempId ? updater(item) : item)));
  }

  function addManualParticipantRow() {
    setParticipantRows((prev) => [
      ...prev,
      {
        tempId: createTempId(),
        name: "",
        billAccount: "",
        ratioPercent: "0",
        note: ""
      }
    ]);
  }

  function addAccountParticipantRow() {
    const usedAccounts = new Set(
      participantRows.map((item) => item.billAccount).filter((value) => value.length > 0)
    );
    const candidate = accountOptions.find((item) => !usedAccounts.has(item.billAccount));
    if (!candidate) {
      setParticipantsError("没有可新增的账单账号（每个账号只能绑定一个分润者）");
      return;
    }

    setParticipantRows((prev) => [
      ...prev,
      {
        tempId: createTempId(),
        name: candidate.billAccount,
        billAccount: candidate.billAccount,
        ratioPercent: "0",
        note: ""
      }
    ]);
    setParticipantsError("");
  }

  function removeParticipantRow(tempId: string) {
    setParticipantRows((prev) => prev.filter((item) => item.tempId !== tempId));
  }

  async function handleSaveParticipants() {
    if (participantRows.length === 0) {
      setParticipantsError("至少保留一个分润者");
      return;
    }

    if (!isParticipantRatioValid) {
      setParticipantsError(`当前比例合计为 ${formatPercent(participantRatioTotal)}%，必须等于 100%`);
      return;
    }

    const hasEmptyName = participantRows.some((item) => !item.name.trim());
    if (hasEmptyName) {
      setParticipantsError("分润者名称不能为空");
      return;
    }

    await saveParticipants(participantRows);
  }

  async function queryProfitSummary(): Promise<ProfitSummary> {
    const query = buildDateFilterQuery(reportFilterToDateRange(reportFilters.start, reportFilters.end));
    if (reportFilters.billAccount) {
      query.set("billAccount", reportFilters.billAccount);
    }

    const response = await fetch(`${API_BASE}/reports/profit?${query.toString()}`);
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "统计查询失败");
    }

    const body = (await response.json()) as { summary: ProfitSummary };
    return body.summary;
  }

  async function queryProfitDetails(
    metric: ProfitMetric,
    page = reportDetailPage,
    pageSize = Number(reportDetailPageSize)
  ): Promise<TransactionResponse> {
    const query = buildDateFilterQuery(reportFilterToDateRange(reportFilters.start, reportFilters.end));
    query.set("metric", metric);
    query.set("page", String(page));
    query.set("pageSize", String(pageSize));
    if (reportFilters.billAccount) {
      query.set("billAccount", reportFilters.billAccount);
    }

    const response = await fetch(`${API_BASE}/reports/profit/details?${query.toString()}`);
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "明细查询失败");
    }

    return (await response.json()) as TransactionResponse;
  }

  async function fetchProfitSummary() {
    setReportLoading(true);
    setReportError("");

    try {
      const nextSummary = await queryProfitSummary();
      setSummary(nextSummary);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "统计查询失败");
    } finally {
      setReportLoading(false);
    }
  }

  async function fetchProfitDetails(page = reportDetailPage) {
    setReportLoading(true);
    setReportError("");

    try {
      const rowsData = await queryProfitDetails(detailMetric, page);
      setDetailRows(rowsData);
      setReportDetailPage(rowsData.page);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "明细查询失败");
    } finally {
      setReportLoading(false);
    }
  }

  async function loadReportDefaultData() {
    setReportLoading(true);
    setReportError("");

    try {
      const [nextSummary, nextDetails] = await Promise.all([
        queryProfitSummary(),
        queryProfitDetails(detailMetric, 1)
      ]);
      setSummary(nextSummary);
      setDetailRows(nextDetails);
      setReportDetailPage(nextDetails.page);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "统计查询失败");
    } finally {
      setReportLoading(false);
    }
  }

  async function querySettlementPreview(
    strategy: SettlementStrategy,
    billAccount?: string
  ): Promise<SettlementPreview> {
    const query = new URLSearchParams();
    if (settlementTime) {
      query.set("settlementTime", toSettlementEndOfDayIso(settlementTime));
    }
    const carryPercent = normalizePercentInput(settlementCarryPercent);
    query.set("strategy", strategy);
    if (billAccount !== undefined) {
      query.set("billAccount", billAccount);
    }
    query.set("carryRatio", String(carryPercent / 100));

    const response = await fetch(`${API_BASE}/settlements/preview?${query.toString()}`);
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "分润预览失败");
    }

    const body = (await response.json()) as SettlementPreviewApiResponse;
    const missingRequiredField =
      body.strategy === undefined ||
      body.billAccount === undefined ||
      body.settlementTime === undefined ||
      body.carryRatio === undefined ||
      body.periodNetAmount === undefined ||
      body.previousCarryForwardAmount === undefined ||
      body.cumulativeNetAmount === undefined ||
      body.settledBaseAmount === undefined ||
      body.distributableAmount === undefined ||
      body.paidAmount === undefined ||
      body.carryForwardAmount === undefined ||
      body.cumulativeSettledAmount === undefined ||
      body.allocationBaseAmount === undefined ||
      body.allocations === undefined;
    if (missingRequiredField) {
      throw new Error("后端 API 版本过旧，请重启后端服务后重试");
    }

    return {
      strategy: body.strategy!,
      billAccount: body.billAccount!,
      settlementTime: body.settlementTime!,
      carryRatio: `${ratioTextToPercentText(body.carryRatio)}%`,
      periodNetAmount: body.periodNetAmount!,
      previousCarryForwardAmount: body.previousCarryForwardAmount!,
      cumulativeNetAmount: body.cumulativeNetAmount!,
      settledBaseAmount: body.settledBaseAmount!,
      distributableAmount: body.distributableAmount!,
      paidAmount: body.paidAmount!,
      carryForwardAmount: body.carryForwardAmount!,
      cumulativeSettledAmount: body.cumulativeSettledAmount!,
      effectiveBatchId: body.effectiveBatchId ?? null,
      effectiveBatchNo: body.effectiveBatchNo ?? null,
      allocationBaseAmount: body.allocationBaseAmount!,
      allocations: (body.allocations ?? []).map((item) => ({
        participantId: item.participantId ?? "",
        participantName: item.participantName ?? "-",
        participantBillAccount: item.participantBillAccount ?? null,
        ratioPercent: `${ratioTextToPercentText(item.ratio)}%`,
        amount: item.amount ?? "0.00",
        accountHeldAmount: item.accountHeldAmount ?? "0.00",
        actualTransferAmount: item.actualTransferAmount ?? "0.00",
        note: item.note ?? ""
      }))
    };
  }

  async function querySettlementBatches(
    strategy: SettlementStrategy,
    billAccount?: string
  ): Promise<SettlementBatch[]> {
    const query = new URLSearchParams();
    query.set("strategy", strategy);
    if (billAccount !== undefined) {
      query.set("billAccount", billAccount);
    }

    const response = await fetch(`${API_BASE}/settlements?${query.toString()}`);
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "分润台账查询失败");
    }

    const body = (await response.json()) as { items: SettlementBatchResponse[] };
    return body.items.map((item) => ({
      id: item.id ?? "",
      batchNo: item.batchNo ?? "-",
      strategy: item.strategy ?? strategy,
      billAccount: item.billAccount ?? "",
      settlementTime: item.settlementTime ?? new Date().toISOString(),
      carryRatio: `${ratioTextToPercentText(item.carryRatio)}%`,
      periodNetAmount: item.periodNetAmount ?? "0.00",
      previousCarryForwardAmount: item.previousCarryForwardAmount ?? "0.00",
      cumulativeNetAmount: item.cumulativeNetAmount ?? "0.00",
      settledBaseAmount: item.settledBaseAmount ?? "0.00",
      distributableAmount: item.distributableAmount ?? "0.00",
      paidAmount: item.paidAmount ?? "0.00",
      carryForwardAmount: item.carryForwardAmount ?? "0.00",
      cumulativeSettledAmount: item.cumulativeSettledAmount ?? "0.00",
      note: item.note ?? "",
      isEffective: item.isEffective ?? false,
      createdAt: item.createdAt ?? new Date().toISOString(),
      allocations: (item.allocations ?? []).map((allocation) => ({
        participantId: allocation.participantId ?? "",
        participantName: allocation.participantName ?? "-",
        participantBillAccount: allocation.participantBillAccount ?? null,
        ratioPercent: `${ratioTextToPercentText(allocation.ratio)}%`,
        amount: allocation.amount ?? "0.00",
        accountHeldAmount: allocation.accountHeldAmount ?? "0.00",
        actualTransferAmount: allocation.actualTransferAmount ?? "0.00",
        note: allocation.note ?? ""
      }))
    }));
  }

  async function fetchSettlementPreview(strategy: SettlementStrategy) {
    const shouldLoadDetail = Boolean(settlementDetailBillAccount);
    setSettlementLoading(true);
    setSettlementError("");
    if (shouldLoadDetail) {
      setSettlementDetailLoading(true);
    }

    try {
      const [preview, detailPreview] = await Promise.all([
        querySettlementPreview(strategy),
        shouldLoadDetail
          ? querySettlementPreview(strategy, settlementDetailBillAccount)
          : Promise.resolve(null)
      ]);
      setSettlementPreview(preview);
      if (shouldLoadDetail) {
        setSettlementDetailPreview(detailPreview);
      }
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : "分润预览失败");
    } finally {
      setSettlementLoading(false);
      if (shouldLoadDetail) {
        setSettlementDetailLoading(false);
      }
    }
  }

  async function fetchSettlementDetailPreview(strategy: SettlementStrategy, billAccount: string) {
    if (!billAccount) {
      setSettlementDetailPreview(null);
      return;
    }

    setSettlementDetailLoading(true);
    setSettlementError("");
    try {
      const preview = await querySettlementPreview(strategy, billAccount);
      setSettlementDetailPreview(preview);
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : "分润明细预览失败");
    } finally {
      setSettlementDetailLoading(false);
    }
  }

  async function fetchSettlementBatches(strategy: SettlementStrategy) {
    try {
      const batches = await querySettlementBatches(strategy);
      setSettlementBatches(batches);
      setExpandedSettlementBatchIds({});
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : "分润台账查询失败");
    }
  }

  async function loadSettlementDefaultData(strategy: SettlementStrategy) {
    setSettlementLoading(true);
    setSettlementError("");

    try {
      const [preview, batches] = await Promise.all([
        querySettlementPreview(strategy),
        querySettlementBatches(strategy)
      ]);
      setSettlementPreview(preview);
      setSettlementBatches(batches);
      setExpandedSettlementBatchIds({});

      if (settlementDetailBillAccount) {
        const detailPreview = await querySettlementPreview(strategy, settlementDetailBillAccount);
        setSettlementDetailPreview(detailPreview);
      } else {
        setSettlementDetailPreview(null);
      }
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : "分润加载失败");
    } finally {
      setSettlementLoading(false);
    }
  }

  async function createSettlement(strategy: SettlementStrategy) {
    setSettlementError("");

    let preview: SettlementPreview;
    try {
      preview = await querySettlementPreview(strategy);
      setSettlementPreview(preview);
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : "分润预览失败");
      return;
    }

    const firstConfirm = window.confirm("将基于当前预览创建分润批次，且历史批次不允许删除，是否继续？");
    if (!firstConfirm) {
      return;
    }

    const secondConfirm = window.confirm(
      `二次确认：本次可分润 ${preview.distributableAmount}，实发 ${preview.paidAmount}，留存 ${preview.carryForwardAmount}，留存比例 ${preview.carryRatio}。确认创建？`
    );
    if (!secondConfirm) {
      return;
    }

    setSettlementLoading(true);
    try {
      const response = await fetch(`${API_BASE}/settlements`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          settlementTime: settlementTime ? toSettlementEndOfDayIso(settlementTime) : undefined,
          strategy,
          carryRatio: normalizePercentInput(settlementCarryPercent) / 100,
          note: settlementNote || undefined
        })
      });

      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "创建分润批次失败");
      }

      await fetchSettlementBatches(strategy);
      await fetchSettlementPreview(strategy);
      setSettlementNote("");
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : "创建分润批次失败");
    } finally {
      setSettlementLoading(false);
    }
  }

  const chartCategorySource = chartData?.byCategory.slice(0, 10) ?? [];
  const chartBillAccountSource = chartData?.byBillAccount.slice(0, 10) ?? [];
  const chartDaySource = [...(chartData?.byDay ?? [])].sort((left, right) =>
    right.day.localeCompare(left.day)
  );
  const chartStatusSource = chartData?.byStatus ?? [];
  const chartDirectionSource = chartData?.byDirection ?? [];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-3 py-5 sm:px-6">
      <header className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">闲鱼账单与分润管理台</h1>
            <p className="text-sm text-[var(--muted)]">
              已实现导入、明细、统计汇总、累计分润与增量分润（含留存）
            </p>
          </div>
          <div className="inline-flex flex-wrap rounded-xl border border-[var(--border)] bg-[var(--brand-soft)] p-1">
            <TabButton tab={tab} target="import" label="导入页" onClick={setTab} />
            <TabButton tab={tab} target="details" label="明细页" onClick={setTab} />
            <TabButton tab={tab} target="charts" label="图表页" onClick={setTab} />
            <TabButton tab={tab} target="report" label="统计页" onClick={setTab} />
            <TabButton tab={tab} target="settings" label="分润设置页" onClick={setTab} />
            <TabButton tab={tab} target="settlement_cumulative" label="累计分润页" onClick={setTab} />
            {/* <TabButton tab={tab} target="settlement_incremental" label="增量分润页" onClick={setTab} /> */}
          </div>
        </div>
      </header>

      {accountError ? <ErrorMessage message={accountError} /> : null}

      {tab === "import" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
          <div className="mb-4 inline-flex rounded-xl border border-[var(--border)] bg-[var(--brand-soft)] p-1">
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${
                importMode === "file" ? "bg-[var(--brand)] text-white" : "text-[var(--text)]"
              }`}
              onClick={() => {
                setImportMode("file");
                setEditingManualBatch(null);
              }}
            >
              上传账单文件
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${
                importMode === "manual" ? "bg-[var(--brand)] text-white" : "text-[var(--text)]"
              }`}
              onClick={() => setImportMode("manual")}
            >
              手动录入与校对
            </button>
          </div>

          {importMode === "file" ? (
            <form className="grid gap-4" onSubmit={handleFileImport}>
              <label className="grid gap-2 text-sm font-medium">
                选择账单文件（支付宝原始账单/普通账单）
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
                  className="rounded-xl border border-[var(--border)] bg-white px-3 py-2"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <p className="text-xs text-[var(--muted)]">支持 `CSV/TXT/TSV`，并兼容空行与连续换行。</p>

              <button
                type="submit"
                disabled={uploading || !selectedFile}
                className="inline-flex w-fit items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {uploading ? <RefreshCw className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {uploading ? "导入中..." : "上传并导入"}
              </button>
            </form>
          ) : null}

          {importMode === "manual" ? (
            <form className="grid gap-4" onSubmit={handleManualRowsImport}>
              <p className="text-xs text-[var(--muted)]">
                状态默认按 `交易成功` 处理，分类默认按 `手动添加` 处理。仅批量解析时会根据金额正负自动判定收支，填充后金额统一为正数，表格内修改金额不会联动收支。
              </p>
              {editingManualBatch ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span>
                    正在编辑手动批次：`{editingManualBatch.batchId}`（{editingManualBatch.fileName}）
                  </span>
                  <button
                    type="button"
                    className="rounded-lg border border-amber-300 px-3 py-1 text-xs"
                    onClick={cancelManualBatchEditing}
                  >
                    取消批次编辑
                  </button>
                </div>
              ) : null}
              <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-slate-50 p-3">
                <label className="grid gap-2 text-sm font-medium">
                  批量填充文本
                  <textarea
                    value={manualImportText}
                    rows={8}
                    className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 font-mono text-sm"
                    placeholder={[
                      "金额  说明  时间 账号",
                      "40    codex40元90刀月卡    2026-02-16 10:30:00    foo@example.com",
                      "-200  netcup服务器新购1个月",
                      "-30   codex40元90刀月卡退款30元    2026-02-16 11:00:00"
                    ].join("\n")}
                    onChange={(event) => setManualImportText(event.target.value)}
                  />
                </label>
                <p className="text-xs text-[var(--muted)]">
                  示例：40    codex40元90刀月卡    2026-02-16 10:30:00    foo@example.com
                </p>
                <p className="text-xs text-[var(--muted)]">
                  仅支持列顺序：`金额`、`说明`、`时间`、`账号`。其中金额和说明必填；时间缺失自动补当前时间；账号缺失可先填充到表格，提交前需补齐。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                    onClick={handleFillManualRowsFromText}
                  >
                    批量填充到表格
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                    onClick={() => setManualImportText(MANUAL_BULK_HEADER_TEXT)}
                  >
                    清空文本
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-slate-100 text-left text-xs text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2">收支</th>
                      <th className="px-3 py-2">交易时间</th>
                      <th className="px-3 py-2">金额</th>
                      <th className="px-3 py-2">说明</th>
                      <th className="px-3 py-2">截图上传</th>
                      <th className="px-3 py-2">账单账号</th>
                      <th className="sticky right-0 z-10 bg-slate-100 px-3 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualImportRows.map((row) => (
                      <tr key={row.tempId} className="border-t border-[var(--border)] bg-white">
                        <td className="px-3 py-2 min-w-[120px]">
                          <select
                            value={row.direction}
                            className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                            onChange={(event) =>
                              updateManualImportRow(row.tempId, (current) => ({
                                ...current,
                                direction: event.target.value as "income" | "expense"
                              }))
                            }
                          >
                            <option value="income">收入</option>
                            <option value="expense">支出</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 min-w-[220px]">
                          <input
                            type="datetime-local"
                            value={row.transactionTime}
                            className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                            onChange={(event) =>
                              updateManualImportRow(row.tempId, (current) => ({
                                ...current,
                                transactionTime: event.target.value
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2 min-w-[140px]">
                          <input
                            type="number"
                            step="0.01"
                            value={row.amount}
                            className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                            placeholder="例如 88.00"
                            onChange={(event) =>
                              updateManualImportRow(row.tempId, (current) => ({
                                ...current,
                                amount: normalizeManualAmountInput(event.target.value)
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2 min-w-[260px]">
                          <input
                            type="text"
                            value={row.description}
                            className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                            placeholder="请输入说明"
                            onChange={(event) =>
                              updateManualImportRow(row.tempId, (current) => ({
                                ...current,
                                description: event.target.value
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2 min-w-[220px]">
                          <input
                            type="file"
                            accept="image/*"
                            disabled={Boolean(editingManualBatch)}
                            className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                            onChange={(event) =>
                              updateManualImportRow(row.tempId, (current) => ({
                                ...current,
                                screenshotFile: event.target.files?.[0] ?? null
                              }))
                            }
                          />
                          {row.existingScreenshot ? (
                            <a
                              className="mt-1 inline-block text-xs text-blue-700 underline"
                              href={resolveApiResourceUrl(
                                row.existingScreenshot.url ??
                                  `/api/transactions/${row.recordId ?? ""}/screenshot`
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              查看已存在截图：{row.existingScreenshot.fileName}
                            </a>
                          ) : null}
                          {editingManualBatch ? (
                            <p className="mt-1 text-xs text-[var(--muted)]">批次编辑模式下不支持新增截图</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 min-w-[220px]">
                          <input
                            list="manual-import-bill-account-options"
                            type="text"
                            value={row.billAccount}
                            className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                            placeholder="可选择或手动输入"
                            onChange={(event) =>
                              updateManualImportRow(row.tempId, (current) => ({
                                ...current,
                                billAccount: event.target.value
                              }))
                            }
                          />
                        </td>
                        <td className="sticky right-0 bg-white px-3 py-2 whitespace-nowrap">
                          <button
                            type="button"
                            className="rounded-lg border border-red-200 px-3 py-1 text-red-700"
                            onClick={() => removeManualImportRow(row.tempId)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <datalist id="manual-import-bill-account-options">
                {accountOptions.map((item) => (
                  <option key={item.billAccount} value={item.billAccount} />
                ))}
              </datalist>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                  onClick={addManualImportRow}
                >
                  新增一条
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="inline-flex w-fit items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {uploading ? <RefreshCw className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {uploading ? "处理中..." : editingManualBatch ? "保存批次更新" : "导入手动记录"}
                </button>
              </div>
            </form>
          ) : null}

          {importError ? <ErrorMessage message={importError} /> : null}

          {importResult ? (
            <div className="mt-5 grid gap-4">
              <div className="rounded-xl border border-[var(--border)] bg-slate-50 p-4">
                <p className="text-sm text-[var(--muted)]">批次号：{importResult.batchId}</p>
                <p className="text-sm text-[var(--muted)]">账单账号：{importResult.billAccount}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <MetricCard label="解析总数" value={String(importResult.totalParsed)} />
                  <MetricCard label="符合条件数" value={String(importResult.qualifiedCount)} />
                  <MetricCard label="来源类型" value={importResult.sourceType} />
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] p-4">
                <h2 className="mb-3 text-sm font-semibold">分类统计</h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(importResult.byCategory).map(([category, count]) => (
                    <div
                      key={category}
                      className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
                    >
                      <span>{CATEGORY_LABEL[category as Category] ?? category}</span>
                      <span className="font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-6 rounded-xl border border-[var(--border)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">导入记录</h2>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1 text-sm"
                onClick={() => void fetchImportBatches(importBatchesPage)}
                disabled={importBatchesLoading}
              >
                {importBatchesLoading ? "刷新中..." : "刷新"}
              </button>
            </div>

            {importBatchesError ? <ErrorMessage message={importBatchesError} /> : null}

            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-left text-xs text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">导入时间</th>
                    <th className="px-3 py-2">批次号</th>
                    <th className="px-3 py-2">来源类型</th>
                    <th className="px-3 py-2">文件名</th>
                    <th className="px-3 py-2">账单账号</th>
                    <th className="px-3 py-2">解析/入库</th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(importBatches?.items ?? []).map((item) => (
                    <tr key={item.id} className="border-t border-[var(--border)] bg-white">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(item.importedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.batchId}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.sourceType}</td>
                      <td className="px-3 py-2 min-w-[220px]">{item.originalFileName ?? item.fileName}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatBillAccountLabel(item.billAccount)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {item.totalParsed} / {item.qualifiedCount}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.hasUploadedFile && item.downloadPath ? (
                            <a
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                              href={resolveApiResourceUrl(item.downloadPath)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Download className="size-3.5" />
                              下载文件
                            </a>
                          ) : (
                            <span className="text-xs text-[var(--muted)]">无原文件</span>
                          )}

                          {item.sourceType === "manual_form" ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                              onClick={() => void loadManualBatchForEdit(item.batchId, item.fileName)}
                              disabled={uploading}
                            >
                              <Eye className="size-3.5" />
                              查看并编辑批次
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(importBatches?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-[var(--muted)]" colSpan={7}>
                        {importBatchesLoading ? "导入记录加载中..." : "暂无导入记录"}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {importBatches ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
                <span>
                  共 {importBatches.total} 条，当前页 {importBatches.page}/
                  {Math.max(1, Math.ceil(importBatches.total / importBatches.pageSize))}
                </span>
                <button
                  type="button"
                  disabled={importBatchesLoading || importBatches.page <= 1}
                  onClick={() => void fetchImportBatches(importBatches.page - 1)}
                  className="rounded-lg border border-[var(--border)] px-3 py-1 disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={
                    importBatchesLoading ||
                    importBatches.page >= Math.max(1, Math.ceil(importBatches.total / importBatches.pageSize))
                  }
                  onClick={() => void fetchImportBatches(importBatches.page + 1)}
                  className="rounded-lg border border-[var(--border)] px-3 py-1 disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "details" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              setDetailsPage(1);
              void fetchTransactions(1);
            }}
          >
            <label className="grid gap-1 text-sm">
              开始日期
              <input
                type="date"
                value={filters.start}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) => setFilters((prev) => ({ ...prev, start: event.target.value }))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              结束日期
              <input
                type="date"
                value={filters.end}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) => setFilters((prev) => ({ ...prev, end: event.target.value }))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              账单账号
              <select
                value={filters.billAccount}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) => setFilters((prev) => ({ ...prev, billAccount: event.target.value }))}
              >
                <option value="">全部账号</option>
                {accountOptions.map((item) => (
                  <option key={item.billAccount} value={item.billAccount}>
                    {formatBillAccountLabel(item.billAccount)}（{item.count}）
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              分类
              <select
                value={filters.category}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))}
              >
                <option value="">全部</option>
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              状态
              <input
                type="text"
                value={filters.status}
                placeholder="例如 交易成功"
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              每页条数
              <select
                value={filters.pageSize}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) => {
                  setFilters((prev) => ({ ...prev, pageSize: event.target.value }));
                  setDetailsPage(1);
                }}
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <button
                type="submit"
                disabled={loadingRows}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                <WalletCards className="size-4" />
                {loadingRows ? "查询中..." : "查询明细"}
              </button>
            </div>
          </form>

          {transactionSummary ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="筛选总笔数" value={String(transactionSummary.totalCount)} />
              <MetricCard label="收入金额合计" value={transactionSummary.incomeAmount} />
              <MetricCard label="支出金额合计" value={transactionSummary.expenseAmount} />
              <MetricCard label="净额合计" value={transactionSummary.netAmount} />
              <MetricCard label="收入笔数" value={String(transactionSummary.incomeCount)} />
              <MetricCard label="支出笔数" value={String(transactionSummary.expenseCount)} />
              <MetricCard label="交易成功笔数" value={String(transactionSummary.successCount)} />
              <MetricCard label="非成功状态笔数" value={String(transactionSummary.pendingCount)} />
            </div>
          ) : null}

          {rowsError ? <ErrorMessage message={rowsError} /> : null}
          <div className="mt-4">
            <TransactionTable
              rows={rows?.items ?? []}
              emptyLabel="当前筛选下无数据"
              deletingId={deletingTransactionId}
              onViewDetail={(item) => void fetchTransactionDetailById(item.id)}
              onDelete={(item) => void deleteTransactionById(item.id)}
            />
            {rows ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
                <span>
                  共 {rows.total} 条，当前页 {rows.page}/{Math.max(1, Math.ceil(rows.total / rows.pageSize))}
                  ，每页 {rows.pageSize}
                </span>
                <button
                  type="button"
                  disabled={loadingRows || rows.page <= 1}
                  onClick={() => void fetchTransactions(rows.page - 1)}
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--text)] disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={
                    loadingRows || rows.page >= Math.max(1, Math.ceil(rows.total / rows.pageSize))
                  }
                  onClick={() => void fetchTransactions(rows.page + 1)}
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--text)] disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "charts" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
          <div className="mb-4 rounded-xl border border-[var(--border)] bg-slate-50 p-4 text-sm text-[var(--muted)]">
            <p className="font-semibold text-[var(--text)]">建议图表维度（已实现第一版）</p>
            <p className="mt-1">1. 分类维度：看哪些分类贡献净额最高（柱状图）</p>
            <p>2. 账号维度：看不同账号的收入、支出、净额差异（柱状图）</p>
            <p>3. 时间维度：按天看趋势波动（柱状图）</p>
            <p>4. 状态/收支维度：看结构占比（饼图）</p>
          </div>

          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              void fetchTransactionCharts();
            }}
          >
            <label className="grid gap-1 text-sm">
              开始日期
              <input
                type="date"
                value={chartFilters.start}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) => setChartFilters((prev) => ({ ...prev, start: event.target.value }))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              结束日期
              <input
                type="date"
                value={chartFilters.end}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) => setChartFilters((prev) => ({ ...prev, end: event.target.value }))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              账单账号
              <select
                value={chartFilters.billAccount}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) =>
                  setChartFilters((prev) => ({ ...prev, billAccount: event.target.value }))
                }
              >
                <option value="">全部账号</option>
                {accountOptions.map((item) => (
                  <option key={item.billAccount} value={item.billAccount}>
                    {formatBillAccountLabel(item.billAccount)}（{item.count}）
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={chartLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                <WalletCards className="size-4" />
                {chartLoading ? "加载中..." : "刷新图表"}
              </button>
            </div>
          </form>

          {chartError ? <ErrorMessage message={chartError} /> : null}

          {chartData ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="样本总笔数" value={String(chartData.totalCount)} />
              <MetricCard
                label="分类数量"
                value={String(chartData.byCategory.length)}
              />
              <MetricCard
                label="账号数量"
                value={String(chartData.byBillAccount.length)}
              />
              <MetricCard label="日期点数" value={String(chartData.byDay.length)} />
            </div>
          ) : null}

          {chartData ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <SimpleBarChart
                title="分类净额 Top10"
                unit="元"
                data={chartCategorySource.map((item) => ({
                  label: CATEGORY_LABEL[item.category as Category] ?? item.category,
                  value: item.netAmount
                }))}
                onItemClick={(_, index) => {
                  const source = chartCategorySource[index];
                  if (!source) {
                    return;
                  }
                  openChartDetail(`分类净额 · ${CATEGORY_LABEL[source.category as Category] ?? source.category}`, {
                    ...buildChartBaseDetailFilters(),
                    category: source.category
                  });
                }}
              />
              <SimpleBarChart
                title="账号净额 Top10"
                unit="元"
                data={chartBillAccountSource.map((item) => ({
                  label: formatBillAccountLabel(item.billAccount),
                  value: item.netAmount
                }))}
                onItemClick={(_, index) => {
                  const source = chartBillAccountSource[index];
                  if (!source) {
                    return;
                  }
                  openChartDetail(`账号净额 · ${formatBillAccountLabel(source.billAccount)}`, {
                    ...reportFilterToDateRange(chartFilters.start, chartFilters.end),
                    billAccount: source.billAccount
                  });
                }}
              />
              <SimpleBarChart
                title="每日净额趋势"
                unit="元"
                maxBodyHeightPx={320}
                data={chartDaySource.map((item) => ({
                  label: item.day,
                  value: item.netAmount
                }))}
                onItemClick={(_, index) => {
                  const source = chartDaySource[index];
                  if (!source) {
                    return;
                  }
                  openChartDetail(`每日净额 · ${source.day}`, {
                    ...buildChartBaseDetailFilters(),
                    ...reportFilterToDateRange(source.day, source.day)
                  });
                }}
              />
              <PieBreakdownChart
                title="状态占比（按笔数）"
                data={chartStatusSource.map((item) => ({
                  label: item.status || "未知",
                  value: item.count
                }))}
                onItemClick={(_, index) => {
                  const source = chartStatusSource[index];
                  if (!source) {
                    return;
                  }
                  openChartDetail(`状态占比 · ${source.status || "未知"}`, {
                    ...buildChartBaseDetailFilters(),
                    ...(source.status ? { status: source.status } : {})
                  });
                }}
              />
              <PieBreakdownChart
                title="收支方向占比（按笔数）"
                data={chartDirectionSource.map((item) => ({
                  label: mapDirectionLabel(item.direction),
                  value: item.count
                }))}
                onItemClick={(_, index) => {
                  const source = chartDirectionSource[index];
                  if (!source) {
                    return;
                  }
                  openChartDetail(`收支方向占比 · ${mapDirectionLabel(source.direction)}`, {
                    ...buildChartBaseDetailFilters(),
                    direction: source.direction
                  });
                }}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "report" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              void fetchProfitSummary();
            }}
          >
            <label className="grid gap-1 text-sm">
              开始日期
              <input
                type="date"
                value={reportFilters.start}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) =>
                  setReportFilters((prev) => ({ ...prev, start: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              结束日期
              <input
                type="date"
                value={reportFilters.end}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) => setReportFilters((prev) => ({ ...prev, end: event.target.value }))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              账单账号
              <select
                value={reportFilters.billAccount}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) =>
                  setReportFilters((prev) => ({ ...prev, billAccount: event.target.value }))
                }
              >
                <option value="">全部账号</option>
                {accountOptions.map((item) => (
                  <option key={item.billAccount} value={item.billAccount}>
                    {formatBillAccountLabel(item.billAccount)}（{item.count}）
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={reportLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {reportLoading ? <RefreshCw className="size-4 animate-spin" /> : <WalletCards className="size-4" />}
                查询统计
              </button>
            </div>
          </form>

          {reportError ? <ErrorMessage message={reportError} /> : null}

          {summary ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard label="主营已到账收入" value={summary.mainSettledIncome} />
              <MetricCard label="主营待到账收入" value={summary.mainPendingIncome} />
              <MetricCard label="主营支出" value={summary.mainExpense} />
              <MetricCard label="流量消耗" value={summary.trafficCost} />
              <MetricCard label="平台抽成" value={summary.platformCommission} />
              <MetricCard label="主营关闭交易金额" value={summary.mainClosedAmount} />
              <MetricCard label="主营退款支出" value={summary.businessRefundExpense} />
              <MetricCard label="纯收益（仅已到账）" value={summary.pureProfitSettled} />
              <MetricCard label="纯收益（含待到账）" value={summary.pureProfitWithPending} />
            </div>
          ) : null}

          <div className="mt-6 rounded-xl border border-[var(--border)] p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
              <label className="grid gap-1 text-sm">
                指标明细
                <select
                  value={detailMetric}
                  className="rounded-lg border border-[var(--border)] px-3 py-2"
                  onChange={(event) => {
                    setDetailMetric(event.target.value as ProfitMetric);
                    setReportDetailPage(1);
                  }}
                >
                  {(Object.keys(METRIC_LABEL) as ProfitMetric[]).map((metric) => (
                    <option key={metric} value={metric}>
                      {METRIC_LABEL[metric]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                每页条数
                <select
                  value={reportDetailPageSize}
                  className="rounded-lg border border-[var(--border)] px-3 py-2"
                  onChange={(event) => {
                    setReportDetailPageSize(event.target.value);
                    setReportDetailPage(1);
                  }}
                >
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </select>
              </label>
              <button
                type="button"
                disabled={reportLoading}
                onClick={() => void fetchProfitDetails(1)}
                className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                查询指标明细
              </button>
            </div>

            <div className="mt-4">
              <TransactionTable rows={detailRows?.items ?? []} emptyLabel="该指标暂无明细" />
              {detailRows ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
                  <span>
                    {METRIC_LABEL[detailMetric]}：共 {detailRows.total} 条，当前页 {detailRows.page}/
                    {Math.max(1, Math.ceil(detailRows.total / detailRows.pageSize))}
                  </span>
                  <button
                    type="button"
                    disabled={reportLoading || detailRows.page <= 1}
                    onClick={() => void fetchProfitDetails(detailRows.page - 1)}
                    className="rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--text)] disabled:opacity-50"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={
                      reportLoading ||
                      detailRows.page >= Math.max(1, Math.ceil(detailRows.total / detailRows.pageSize))
                    }
                    onClick={() => void fetchProfitDetails(detailRows.page + 1)}
                    className="rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--text)] disabled:opacity-50"
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">分润者比例设置（全局）</h2>
              <p className="text-sm text-[var(--muted)]">
                比例总和必须为 100%。可绑定账单账号，且一个账单账号只能绑定一个分润者。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                onClick={addAccountParticipantRow}
              >
                从账单账号新增
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                onClick={addManualParticipantRow}
              >
                手动新增
              </button>
              <button
                type="button"
                disabled={participantsSaving || participantsLoading || !isParticipantRatioValid}
                onClick={() => void handleSaveParticipants()}
                className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {participantsSaving ? "保存中..." : "保存分润配置"}
              </button>
            </div>
          </div>

          <p className="mt-3 text-sm">
            当前比例合计：
            <span className={isParticipantRatioValid ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>
              {formatPercent(participantRatioTotal)}%
            </span>
          </p>

          {participantsError ? <ErrorMessage message={participantsError} /> : null}

          {participantsLoading ? (
            <p className="mt-4 text-sm text-[var(--muted)]">分润者配置加载中...</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-left text-xs text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">分润者</th>
                    <th className="px-3 py-2">绑定账单账号</th>
                    <th className="px-3 py-2">比例（%）</th>
                    <th className="px-3 py-2">备注</th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {participantRows.map((item) => (
                    <tr key={item.tempId} className="border-t border-[var(--border)] bg-white">
                      <td className="px-3 py-2 min-w-[180px]">
                        <input
                          type="text"
                          value={item.name}
                          className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                          placeholder="分润者名称"
                          onChange={(event) =>
                            updateParticipantRow(item.tempId, (prev) => ({
                              ...prev,
                              name: event.target.value
                            }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2 min-w-[200px]">
                        <select
                          value={item.billAccount}
                          className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                          onChange={(event) =>
                            updateParticipantRow(item.tempId, (prev) => ({
                              ...prev,
                              billAccount: event.target.value,
                              name: !prev.name.trim() && event.target.value ? event.target.value : prev.name
                            }))
                          }
                        >
                          <option value="">未绑定（手动新增）</option>
                          {accountOptions.map((account) => (
                            <option key={account.billAccount} value={account.billAccount}>
                              {formatBillAccountLabel(account.billAccount)}（{account.count}）
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 min-w-[140px]">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          value={item.ratioPercent}
                          className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                          onChange={(event) =>
                            updateParticipantRow(item.tempId, (prev) => ({
                              ...prev,
                              ratioPercent: String(normalizePercentDecimalInput(event.target.value))
                            }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2 min-w-[220px]">
                        <input
                          type="text"
                          value={item.note}
                          className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                          placeholder="可选备注"
                          onChange={(event) =>
                            updateParticipantRow(item.tempId, (prev) => ({
                              ...prev,
                              note: event.target.value
                            }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="rounded-lg border border-red-200 px-3 py-1 text-red-700"
                          onClick={() => removeParticipantRow(item.tempId)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                  {participantRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-[var(--muted)]" colSpan={5}>
                        暂无分润者，请先新增并保存。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {isSettlementTab ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-[var(--muted)]">
            当前策略：{activeSettlementStrategy === "cumulative" ? "累计分润" : "增量分润（仅统计未分润新数据）"}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="grid gap-1 text-sm lg:col-span-2 xl:col-span-2">
              结算日期（按当天 23:59:59）
              <input
                type="date"
                value={settlementTime}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) => setSettlementTime(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              留存比例（0-100，整数 %）
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={settlementCarryPercent}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                onChange={(event) =>
                  setSettlementCarryPercent(String(normalizePercentInput(event.target.value)))
                }
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                disabled={settlementLoading}
                onClick={() => void fetchSettlementPreview(activeSettlementStrategy)}
                className="inline-flex w-full items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                预览分润
              </button>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                disabled={settlementLoading}
                onClick={() => void createSettlement(activeSettlementStrategy)}
                className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                创建分润批次
              </button>
            </div>
          </div>

          <label className="mt-3 grid gap-1 text-sm">
            批次备注
            <textarea
              value={settlementNote}
              rows={2}
              className="rounded-lg border border-[var(--border)] px-3 py-2"
              placeholder="可选"
              onChange={(event) => setSettlementNote(event.target.value)}
            />
          </label>
          <p className="mt-2 text-xs text-[var(--muted)]">历史分润批次不允许删除，创建前请先预览并确认。</p>
          <div className="mt-2 rounded-lg border border-[var(--border)] bg-slate-50 px-3 py-2 text-xs text-[var(--muted)]">
            账号独立留存说明：结算时按“全部账号”计算总分润；下方账号页签仅用于查看分账号分润详情，
            每个账号的留存比例和留存余额明细会单独展示。
          </div>

          {settlementError ? <ErrorMessage message={settlementError} /> : null}

          {settlementPreview ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                label="分润策略"
                value={settlementPreview.strategy === "cumulative" ? "累计分润" : "增量分润"}
              />
              <MetricCard label="结算账号" value="全部账号" />
              <MetricCard label="留存比例" value={settlementPreview.carryRatio} />
              <MetricCard label="上期留存余额" value={settlementPreview.previousCarryForwardAmount} />
              <MetricCard label="本期新增净额" value={settlementPreview.periodNetAmount} />
              <MetricCard label="C(T) 累计可分润净额" value={settlementPreview.cumulativeNetAmount} />
              <MetricCard label="S(T) 累计已分润额" value={settlementPreview.settledBaseAmount} />
              <MetricCard label="P(T) 本次可分润额" value={settlementPreview.distributableAmount} />
              <MetricCard label="本次实发" value={settlementPreview.paidAmount} />
              <MetricCard label="留存余额" value={settlementPreview.carryForwardAmount} />
              <MetricCard label="分润后累计已分润" value={settlementPreview.cumulativeSettledAmount} />
              <MetricCard label="当前有效批次" value={settlementPreview.effectiveBatchNo ?? "无"} />
              <MetricCard label="预览时间" value={formatDate(settlementPreview.settlementTime)} />
            </div>
          ) : null}

          <div className="mt-6 rounded-xl border border-[var(--border)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">分润者比例（全局，可在此修改）</p>
                <p className="text-xs text-[var(--muted)]">
                  当前比例合计 {formatPercent(participantRatioTotal)}%，要求 100%。完整增删可在“分润设置页”操作。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                  onClick={() => setParticipantRatioPanelExpanded((prev) => !prev)}
                >
                  {participantRatioPanelExpanded ? "收起" : "展开"}
                </button>
                {participantRatioPanelExpanded ? (
                  <button
                    type="button"
                    disabled={participantsSaving || participantsLoading || !isParticipantRatioValid}
                    onClick={() => void handleSaveParticipants()}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {participantsSaving ? "保存中..." : "保存比例"}
                  </button>
                ) : null}
              </div>
            </div>

            {participantRatioPanelExpanded ? (
              participantsLoading ? (
                <p className="mt-3 text-sm text-[var(--muted)]">分润者配置加载中...</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-slate-100 text-left text-xs text-[var(--muted)]">
                      <tr>
                        <th className="px-3 py-2">分润者</th>
                        <th className="px-3 py-2">账单账号</th>
                        <th className="px-3 py-2">比例（%）</th>
                        <th className="px-3 py-2">备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {participantRows.map((item) => (
                        <tr key={item.tempId} className="border-t border-[var(--border)] bg-white">
                          <td className="px-3 py-2 whitespace-nowrap">{item.name || "-"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatParticipantBillAccountLabel(item.billAccount)}
                          </td>
                          <td className="px-3 py-2 min-w-[140px]">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.01}
                              value={item.ratioPercent}
                              className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                              onChange={(event) =>
                                updateParticipantRow(item.tempId, (prev) => ({
                                  ...prev,
                                  ratioPercent: String(normalizePercentDecimalInput(event.target.value))
                                }))
                              }
                            />
                          </td>
                          <td className="px-3 py-2 min-w-[220px]">
                            <input
                              type="text"
                              value={item.note}
                              className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5"
                              placeholder="可选备注"
                              onChange={(event) =>
                                updateParticipantRow(item.tempId, (prev) => ({
                                  ...prev,
                                  note: event.target.value
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                      {participantRows.length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-center text-[var(--muted)]" colSpan={4}>
                            暂无分润者，请先到分润设置页新增。
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <p className="mt-3 text-sm text-[var(--muted)]">默认收起，点击“展开”可查看并修改分润者比例。</p>
            )}
          </div>

          {participantsError ? <ErrorMessage message={participantsError} /> : null}

          {settlementPreview ? (
            <div className="mt-6 rounded-xl border border-[var(--border)] p-4">
              <p className="text-sm font-semibold">本次分配明细（按实发计算，负值时按应支出显示）</p>
              <p className="mt-1 text-xs text-[var(--muted)]">分配基数：{settlementPreview.allocationBaseAmount}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                实际应收/应付 = 本次应收/应支 - 账号已收（估算）。账号已收按绑定账号净额占比折算到本次分配基数。
              </p>
              <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)]">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-slate-100 text-left text-xs text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2">分润者</th>
                      <th className="px-3 py-2">账单账号</th>
                      <th className="px-3 py-2">比例</th>
                      <th className="px-3 py-2">本次应收/应支</th>
                      <th className="px-3 py-2">账号已收（估算）</th>
                      <th className="px-3 py-2">实际应收/应付</th>
                      <th className="px-3 py-2">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlementPreview.allocations.map((item) => {
                      const isNegative = Number(item.amount) < 0;
                      const isActualNegative = Number(item.actualTransferAmount) < 0;
                      return (
                        <tr key={`${item.participantId}-${item.participantName}`} className="border-t border-[var(--border)] bg-white">
                          <td className="px-3 py-2 whitespace-nowrap">{item.participantName}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatParticipantBillAccountLabel(item.participantBillAccount)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{item.ratioPercent}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={isNegative ? "text-red-700 font-semibold" : ""}>{item.amount}</span>
                            {isNegative ? (
                              <span
                                className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-red-300 text-[10px] text-red-700"
                                title="当前为负值，表示该分润者本次应支出（补回）金额。"
                              >
                                !
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{item.accountHeldAmount}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={isActualNegative ? "text-red-700 font-semibold" : "text-emerald-700 font-semibold"}>
                              {item.actualTransferAmount}
                            </span>
                            {isActualNegative ? (
                              <span
                                className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-red-300 text-[10px] text-red-700"
                                title="负值表示该分润者应向他人支付该金额。"
                              >
                                !
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">{item.note || "-"}</td>
                        </tr>
                      );
                    })}
                    {settlementPreview.allocations.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-center text-[var(--muted)]" colSpan={7}>
                          暂无分润者配置，无法计算本次分配明细。
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {accountOptions.length > 0 ? (
            <div className="mt-6 rounded-xl border border-[var(--border)] p-4">
              <p className="mb-3 text-sm font-semibold">按账号查看分润详情</p>
              <div className="inline-flex flex-wrap rounded-xl border border-[var(--border)] bg-[var(--brand-soft)] p-1">
                {accountOptions.map((item) => (
                  <button
                    key={item.billAccount}
                    type="button"
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      settlementDetailBillAccount === item.billAccount
                        ? "bg-[var(--brand)] text-white"
                        : "text-[var(--text)]"
                    }`}
                    onClick={() => setSettlementDetailBillAccount(item.billAccount)}
                  >
                    {formatBillAccountLabel(item.billAccount)}（{item.count}）
                  </button>
                ))}
              </div>

              {settlementDetailLoading ? (
                <p className="mt-3 text-sm text-[var(--muted)]">账号分润详情加载中...</p>
              ) : null}

              {settlementDetailPreview ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard
                    label="分润策略"
                    value={settlementDetailPreview.strategy === "cumulative" ? "累计分润" : "增量分润"}
                  />
                  <MetricCard label="结算账号" value={formatBillAccountLabel(settlementDetailPreview.billAccount)} />
                  <MetricCard label="留存比例" value={settlementDetailPreview.carryRatio} />
                  <MetricCard label="上期留存余额" value={settlementDetailPreview.previousCarryForwardAmount} />
                  <MetricCard label="本期新增净额" value={settlementDetailPreview.periodNetAmount} />
                  <MetricCard label="C(T) 累计可分润净额" value={settlementDetailPreview.cumulativeNetAmount} />
                  <MetricCard label="S(T) 累计已分润额" value={settlementDetailPreview.settledBaseAmount} />
                  <MetricCard label="P(T) 本次可分润额" value={settlementDetailPreview.distributableAmount} />
                  <MetricCard label="本次实发" value={settlementDetailPreview.paidAmount} />
                  <MetricCard label="留存余额" value={settlementDetailPreview.carryForwardAmount} />
                  <MetricCard label="分润后累计已分润" value={settlementDetailPreview.cumulativeSettledAmount} />
                  <MetricCard label="当前有效批次" value={settlementDetailPreview.effectiveBatchNo ?? "无"} />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-slate-100 text-left text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">批次号</th>
                  <th className="px-3 py-2">策略</th>
                  <th className="px-3 py-2">账号</th>
                  <th className="px-3 py-2">结算时间</th>
                  <th className="px-3 py-2">留存比例</th>
                  <th className="px-3 py-2">上期留存</th>
                  <th className="px-3 py-2">本期新增净额</th>
                  <th className="px-3 py-2">C(T)</th>
                  <th className="px-3 py-2">S(T)</th>
                  <th className="px-3 py-2">P(T)</th>
                  <th className="px-3 py-2">实发</th>
                  <th className="px-3 py-2">留存</th>
                  <th className="px-3 py-2">分配详情</th>
                  <th className="px-3 py-2">状态</th>
                </tr>
              </thead>
              <tbody>
                {settlementBatches.map((batch) => {
                  const expanded = expandedSettlementBatchIds[batch.id] ?? false;
                  return (
                    <Fragment key={batch.id}>
                      <tr className="border-t border-[var(--border)] bg-white">
                        <td className="px-3 py-2 whitespace-nowrap">{batch.batchNo}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {batch.strategy === "cumulative" ? "累计" : "增量"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatBillAccountLabel(batch.billAccount)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(batch.settlementTime)}</td>
                        <td className="px-3 py-2">{batch.carryRatio}</td>
                        <td className="px-3 py-2">{batch.previousCarryForwardAmount}</td>
                        <td className="px-3 py-2">{batch.periodNetAmount}</td>
                        <td className="px-3 py-2">{batch.cumulativeNetAmount}</td>
                        <td className="px-3 py-2">{batch.settledBaseAmount}</td>
                        <td className="px-3 py-2">{batch.distributableAmount}</td>
                        <td className="px-3 py-2">{batch.paidAmount}</td>
                        <td className="px-3 py-2">{batch.carryForwardAmount}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button
                            type="button"
                            className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-slate-50"
                            onClick={() =>
                              setExpandedSettlementBatchIds((prev) => ({
                                ...prev,
                                [batch.id]: !expanded
                              }))
                            }
                          >
                            {expanded ? "收起" : "查看"}（{batch.allocations.length}）
                          </button>
                        </td>
                        <td className="px-3 py-2">{batch.isEffective ? "当前有效" : "历史"}</td>
                      </tr>
                      {expanded ? (
                        <tr className="border-t border-[var(--border)] bg-slate-50">
                          <td className="px-3 py-3" colSpan={14}>
                            <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
                              <table className="min-w-full border-collapse text-xs">
                                <thead className="bg-slate-100 text-left text-[var(--muted)]">
                                  <tr>
                                    <th className="px-2 py-1.5">分润者</th>
                                    <th className="px-2 py-1.5">账单账号</th>
                                    <th className="px-2 py-1.5">比例</th>
                                    <th className="px-2 py-1.5">应收/应支</th>
                                    <th className="px-2 py-1.5">账号已收（估算）</th>
                                    <th className="px-2 py-1.5">实际应收/应付</th>
                                    <th className="px-2 py-1.5">备注</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {batch.allocations.map((allocation) => {
                                    const isNegative = Number(allocation.actualTransferAmount) < 0;
                                    return (
                                      <tr
                                        key={`${batch.id}-${allocation.participantId}-${allocation.participantName}`}
                                        className="border-t border-[var(--border)]"
                                      >
                                        <td className="px-2 py-1.5 whitespace-nowrap">{allocation.participantName}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">
                                          {formatParticipantBillAccountLabel(allocation.participantBillAccount)}
                                        </td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{allocation.ratioPercent}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{allocation.amount}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{allocation.accountHeldAmount}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">
                                          <span className={isNegative ? "text-red-700 font-semibold" : "text-emerald-700 font-semibold"}>
                                            {allocation.actualTransferAmount}
                                          </span>
                                        </td>
                                        <td className="px-2 py-1.5">{allocation.note || "-"}</td>
                                      </tr>
                                    );
                                  })}
                                  {batch.allocations.length === 0 ? (
                                    <tr>
                                      <td className="px-2 py-3 text-center text-[var(--muted)]" colSpan={7}>
                                        当前批次无分配记录
                                      </td>
                                    </tr>
                                  ) : null}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {settlementBatches.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-[var(--muted)]" colSpan={14}>
                      暂无分润批次
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {transactionDetailLoading || transactionDetail ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-3 py-4"
          onClick={() => {
            if (!transactionDetailLoading) {
              setTransactionDetail(null);
            }
          }}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-base font-semibold">交易详情</h2>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)]"
                onClick={() => setTransactionDetail(null)}
                disabled={transactionDetailLoading}
              >
                关闭
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-4">
              {transactionDetailLoading && !transactionDetail ? (
                <p className="text-sm text-[var(--muted)]">详情加载中...</p>
              ) : null}

              {transactionDetail ? (
                <div className="grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <MetricCard label="交易时间" value={formatDate(transactionDetail.transactionTime)} />
                    <MetricCard label="账单账号" value={formatBillAccountLabel(transactionDetail.billAccount)} />
                    <MetricCard label="交易订单号" value={transactionDetail.orderId || "-"} />
                    <MetricCard label="商家订单号" value={transactionDetail.merchantOrderId || "-"} />
                    <MetricCard label="收支" value={mapDirectionLabel(transactionDetail.direction)} />
                    <MetricCard label="金额" value={transactionDetail.amount} />
                    <MetricCard label="状态" value={transactionDetail.status || "-"} />
                    <MetricCard
                      label="分类"
                      value={CATEGORY_LABEL[transactionDetail.category as Category] ?? transactionDetail.category}
                    />
                    <MetricCard label="备注" value={transactionDetail.remark || "-"} />
                  </div>

                  <div className="rounded-xl border border-[var(--border)] p-4">
                    <p className="mb-2 text-sm font-semibold">截图</p>
                    {transactionDetail.screenshotUrl ? (
                      <div className="grid gap-2">
                        <a
                          href={transactionDetail.screenshotUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-700 underline"
                        >
                          打开原图：{transactionDetail.screenshotFileName || "截图"}
                        </a>
                        <img
                          src={transactionDetail.screenshotUrl}
                          alt={transactionDetail.screenshotFileName || "交易截图"}
                          className="max-h-[360px] rounded-lg border border-[var(--border)] object-contain"
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">该记录没有截图</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-[var(--border)] p-4">
                    <p className="mb-2 text-sm font-semibold">原始内容（rawRowJson）</p>
                    <pre className="max-h-[280px] overflow-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed">
                      {JSON.stringify(transactionDetail.rawRowJson, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {chartDetailVisible ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-3 py-4"
          onClick={closeChartDetail}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <div>
                <h2 className="text-base font-semibold">{chartDetailTitle || "图表明细"}</h2>
                <p className="text-xs text-[var(--muted)]">
                  账单账号：
                  {chartDetailFilters?.billAccount
                    ? formatBillAccountLabel(chartDetailFilters.billAccount)
                    : "全部账号"}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)]"
                onClick={closeChartDetail}
              >
                关闭
              </button>
            </div>

            <div className="overflow-y-auto px-4 py-4">
              {chartDetailLoading && !chartDetailRows ? (
                <p className="text-sm text-[var(--muted)]">明细加载中...</p>
              ) : null}
              {chartDetailError ? <ErrorMessage message={chartDetailError} /> : null}

              {chartDetailRows ? (
                <div className="space-y-3">
                  <TransactionTable rows={chartDetailRows.items} emptyLabel="当前图表项暂无符合条件的明细" />
                  <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
                    <span>
                      共 {chartDetailRows.total} 条，当前页 {chartDetailRows.page}/
                      {Math.max(1, Math.ceil(chartDetailRows.total / chartDetailRows.pageSize))}，每页{" "}
                      {chartDetailRows.pageSize}
                    </span>
                    <button
                      type="button"
                      disabled={chartDetailLoading || chartDetailRows.page <= 1}
                      onClick={() => void fetchChartDetail(chartDetailFilters, chartDetailRows.page - 1)}
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--text)] disabled:opacity-50"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={
                        chartDetailLoading ||
                        chartDetailRows.page >= Math.max(1, Math.ceil(chartDetailRows.total / chartDetailRows.pageSize))
                      }
                      onClick={() => void fetchChartDetail(chartDetailFilters, chartDetailRows.page + 1)}
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--text)] disabled:opacity-50"
                    >
                      下一页
                    </button>
                    {chartDetailLoading ? <span>翻页加载中...</span> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

type ManualBulkColumn = "time" | "billAccount" | "amount" | "description";

export function parseManualRowsFromText(
  text: string,
  defaultBillAccount: string,
  defaultTime: string
): {
  rows: ManualBulkParsedRow[];
  skippedCount: number;
} {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      rows: [],
      skippedCount: 0
    };
  }

  const delimiter = detectBulkDelimiter(lines);
  const rowCells = lines
    .map((line) => parseBulkLineCells(line, delimiter))
    .filter((cells) => cells.some((cell) => cell.trim().length > 0));

  if (rowCells.length === 0) {
    return {
      rows: [],
      skippedCount: 0
    };
  }

  const headerMap = parseBulkHeaderMap(rowCells[0] ?? []);
  const startIndex = headerMap ? 1 : 0;

  const rows: ManualBulkParsedRow[] = [];
  let skippedCount = 0;

  for (let index = startIndex; index < rowCells.length; index += 1) {
    const cells = rowCells[index] ?? [];
    const parsed = headerMap
      ? parseBulkRowByHeader(cells, headerMap, defaultBillAccount, defaultTime)
      : parseBulkRowByPosition(cells, defaultBillAccount, defaultTime);
    if (parsed) {
      rows.push(parsed);
    } else {
      skippedCount += 1;
    }
  }

  return {
    rows,
    skippedCount
  };
}

function detectBulkDelimiter(lines: string[]): "," | "\t" | null {
  const hasTab = lines.some((line) => line.includes("\t"));
  if (hasTab) {
    return "\t";
  }

  const hasComma = lines.some((line) => line.includes(",") || line.includes("，"));
  if (hasComma) {
    return ",";
  }

  return null;
}

function parseBulkLineCells(line: string, delimiter: "," | "\t" | null): string[] {
  if (!delimiter) {
    return parseWhitespaceCells(line);
  }

  const normalizedLine = delimiter === "," ? line.replaceAll("，", ",") : line;
  return parseDelimitedLine(normalizedLine, delimiter)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (char === "\"") {
      const next = line[index + 1] ?? "";
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }
  cells.push(current);
  return cells;
}

function parseWhitespaceCells(line: string): string[] {
  const normalized = line.trim();
  if (!normalized) {
    return [];
  }

  const multiSeparatorCells = normalized
    .split(/\s{2,}|\t+/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  if (multiSeparatorCells.length >= 2) {
    const flattenedHeaderTokens = multiSeparatorCells.flatMap((cell) =>
      cell.split(/\s+/).map((token) => token.trim()).filter((token) => token.length > 0)
    );
    if (
      flattenedHeaderTokens.length >= 2 &&
      flattenedHeaderTokens.every((token) => mapBulkHeaderCell(token) !== null)
    ) {
      return flattenedHeaderTokens;
    }
    return multiSeparatorCells;
  }

  const amountDateTimeAccountMatch = normalized.match(
    /^([+-]?\s*[¥￥]?\d[\d,]*(?:\.\d+)?)\s+(.+?)\s+((?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+(\S+)$/
  );
  if (amountDateTimeAccountMatch) {
    return [
      (amountDateTimeAccountMatch[1] ?? "").trim(),
      (amountDateTimeAccountMatch[2] ?? "").trim(),
      (amountDateTimeAccountMatch[3] ?? "").trim(),
      (amountDateTimeAccountMatch[4] ?? "").trim()
    ];
  }

  const amountDateTimeMatch = normalized.match(
    /^([+-]?\s*[¥￥]?\d[\d,]*(?:\.\d+)?)\s+(.+?)\s+((?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)$/
  );
  if (amountDateTimeMatch) {
    return [
      (amountDateTimeMatch[1] ?? "").trim(),
      (amountDateTimeMatch[2] ?? "").trim(),
      (amountDateTimeMatch[3] ?? "").trim()
    ];
  }

  const amountRemarkMatch = normalized.match(/^([+-]?\s*[¥￥]?\d[\d,]*(?:\.\d+)?)\s+(.+)$/);
  if (amountRemarkMatch) {
    return [(amountRemarkMatch[1] ?? "").trim(), (amountRemarkMatch[2] ?? "").trim()];
  }

  return normalized
    .split(/\s+/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

function normalizeBulkHeaderToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s/_-]/g, "").replace(/[/：:]/g, "");
}

function mapBulkHeaderCell(value: string): ManualBulkColumn | null {
  const token = normalizeBulkHeaderToken(value);
  if (!token) {
    return null;
  }

  if (
    token === "时间" ||
    token === "交易时间" ||
    token === "datetime" ||
    token === "transactiontime" ||
    token === "date"
  ) {
    return "time";
  }
  if (
    token === "账号" ||
    token === "账单账号" ||
    token === "账单所属账号" ||
    token === "支付宝账户" ||
    token === "billaccount" ||
    token === "account"
  ) {
    return "billAccount";
  }
  if (token === "金额" || token === "amount" || token === "money") {
    return "amount";
  }
  if (
    token === "说明" ||
    token === "备注" ||
    token === "description" ||
    token === "remark" ||
    token === "商品说明" ||
    token === "content"
  ) {
    return "description";
  }

  return null;
}

function parseBulkHeaderMap(cells: string[]): Map<number, ManualBulkColumn> | null {
  const headerEntries: Array<[number, ManualBulkColumn]> = [];
  for (let index = 0; index < cells.length; index += 1) {
    const mapped = mapBulkHeaderCell(cells[index] ?? "");
    if (mapped) {
      headerEntries.push([index, mapped]);
    }
  }

  if (headerEntries.length === 0) {
    return null;
  }

  return new Map(headerEntries);
}

function parseBulkRowByHeader(
  cells: string[],
  headerMap: Map<number, ManualBulkColumn>,
  defaultBillAccount: string,
  defaultTime: string
): ManualBulkParsedRow | null {
  let rawTime = "";
  let rawBillAccount = "";
  let rawAmount = "";
  let rawDescription = "";

  for (const [index, key] of headerMap.entries()) {
    const value = (cells[index] ?? "").trim();
    if (key === "time") {
      rawTime = value;
      continue;
    }
    if (key === "billAccount") {
      rawBillAccount = value;
      continue;
    }
    if (key === "amount") {
      rawAmount = value;
      continue;
    }
    if (key === "description") {
      rawDescription = value;
    }
  }

  return buildBulkParsedRow(
    {
      transactionTime: rawTime,
      billAccount: rawBillAccount,
      amount: rawAmount,
      description: rawDescription
    },
    defaultBillAccount,
    defaultTime
  );
}

function parseBulkRowByPosition(
  cells: string[],
  defaultBillAccount: string,
  defaultTime: string
): ManualBulkParsedRow | null {
  const cleanCells = cells.map((item) => item.trim()).filter((item) => item.length > 0);
  if (cleanCells.length < 2) {
    return null;
  }

  if (cleanCells.length === 2) {
    return buildBulkParsedRow(
      {
        amount: cleanCells[0] ?? "",
        description: cleanCells[1] ?? ""
      },
      defaultBillAccount,
      defaultTime
    );
  }

  if (cleanCells.length === 3) {
    const first = cleanCells[0] ?? "";
    const second = cleanCells[1] ?? "";
    const third = cleanCells[2] ?? "";
    if (toIsoFromDateTimeInput(first)) {
      return buildBulkParsedRow(
        {
          transactionTime: first,
          amount: second,
          description: third
        },
        defaultBillAccount,
        defaultTime
      );
    }
    return buildBulkParsedRow(
      {
        amount: first,
        description: second,
        ...(toIsoFromDateTimeInput(third)
          ? {
              transactionTime: third
            }
          : {
              billAccount: third
            })
      },
      defaultBillAccount,
      defaultTime
    );
  }

  if (cleanCells.length === 4) {
    return buildBulkParsedRow(
      {
        amount: cleanCells[0] ?? "",
        description: cleanCells[1] ?? "",
        transactionTime: cleanCells[2] ?? "",
        billAccount: cleanCells[3] ?? ""
      },
      defaultBillAccount,
      defaultTime
    );
  }

  if (cleanCells.length >= 5) {
    const maybeDate = cleanCells[cleanCells.length - 3] ?? "";
    const maybeTime = cleanCells[cleanCells.length - 2] ?? "";
    const maybeDateTime = `${maybeDate} ${maybeTime}`.trim();
    if (toIsoFromDateTimeInput(maybeDateTime)) {
      const amount = cleanCells[0] ?? "";
      const account = cleanCells[cleanCells.length - 1] ?? "";
      const description = cleanCells.slice(1, -3).join(" ");
      return buildBulkParsedRow(
        {
          amount,
          description,
          transactionTime: maybeDateTime,
          billAccount: account
        },
        defaultBillAccount,
        defaultTime
      );
    }
  }

  const amount = cleanCells[0] ?? "";
  const account = cleanCells[cleanCells.length - 1] ?? "";
  const time = cleanCells[cleanCells.length - 2] ?? "";
  const description = cleanCells.slice(1, -2).join(" ");

  return buildBulkParsedRow(
    {
      amount,
      description,
      transactionTime: time,
      billAccount: account
    },
    defaultBillAccount,
    defaultTime
  );
}

function parseBulkAmount(value: string): number | null {
  const normalized = value.replace(/[,\s，]/g, "").replace(/[¥￥]/g, "").trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function buildBulkParsedRow(
  input: {
    transactionTime?: string;
    billAccount?: string;
    amount?: string;
    description?: string;
  },
  defaultBillAccount: string,
  defaultTime: string
): ManualBulkParsedRow | null {
  const amountNumber = parseBulkAmount(input.amount ?? "");
  if (amountNumber === null) {
    return null;
  }

  const description = (input.description ?? "").trim();
  if (!description) {
    return null;
  }

  const timeRaw = (input.transactionTime ?? "").trim();
  let transactionTime = defaultTime;
  if (timeRaw) {
    const iso = toIsoFromDateTimeInput(timeRaw);
    if (!iso) {
      return null;
    }
    transactionTime = toDateTimeInputValue(new Date(iso));
  }

  return {
    direction: inferDirectionFromAmount(amountNumber),
    transactionTime,
    amount: Number(Math.abs(amountNumber).toFixed(2)).toString(),
    description,
    billAccount: (input.billAccount ?? "").trim() || defaultBillAccount
  };
}

function inferDirectionFromAmount(
  value: number | string,
  fallback: "income" | "expense" = "income"
): "income" | "expense" {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return fallback;
  }
  return numeric < 0 ? "expense" : "income";
}

function normalizeManualAmountInput(value: string): string {
  return value.replace(/^-+/, "");
}

function reportFilterToDateRange(start: string, end: string): { start?: string; end?: string } {
  const result: { start?: string; end?: string } = {};
  if (start) {
    result.start = `${start}T00:00:00+08:00`;
  }
  if (end) {
    result.end = `${end}T23:59:59+08:00`;
  }
  return result;
}

function buildDateFilterQuery(filters: { start?: string; end?: string }): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.start) {
    params.set("start", filters.start);
  }
  if (filters.end) {
    params.set("end", filters.end);
  }
  return params;
}

function resolveApiResourceUrl(path: string): string {
  if (!path) {
    return path;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (API_BASE.startsWith("http://") || API_BASE.startsWith("https://")) {
    const base = new URL(API_BASE);
    return `${base.protocol}//${base.host}${path.startsWith("/") ? path : `/${path}`}`;
  }

  return path;
}

function toDateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function toDateTimeInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoFromDateTimeInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let normalized = trimmed
    .replaceAll("/", "-")
    .replace(/\s+/g, " ");

  if (normalized.includes(" ") && !normalized.includes("T")) {
    normalized = normalized.replace(" ", "T");
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{1,2}$/.test(normalized)) {
    normalized = `${normalized}:00`;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function toSettlementEndOfDayIso(dateText: string): string {
  const endOfDay = new Date(`${dateText}T23:59:59`);
  return endOfDay.toISOString();
}

function normalizePercentInput(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.trunc(numeric)));
}

function ratioTextToPercentText(value: string | undefined): string {
  const numeric = Number(value ?? "0");
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return formatPercent(numeric * 100);
}

function normalizePercentDecimalInput(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const safe = Math.max(0, Math.min(100, numeric));
  return Number(safe.toFixed(2));
}

function sumParticipantPercent(items: ParticipantFormItem[]): number {
  return Number(
    items.reduce((sum, item) => sum + normalizePercentDecimalInput(item.ratioPercent), 0).toFixed(2)
  );
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const normalized = Number(value.toFixed(2));
  const fixed = normalized.toFixed(2);
  if (fixed.endsWith(".00")) {
    return fixed.slice(0, -3);
  }
  if (fixed.endsWith("0")) {
    return fixed.slice(0, -1);
  }
  return fixed;
}

function createTempId(): string {
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toParticipantFormItem(item: ProfitParticipantItem): ParticipantFormItem {
  return {
    tempId: item.id,
    id: item.id,
    name: item.name,
    billAccount: item.billAccount ?? "",
    ratioPercent: formatPercent(Number(item.ratio) * 100),
    note: item.note
  };
}

function formatBillAccountLabel(value: string): string {
  if (!value) {
    return "全部账号";
  }

  if (value === "unknown") {
    return "unknown（未识别）";
  }

  return value;
}

function formatParticipantBillAccountLabel(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "-";
  }
  return formatBillAccountLabel(normalized);
}

function TabButton(props: {
  tab: Tab;
  target: Tab;
  label: string;
  onClick: (tab: Tab) => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-lg px-4 py-2 text-sm ${
        props.tab === props.target ? "bg-[var(--brand)] text-white" : "text-[var(--text)]"
      }`}
      onClick={() => props.onClick(props.target)}
    >
      {props.label}
    </button>
  );
}

function ErrorMessage(props: { message: string }) {
  return (
    <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {props.message}
    </p>
  );
}

function TransactionTable(props: {
  rows: TransactionItem[];
  emptyLabel: string;
  onViewDetail?: (item: TransactionItem) => void;
  onDelete?: (item: TransactionItem) => void;
  deletingId?: string | null;
}) {
  const showActions = Boolean(props.onViewDetail) || Boolean(props.onDelete);

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-slate-100 text-left text-xs text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2">交易时间</th>
            <th className="px-3 py-2">描述</th>
            <th className="px-3 py-2">收支</th>
            <th className="px-3 py-2">金额</th>
            <th className="px-3 py-2">状态</th>
            <th className="px-3 py-2">分类</th>
            <th className="px-3 py-2">交易订单号</th>
            <th className="px-3 py-2">账单账号</th>
            {showActions ? <th className="px-3 py-2">操作</th> : null}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((item) => (
            <tr key={item.id} className="border-t border-[var(--border)] bg-white">
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(item.transactionTime)}</td>
              <td className="px-3 py-2 min-w-[220px]">{item.description || "-"}</td>
              <td className="px-3 py-2">{mapDirectionLabel(item.direction)}</td>
              <td className="px-3 py-2">{item.amount}</td>
              <td className="px-3 py-2">{item.status}</td>
              <td className="px-3 py-2">{CATEGORY_LABEL[item.category as Category] ?? item.category}</td>
              <td className="px-3 py-2 whitespace-nowrap">{item.orderId || "-"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{item.billAccount || "-"}</td>
              {showActions ? (
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {props.onViewDetail ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                        onClick={() => props.onViewDetail?.(item)}
                      >
                        <Eye className="size-3.5" />
                        详情
                      </button>
                    ) : null}
                    {props.onDelete ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                        disabled={props.deletingId === item.id || item.deletable === false}
                        onClick={() => props.onDelete?.(item)}
                      >
                        <Trash2 className="size-3.5" />
                        {props.deletingId === item.id ? "删除中..." : "删除"}
                      </button>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
          {props.rows.length === 0 ? (
            <tr>
              <td className="px-3 py-6 text-center text-[var(--muted)]" colSpan={showActions ? 9 : 8}>
                {props.emptyLabel}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function SimpleBarChart(props: {
  title: string;
  data: Array<{
    label: string;
    value: number;
  }>;
  unit?: string;
  maxBodyHeightPx?: number;
  onItemClick?: (item: { label: string; value: number }, index: number) => void;
}) {
  const maxAbs = props.data.reduce((max, item) => Math.max(max, Math.abs(item.value)), 0);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white p-4">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      <div
        className={`mt-3 space-y-2 ${props.maxBodyHeightPx ? "overflow-y-auto pr-1" : ""}`}
        style={props.maxBodyHeightPx ? { maxHeight: `${props.maxBodyHeightPx}px` } : undefined}
      >
        {props.data.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">暂无数据</p>
        ) : (
          props.data.map((item, index) => {
            const ratio = maxAbs === 0 ? 0 : Math.abs(item.value) / maxAbs;
            const widthPercent = Math.max(2, Math.round(ratio * 100));
            const isNegative = item.value < 0;
            const content = (
              <>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-[var(--muted)]">{item.label}</span>
                  <span className={isNegative ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>
                    {item.value.toFixed(2)}
                    {props.unit ?? ""}
                  </span>
                </div>
                <div className="h-2 rounded bg-slate-100">
                  <div
                    className={`h-2 rounded ${isNegative ? "bg-red-400" : "bg-emerald-500"}`}
                    style={{ width: `${widthPercent}%` }}
                  />
                </div>
              </>
            );

            if (props.onItemClick) {
              return (
                <button
                  key={`${item.label}-${item.value}`}
                  type="button"
                  className="grid w-full gap-1 rounded-md px-1 py-1 text-left transition hover:bg-slate-50"
                  onClick={() => props.onItemClick?.(item, index)}
                >
                  {content}
                </button>
              );
            }

            return (
              <div key={`${item.label}-${item.value}`} className="grid gap-1">
                {content}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PieBreakdownChart(props: {
  title: string;
  data: Array<{
    label: string;
    value: number;
  }>;
  onItemClick?: (item: { label: string; value: number }, index: number) => void;
}) {
  const positiveData = props.data.filter((item) => item.value > 0);
  const total = positiveData.reduce((sum, item) => sum + item.value, 0);
  const colors = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316"];
  const gradient = buildPieGradient(positiveData, colors);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white p-4">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      {total <= 0 ? (
        <p className="mt-3 text-xs text-[var(--muted)]">暂无数据</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr]">
          <div
            className="mx-auto h-[120px] w-[120px] rounded-full border border-slate-200"
            style={{ background: gradient }}
          />
          <div className="space-y-1.5 text-xs">
            {positiveData.map((item, index) => {
              const ratio = (item.value / total) * 100;
              const content = (
                <>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: colors[index % colors.length] }}
                    />
                    <span className="text-[var(--muted)]">{item.label}</span>
                  </div>
                  <span className="font-semibold">{ratio.toFixed(1)}%</span>
                </>
              );
              if (props.onItemClick) {
                return (
                  <button
                    key={`${item.label}-${item.value}`}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left transition hover:bg-slate-50"
                    onClick={() => props.onItemClick?.(item, index)}
                  >
                    {content}
                  </button>
                );
              }
              return (
                <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-2">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white px-3 py-2">
      <p className="text-xs text-[var(--muted)]">{props.label}</p>
      <p className="text-base font-semibold">{props.value}</p>
    </div>
  );
}

function buildPieGradient(
  data: Array<{
    label: string;
    value: number;
  }>,
  colors: string[]
): string {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0 || data.length === 0) {
    return "conic-gradient(#e2e8f0 0deg 360deg)";
  }

  let offset = 0;
  const parts = data.map((item, index) => {
    const start = offset;
    const angle = (item.value / total) * 360;
    offset += angle;
    const end = offset;
    return `${colors[index % colors.length]} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
  });

  return `conic-gradient(${parts.join(", ")})`;
}

function mapDirectionLabel(direction: string): string {
  if (direction === "income") {
    return "收入";
  }
  if (direction === "expense") {
    return "支出";
  }
  return "不计收支";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}
