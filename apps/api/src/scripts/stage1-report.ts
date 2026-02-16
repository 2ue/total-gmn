import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAndFilterTransactions, createCategoryCounter } from "@total-gmn/shared";
import { parseStatementFile } from "../lib/parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const files = [
  "../../../../支付宝交易明细(20251115-20260215).csv",
  "../../../../支付宝交易明细(20251115-20260215)-wx.csv"
];

async function main() {
  let totalParsed = 0;
  let qualifiedCount = 0;
  const byCategory = createCategoryCounter();

  for (const relativePath of files) {
    const absolutePath = path.resolve(__dirname, relativePath);
    const content = await readFile(absolutePath);
    const parsed = parseStatementFile(path.basename(absolutePath), content);
    const qualified = classifyAndFilterTransactions(parsed.transactions);

    totalParsed += parsed.transactions.length;
    qualifiedCount += qualified.length;

    for (const item of qualified) {
      byCategory[item.category] += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalParsed,
        qualifiedCount,
        byCategory
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
