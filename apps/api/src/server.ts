import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { prisma } from "./db.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerProfitParticipantRoutes } from "./routes/profit-participants.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerSettlementRoutes } from "./routes/settlements.js";
import { registerTransactionRoutes } from "./routes/transactions.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  });
  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024
    }
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(registerImportRoutes, { prefix: "/api" });
  await app.register(registerAccountRoutes, { prefix: "/api" });
  await app.register(registerProfitParticipantRoutes, { prefix: "/api" });
  await app.register(registerTransactionRoutes, { prefix: "/api" });
  await app.register(registerReportRoutes, { prefix: "/api" });
  await app.register(registerSettlementRoutes, { prefix: "/api" });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}

async function bootstrap() {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

bootstrap();
