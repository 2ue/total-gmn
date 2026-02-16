import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";

type ParticipantClient = PrismaClient | Prisma.TransactionClient;

export interface ProfitParticipantInput {
  id?: string | undefined;
  name: string;
  billAccount?: string | null | undefined;
  ratio: number;
  note?: string | undefined;
}

export interface ProfitParticipantItem {
  id: string;
  name: string;
  billAccount: string | null;
  ratio: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

function normalizeBillAccount(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeRatio(value: number): number {
  return Number(value.toFixed(6));
}

function toParticipantItem(row: {
  id: string;
  name: string;
  billAccount: string | null;
  ratio: Prisma.Decimal;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}): ProfitParticipantItem {
  return {
    id: row.id,
    name: row.name,
    billAccount: row.billAccount,
    ratio: row.ratio.toString(),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function validateParticipantInputs(items: ProfitParticipantInput[]) {
  if (items.length === 0) {
    throw new Error("至少保留一个分润者");
  }

  const billAccountSet = new Set<string>();
  let totalRatio = 0;

  for (const item of items) {
    const name = item.name.trim();
    if (!name) {
      throw new Error("分润者名称不能为空");
    }

    const ratio = normalizeRatio(item.ratio);
    totalRatio += ratio;

    const billAccount = normalizeBillAccount(item.billAccount);
    if (billAccount) {
      if (billAccountSet.has(billAccount)) {
        throw new Error(`账单账号 ${billAccount} 只能绑定一个分润者`);
      }
      billAccountSet.add(billAccount);
    }
  }

  const normalizedTotal = normalizeRatio(totalRatio);
  if (Math.abs(normalizedTotal - 1) > 0.000001) {
    throw new Error("分润比例总和必须为 100%");
  }
}

export async function listProfitParticipants(
  client: ParticipantClient = prisma
): Promise<ProfitParticipantItem[]> {
  const rows = await client.profitParticipant.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      billAccount: true,
      ratio: true,
      note: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return rows.map(toParticipantItem);
}

export function sumParticipantRatios(items: Array<{ ratio: string }>): string {
  const total = items.reduce((sum, item) => sum + Number(item.ratio), 0);
  return normalizeRatio(total).toString();
}

export async function saveProfitParticipants(
  inputs: ProfitParticipantInput[]
): Promise<ProfitParticipantItem[]> {
  validateParticipantInputs(inputs);

  return prisma.$transaction(async (tx) => {
    const existingRows = await tx.profitParticipant.findMany({
      select: {
        id: true
      }
    });
    const existingIds = new Set(existingRows.map((row) => row.id));
    const retainedIds: string[] = [];

    for (const input of inputs) {
      const data = {
        name: input.name.trim(),
        billAccount: normalizeBillAccount(input.billAccount),
        ratio: new Prisma.Decimal(normalizeRatio(input.ratio).toFixed(6)),
        note: input.note?.trim() ?? ""
      };

      if (input.id && existingIds.has(input.id)) {
        const updated = await tx.profitParticipant.update({
          where: {
            id: input.id
          },
          data,
          select: {
            id: true
          }
        });
        retainedIds.push(updated.id);
        continue;
      }

      const created = await tx.profitParticipant.create({
        data,
        select: {
          id: true
        }
      });
      retainedIds.push(created.id);
    }

    if (retainedIds.length === 0) {
      await tx.profitParticipant.deleteMany({});
    } else {
      await tx.profitParticipant.deleteMany({
        where: {
          id: {
            notIn: retainedIds
          }
        }
      });
    }

    return listProfitParticipants(tx);
  });
}
