import { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { importManualTransactions, importQualifiedTransactions } from "../lib/import-service.js";

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

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/imports", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ message: "请上传账单文件，字段名为 file" });
    }

    const buffer = await file.toBuffer();
    const result = await importQualifiedTransactions(file.filename || "upload.csv", buffer);

    return reply.send(result);
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
