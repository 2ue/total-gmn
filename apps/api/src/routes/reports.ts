import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ProfitMetric,
  ProfitFilters,
  queryProfitDetails,
  queryProfitSummary
} from "../lib/profit-report.js";

const summaryQuerySchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  billAccount: z.string().optional()
});

const detailsQuerySchema = z.object({
  metric: z.enum([
    "main_settled_income",
    "main_pending_income",
    "main_expense",
    "traffic_cost",
    "platform_commission",
    "main_closed",
    "business_refund_expense"
  ]),
  start: z.string().optional(),
  end: z.string().optional(),
  billAccount: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

function parseDateInput(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

function buildProfitFilters(input: {
  start?: string | undefined;
  end?: string | undefined;
  billAccount?: string | undefined;
}): ProfitFilters {
  const filters: ProfitFilters = {};
  const start = parseDateInput(input.start);
  const end = parseDateInput(input.end);

  if (start) {
    filters.start = start;
  }

  if (end) {
    filters.end = end;
  }

  if (input.billAccount) {
    filters.billAccount = input.billAccount;
  }

  return filters;
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reports/profit", async (request, reply) => {
    const parsed = summaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "查询参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const summary = await queryProfitSummary(buildProfitFilters(parsed.data));

    return reply.send({ summary });
  });

  app.get("/reports/profit/details", async (request, reply) => {
    const parsed = detailsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "查询参数不合法",
        errors: parsed.error.flatten()
      });
    }

    const details = await queryProfitDetails({
      filters: buildProfitFilters(parsed.data),
      metric: parsed.data.metric as ProfitMetric,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize
    });

    return reply.send({
      metric: parsed.data.metric,
      ...details
    });
  });
}
