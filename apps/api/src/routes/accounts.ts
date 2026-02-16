import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/accounts", async () => {
    const rows = await prisma.qualifiedTransaction.groupBy({
      by: ["billAccount"],
      _count: {
        _all: true
      },
      orderBy: {
        billAccount: "asc"
      }
    });

    return {
      items: rows.map((row) => ({
        billAccount: row.billAccount,
        count: row._count._all
      }))
    };
  });
}
