import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listProfitParticipants,
  saveProfitParticipants,
  sumParticipantRatios
} from "../lib/profit-participants.js";

const participantItemSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  billAccount: z.string().trim().max(200).optional().nullable(),
  ratio: z.coerce.number().min(0).max(1),
  note: z.string().max(1000).optional()
});

const saveBodySchema = z.object({
  items: z.array(participantItemSchema).min(1)
});

export async function registerProfitParticipantRoutes(app: FastifyInstance): Promise<void> {
  app.get("/profit-participants", async () => {
    const items = await listProfitParticipants();
    return {
      items,
      totalRatio: sumParticipantRatios(items)
    };
  });

  app.put("/profit-participants", async (request, reply) => {
    const parsed = saveBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "请求参数不合法",
        errors: parsed.error.flatten()
      });
    }

    try {
      const items = await saveProfitParticipants(parsed.data.items);
      return reply.send({
        items,
        totalRatio: sumParticipantRatios(items)
      });
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "保存分润者配置失败"
      });
    }
  });
}
