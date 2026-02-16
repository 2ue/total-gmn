import { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { importManualTransactions, importQualifiedTransactions } from "../lib/import-service.js";
import { prisma } from "../db.js";

const importTextSchema = z.object({
  content: z.string().min(1, "请输入要导入的文本内容"),
  fileName: z.string().trim().min(1).max(255).optional()
});

const manualImportPayloadSchema = z.object({
  fileName: z.string().trim().min(1).max(255).optional(),
  rows: z
    .array(
      z.object({
        direction: z.enum(["income", "expense"]),
        transactionTime: z
          .string()
          .trim()
          .min(1, "交易时间不能为空")
          .refine((value) => !Number.isNaN(new Date(value).getTime()), "交易时间格式不合法")
          .optional(),
        amount: z.coerce.number().positive("金额必须大于 0"),
        description: z.string().trim().min(1, "说明不能为空").max(500),
        billAccount: z.string().trim().max(200).optional(),
        screenshotField: z.string().trim().max(120).optional()
      })
    )
    .min(1, "至少需要一条手动记录")
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MANUAL_SCREENSHOT_DIR = path.resolve(__dirname, "../../storage/manual-screenshots");
const IMPORT_FILE_DIR = path.resolve(__dirname, "../../storage/import-files");
const MANUAL_SOURCE_TYPE = "manual_form";
const MANUAL_SUCCESS_STATUS = "交易成功";
const MANUAL_CATEGORY = "manual_add";

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function pickRawMetaObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function parseUploadedFileMeta(rawMeta: unknown):
  | {
      originalFileName: string;
      storedFileName: string;
      mimeType: string;
      size: number;
      savedAt: string;
    }
  | null {
  const meta = pickRawMetaObject(rawMeta);
  const node = meta.uploadedFile;
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return null;
  }

  const uploaded = node as Record<string, unknown>;
  const originalFileName =
    typeof uploaded.originalFileName === "string" ? uploaded.originalFileName.trim() : "";
  const storedFileName =
    typeof uploaded.storedFileName === "string" ? uploaded.storedFileName.trim() : "";
  if (!originalFileName || !storedFileName) {
    return null;
  }

  return {
    originalFileName,
    storedFileName,
    mimeType: typeof uploaded.mimeType === "string" ? uploaded.mimeType : "application/octet-stream",
    size: parseNumber(uploaded.size),
    savedAt: typeof uploaded.savedAt === "string" ? uploaded.savedAt : ""
  };
}

function parseScreenshotMeta(raw: unknown):
  | {
      fileName: string;
      mimeType: string;
      size: number;
      sha256: string;
      storagePath: string;
    }
  | null {
  if (!isRecord(raw)) {
    return null;
  }

  const screenshot = raw.screenshot;
  if (!isRecord(screenshot)) {
    return null;
  }

  const fileName = typeof screenshot.fileName === "string" ? screenshot.fileName : "";
  const mimeType = typeof screenshot.mimeType === "string" ? screenshot.mimeType : "";
  const sha256 = typeof screenshot.sha256 === "string" ? screenshot.sha256 : "";
  const storagePath = typeof screenshot.storagePath === "string" ? screenshot.storagePath : "";
  const size = parseNumber(screenshot.size);

  if (!fileName || !mimeType || !sha256 || !storagePath || size <= 0) {
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

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function buildManualDedupeKey(
  billAccount: string,
  orderId: string,
  direction: "income" | "expense"
): string {
  return [
    "order",
    normalizeToken(billAccount),
    normalizeToken(orderId),
    normalizeToken(direction)
  ].join("|");
}

function buildManualBatchOrderId(batchId: string, index: number): string {
  const digest = createHash("sha256")
    .update(`${batchId}|${index}|manual-batch-row`)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `MANUALEDIT${digest}`;
}

function createCategorySummary(manualCount: number): Record<string, number> {
  return {
    main_business: 0,
    manual_add: manualCount,
    traffic_cost: 0,
    platform_commission: 0,
    business_refund_expense: 0,
    other_refund: 0,
    internal_transfer: 0,
    closed: 0,
    other: 0
  };
}

async function persistUploadedImportFile(
  originalFileName: string,
  content: Buffer,
  mimeType: string
): Promise<{
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  size: number;
  savedAt: string;
}> {
  await mkdir(IMPORT_FILE_DIR, { recursive: true });

  const normalizedOriginalName = originalFileName.trim() || "upload.csv";
  const sanitizedOriginalName = sanitizeFileName(normalizedOriginalName) || "upload.csv";
  const extension = path.extname(sanitizedOriginalName);
  const baseName = extension
    ? sanitizedOriginalName.slice(0, -extension.length) || "upload"
    : sanitizedOriginalName;

  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index === 0 ? "" : `_${index}`;
    const storedFileName = `${baseName}${suffix}${extension}`;
    const absolutePath = path.join(IMPORT_FILE_DIR, storedFileName);

    try {
      await writeFile(absolutePath, new Uint8Array(content), { flag: "wx" });
      return {
        originalFileName: normalizedOriginalName,
        storedFileName,
        mimeType: mimeType || "application/octet-stream",
        size: content.length,
        savedAt: new Date().toISOString()
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("保存导入文件失败：同名文件过多");
}

const listImportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20)
});

const importFileParamsSchema = z.object({
  id: z.string().trim().min(1)
});

const manualBatchRowSchema = z.object({
  id: z.string().trim().min(1).optional(),
  direction: z.enum(["income", "expense"]),
  transactionTime: z
    .string()
    .trim()
    .min(1, "交易时间不能为空")
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "交易时间格式不合法"),
  amount: z.coerce.number().positive("金额必须大于 0"),
  description: z.string().trim().min(1, "说明不能为空").max(500),
  billAccount: z.string().trim().min(1, "账单账号不能为空").max(200),
  screenshot: z
    .object({
      fileName: z.string().trim().min(1).max(255),
      mimeType: z.string().trim().min(1).max(120),
      size: z.coerce.number().int().positive(),
      sha256: z.string().trim().min(1).max(128),
      storagePath: z.string().trim().min(1).max(500)
    })
    .optional()
    .nullable()
});

const manualBatchUpdateSchema = z.object({
  rows: z.array(manualBatchRowSchema).min(1, "至少保留一条手动记录")
});

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/imports", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ message: "请上传账单文件，字段名为 file" });
    }

    const buffer = await file.toBuffer();
    const uploadedFile = await persistUploadedImportFile(
      file.filename || "upload.csv",
      buffer,
      file.mimetype || "application/octet-stream"
    );
    const result = await importQualifiedTransactions(file.filename || "upload.csv", buffer, {
      uploadedFile
    });

    return reply.send(result);
  });

  app.get("/imports", async (request, reply) => {
    const parsed = listImportsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "请求参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const { page, pageSize } = parsed.data;
    const skip = (page - 1) * pageSize;
    const [total, rows] = await Promise.all([
      prisma.importBatch.count(),
      prisma.importBatch.findMany({
        orderBy: { importedAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          sourceType: true,
          fileName: true,
          billAccount: true,
          importedAt: true,
          rawMetaJson: true
        }
      })
    ]);

    const items = rows.map((row) => {
      const rawMeta = pickRawMetaObject(row.rawMetaJson);
      const uploadedFile = parseUploadedFileMeta(row.rawMetaJson);

      return {
        id: row.id,
        batchId: row.id,
        sourceType: row.sourceType,
        fileName: row.fileName,
        billAccount: row.billAccount,
        importedAt: row.importedAt.toISOString(),
        totalParsed: parseNumber(rawMeta.totalParsed),
        qualifiedCount: parseNumber(rawMeta.qualifiedCount),
        hasUploadedFile: Boolean(uploadedFile),
        originalFileName: uploadedFile?.originalFileName ?? null,
        storedFileName: uploadedFile?.storedFileName ?? null,
        downloadPath: uploadedFile ? `/api/imports/${row.id}/file` : null
      };
    });

    return reply.send({
      total,
      page,
      pageSize,
      items
    });
  });

  app.get("/imports/:id/file", async (request, reply) => {
    const parsed = importFileParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "请求参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const batch = await prisma.importBatch.findUnique({
      where: { id: parsed.data.id },
      select: {
        id: true,
        fileName: true,
        rawMetaJson: true
      }
    });
    if (!batch) {
      return reply.status(404).send({ message: "导入批次不存在" });
    }

    const uploadedFile = parseUploadedFileMeta(batch.rawMetaJson);
    if (!uploadedFile) {
      return reply.status(404).send({ message: "该批次没有可下载的导入文件" });
    }

    const filePath = path.join(IMPORT_FILE_DIR, uploadedFile.storedFileName);
    try {
      await access(filePath);
    } catch {
      return reply.status(404).send({ message: "导入文件不存在或已被删除" });
    }

    const fallbackName = sanitizeFileName(batch.fileName || "") || uploadedFile.storedFileName;
    const downloadName = uploadedFile.originalFileName || fallbackName;
    const safeName = sanitizeFileName(downloadName) || fallbackName;
    const encodedName = encodeURIComponent(downloadName);

    reply.header("content-type", uploadedFile.mimeType || "application/octet-stream");
    reply.header(
      "content-disposition",
      `attachment; filename=\"${safeName}\"; filename*=UTF-8''${encodedName}`
    );
    return reply.send(createReadStream(filePath));
  });

  app.get("/imports/:id/manual-rows", async (request, reply) => {
    const parsed = importFileParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "请求参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const batch = await prisma.importBatch.findUnique({
      where: { id: parsed.data.id },
      select: {
        id: true,
        sourceType: true,
        fileName: true,
        billAccount: true,
        importedAt: true
      }
    });
    if (!batch) {
      return reply.status(404).send({ message: "导入批次不存在" });
    }
    if (batch.sourceType !== MANUAL_SOURCE_TYPE) {
      return reply.status(400).send({ message: "仅手动导入批次支持编辑" });
    }

    const rows = await prisma.qualifiedTransaction.findMany({
      where: {
        batchId: batch.id
      },
      orderBy: [{ transactionTime: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        direction: true,
        transactionTime: true,
        amount: true,
        description: true,
        billAccount: true,
        status: true,
        category: true,
        orderId: true,
        remark: true,
        incrementalSettledAt: true,
        incrementalSettlementBatchId: true,
        rawRowJson: true
      }
    });

    const locked = rows.some((row) => row.incrementalSettledAt || row.incrementalSettlementBatchId);

    return reply.send({
      batchId: batch.id,
      sourceType: batch.sourceType,
      fileName: batch.fileName,
      billAccount: batch.billAccount,
      importedAt: batch.importedAt.toISOString(),
      locked,
      items: rows.map((row) => {
        const screenshot = parseScreenshotMeta(row.rawRowJson);
        return {
          id: row.id,
          direction: row.direction,
          transactionTime: row.transactionTime.toISOString(),
          amount: row.amount.toString(),
          description: row.description,
          billAccount: row.billAccount,
          status: row.status,
          category: row.category,
          orderId: row.orderId,
          remark: row.remark,
          screenshot: screenshot
            ? {
                fileName: screenshot.fileName,
                mimeType: screenshot.mimeType,
                size: screenshot.size,
                sha256: screenshot.sha256,
                storagePath: screenshot.storagePath,
                url: `/api/transactions/${row.id}/screenshot`
              }
            : null
        };
      })
    });
  });

  app.put("/imports/:id/manual-rows", async (request, reply) => {
    const parsedParams = importFileParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        message: "请求参数不合法",
        errors: parsedParams.error.flatten()
      });
    }

    const parsedBody = manualBatchUpdateSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({
        message: "请求参数不合法",
        errors: parsedBody.error.flatten()
      });
    }

    const batch = await prisma.importBatch.findUnique({
      where: { id: parsedParams.data.id },
      select: {
        id: true,
        sourceType: true,
        fileName: true,
        billAccount: true,
        rawMetaJson: true
      }
    });
    if (!batch) {
      return reply.status(404).send({ message: "导入批次不存在" });
    }
    if (batch.sourceType !== MANUAL_SOURCE_TYPE) {
      return reply.status(400).send({ message: "仅手动导入批次支持编辑" });
    }

    const existingRows = await prisma.qualifiedTransaction.findMany({
      where: {
        batchId: batch.id
      },
      select: {
        id: true,
        orderId: true,
        rawRowJson: true,
        incrementalSettledAt: true,
        incrementalSettlementBatchId: true
      }
    });

    const hasLockedRow = existingRows.some(
      (row) => row.incrementalSettledAt !== null || row.incrementalSettlementBatchId !== null
    );
    if (hasLockedRow) {
      return reply.status(409).send({
        message: "该批次存在已被增量分润标记的记录，不能批量编辑"
      });
    }

    const existingById = new Map(existingRows.map((row) => [row.id, row]));
    const payloadRows = parsedBody.data.rows;

    for (const row of payloadRows) {
      if (row.id && !existingById.has(row.id)) {
        return reply.status(400).send({
          message: `存在不属于当前批次的记录 ID：${row.id}`
        });
      }
    }

    const keptIds = new Set(payloadRows.map((row) => row.id).filter((id): id is string => Boolean(id)));
    const deleteIds = existingRows.map((row) => row.id).filter((id) => !keptIds.has(id));

    const updatePayload = payloadRows
      .map((row, index) => {
        const existing = row.id ? existingById.get(row.id) : undefined;
        const screenshotFromPayload = row.screenshot ?? null;
        const screenshotFromExisting = existing ? parseScreenshotMeta(existing.rawRowJson) : null;
        const screenshot = screenshotFromPayload ?? screenshotFromExisting;
        const orderId = existing?.orderId || buildManualBatchOrderId(batch.id, index + 1);
        const transactionTime = new Date(row.transactionTime);
        const amount = Math.abs(Number(row.amount));
        const normalizedAmount = Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
        const billAccount = row.billAccount.trim();
        const description = row.description.trim();
        const direction = row.direction;
        const dedupeKey = buildManualDedupeKey(billAccount, orderId, direction);

        return {
          id: row.id,
          orderId,
          dedupeKey,
          transactionTime,
          direction,
          amount: normalizedAmount,
          description,
          billAccount,
          screenshot
        };
      })
      .filter((row) => !Number.isNaN(row.transactionTime.getTime()));

    if (updatePayload.length !== payloadRows.length) {
      return reply.status(400).send({
        message: "存在无效交易时间，请检查后重试"
      });
    }

    const dedupeSet = new Set<string>();
    for (const row of updatePayload) {
      if (dedupeSet.has(row.dedupeKey)) {
        return reply.status(400).send({
          message: "批次内存在重复记录，请检查账单账号/收支方向是否冲突"
        });
      }
      dedupeSet.add(row.dedupeKey);
    }

    const conflictRows = await prisma.qualifiedTransaction.findMany({
      where: {
        dedupeKey: {
          in: [...dedupeSet]
        },
        batchId: {
          not: batch.id
        }
      },
      select: {
        dedupeKey: true,
        batchId: true
      },
      take: 1
    });
    if (conflictRows.length > 0) {
      return reply.status(409).send({
        message: "与其他批次存在重复记录键冲突，请调整后重试"
      });
    }

    const uniqueAccounts = [...new Set(updatePayload.map((row) => row.billAccount))];
    const nextBillAccount = uniqueAccounts.length === 1 ? uniqueAccounts[0] ?? "unknown" : "multiple";
    const currentMeta = pickRawMetaObject(batch.rawMetaJson);
    const nextMeta = {
      ...currentMeta,
      parser: "manual_form",
      totalParsed: updatePayload.length,
      qualifiedCount: updatePayload.length,
      unqualifiedCount: 0,
      accountCount: uniqueAccounts.length,
      manualBatchEditedAt: new Date().toISOString()
    };

    await prisma.$transaction(async (tx) => {
      if (deleteIds.length > 0) {
        await tx.qualifiedTransaction.deleteMany({
          where: {
            id: {
              in: deleteIds
            }
          }
        });
      }

      const createData: Prisma.QualifiedTransactionCreateManyInput[] = [];
      for (const row of updatePayload) {
        const rawRow = {
          source: MANUAL_SOURCE_TYPE,
          direction: row.direction,
          amount: row.amount,
          status: MANUAL_SUCCESS_STATUS,
          description: row.description,
          billAccount: row.billAccount,
          screenshot: row.screenshot ?? null
        };
        const remark = row.screenshot ? `手动添加截图:${row.screenshot.fileName}` : "手动添加";

        if (row.id) {
          await tx.qualifiedTransaction.update({
            where: {
              id: row.id
            },
            data: {
              transactionTime: row.transactionTime,
              orderId: row.orderId,
              merchantOrderId: "",
              description: row.description,
              direction: row.direction,
              amount: row.amount,
              status: MANUAL_SUCCESS_STATUS,
              category: MANUAL_CATEGORY,
              internalTransfer: false,
              billAccount: row.billAccount,
              remark,
              rawRowJson: toPrismaJson(rawRow),
              dedupeKey: row.dedupeKey
            }
          });
          continue;
        }

        createData.push({
          batchId: batch.id,
          dedupeKey: row.dedupeKey,
          transactionTime: row.transactionTime,
          orderId: row.orderId,
          merchantOrderId: "",
          description: row.description,
          direction: row.direction,
          amount: row.amount,
          status: MANUAL_SUCCESS_STATUS,
          category: MANUAL_CATEGORY,
          internalTransfer: false,
          billAccount: row.billAccount,
          remark,
          rawRowJson: toPrismaJson(rawRow)
        });
      }

      if (createData.length > 0) {
        await tx.qualifiedTransaction.createMany({
          data: createData
        });
      }

      await tx.importBatch.update({
        where: {
          id: batch.id
        },
        data: {
          billAccount: nextBillAccount,
          rawMetaJson: toPrismaJson(nextMeta)
        }
      });
    });

    return reply.send({
      batchId: batch.id,
      sourceType: batch.sourceType,
      billAccount: nextBillAccount,
      fileName: batch.fileName,
      totalParsed: updatePayload.length,
      qualifiedCount: updatePayload.length,
      byCategory: createCategorySummary(updatePayload.length)
    });
  });

  app.post("/imports/text", async (request, reply) => {
    const parsed = importTextSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "请求参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const content = parsed.data.content.trim();
    if (!content) {
      return reply.status(400).send({
        message: "请输入要导入的文本内容"
      });
    }

    const fileName = parsed.data.fileName?.trim() || "manual-input.txt";
    const result = await importQualifiedTransactions(fileName, Buffer.from(content, "utf8"));
    return reply.send(result);
  });

  app.post("/imports/manual", async (request, reply) => {
    let payloadRaw = "";
    const screenshots = new Map<
      string,
      {
        fileName: string;
        mimeType: string;
        size: number;
        sha256: string;
        storagePath: string;
      }
    >();

    for await (const part of request.parts()) {
      if (part.type === "file") {
        const fileBuffer = await part.toBuffer();
        const sha256 = createHash("sha256").update(fileBuffer.toString("base64")).digest("hex");
        const safeOriginalName = sanitizeFileName(part.filename || "upload.bin");
        const storedFileName = `${Date.now()}-${sha256.slice(0, 12)}-${safeOriginalName}`;
        const storedAbsolutePath = path.join(MANUAL_SCREENSHOT_DIR, storedFileName);
        await mkdir(MANUAL_SCREENSHOT_DIR, { recursive: true });
        await writeFile(storedAbsolutePath, new Uint8Array(fileBuffer));

        screenshots.set(part.fieldname, {
          fileName: part.filename,
          mimeType: part.mimetype,
          size: fileBuffer.length,
          sha256,
          storagePath: `storage/manual-screenshots/${storedFileName}`
        });
        continue;
      }

      if (part.fieldname === "payload") {
        payloadRaw = String(part.value ?? "");
      }
    }

    if (!payloadRaw.trim()) {
      return reply.status(400).send({
        message: "缺少手动导入 payload"
      });
    }

    let payloadUnknown: unknown;
    try {
      payloadUnknown = JSON.parse(payloadRaw);
    } catch {
      return reply.status(400).send({
        message: "payload 不是合法 JSON"
      });
    }

    const parsed = manualImportPayloadSchema.safeParse(payloadUnknown);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "请求参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const rows = parsed.data.rows.map((row) => {
      const mapped: {
        direction: "income" | "expense";
        transactionTime?: string;
        amount: number;
        description: string;
        billAccount?: string;
        screenshot?: {
          fileName: string;
          mimeType: string;
          size: number;
          sha256: string;
          storagePath: string;
        };
      } = {
        direction: row.direction,
        amount: Math.abs(row.amount),
        description: row.description.trim()
      };

      if (row.transactionTime?.trim()) {
        mapped.transactionTime = row.transactionTime.trim();
      }

      const billAccount = row.billAccount?.trim();
      if (billAccount) {
        mapped.billAccount = billAccount;
      }

      const screenshot = row.screenshotField ? screenshots.get(row.screenshotField) : undefined;
      if (screenshot) {
        mapped.screenshot = screenshot;
      }

      return mapped;
    });

    const result = await importManualTransactions({
      fileName: parsed.data.fileName?.trim() || "manual-form",
      rows
    });

    return reply.send(result);
  });
}
