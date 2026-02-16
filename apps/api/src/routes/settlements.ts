import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SETTLEMENT_STRATEGIES,
  SettlementStrategy,
  createSettlementBatch,
  listSettlementBatches,
  previewSettlementFormatted
} from "../lib/settlement.js";

const previewQuerySchema = z.object({
  settlementTime: z.string().optional(),
  strategy: z.enum(SETTLEMENT_STRATEGIES).optional(),
  billAccount: z.string().optional(),
  carryRatio: z.coerce.number().min(0).max(1).optional()
});

const createBodySchema = z.object({
  settlementTime: z.string().optional(),
  strategy: z.enum(SETTLEMENT_STRATEGIES).optional(),
  billAccount: z.string().optional(),
  carryRatio: z.coerce.number().min(0).max(1).optional(),
  note: z.string().max(2000).optional()
});

const listQuerySchema = z.object({
  strategy: z.enum(SETTLEMENT_STRATEGIES).optional(),
  billAccount: z.string().optional()
});

const deleteParamSchema = z.object({
  id: z.string().min(1)
});

function parseSettlementTime(value?: string): Date {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("结算时间格式不正确");
  }

  parsed.setHours(23, 59, 59, 0);
  return parsed;
}

export async function registerSettlementRoutes(app: FastifyInstance): Promise<void> {
  app.get("/settlements/preview", async (request, reply) => {
    const parsed = previewQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "查询参数不合法",
        errors: parsed.error.flatten()
      });
    }

    try {
      const preview = await previewSettlementFormatted(
        parseSettlementTime(parsed.data.settlementTime),
        parsed.data.strategy,
        parsed.data.billAccount,
        parsed.data.carryRatio
      );
      return reply.send(preview);
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "预览失败"
      });
    }
  });

  app.post("/settlements", async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "请求参数不合法",
        errors: parsed.error.flatten()
      });
    }

    try {
      const createInput: {
        settlementTime: Date;
        strategy?: SettlementStrategy;
        billAccount?: string;
        carryRatio?: number;
        note?: string;
      } = {
        settlementTime: parseSettlementTime(parsed.data.settlementTime)
      };
      if (parsed.data.strategy !== undefined) {
        createInput.strategy = parsed.data.strategy;
      }
      if (parsed.data.billAccount !== undefined) {
        createInput.billAccount = parsed.data.billAccount;
      }
      if (parsed.data.carryRatio !== undefined) {
        createInput.carryRatio = parsed.data.carryRatio;
      }
      if (parsed.data.note !== undefined) {
        createInput.note = parsed.data.note;
      }

      const created = await createSettlementBatch(createInput);
      return reply.send(created);
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "创建分润批次失败"
      });
    }
  });

  app.get("/settlements", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "查询参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const items = await listSettlementBatches(parsed.data.strategy, parsed.data.billAccount);
    return { items };
  });

  app.delete("/settlements/:id", async (request, reply) => {
    const parsed = deleteParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "路径参数不合法",
        errors: parsed.error.flatten()
      });
    }

    return reply.status(403).send({
      message: "历史分润批次不允许删除"
    });
  });
}
