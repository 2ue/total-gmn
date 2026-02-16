## 1. 阶段1-工程初始化（必须先完成）

执行说明：
- 目标：完成可运行的前后端与数据库基础骨架。
- 建议命令：
  - `pnpm init`
  - `pnpm -w add -D typescript tsx eslint prettier`
  - `pnpm create vite apps/web --template react-ts`
  - `pnpm add -C apps/web tailwindcss @tailwindcss/vite lucide-react`
  - `pnpm add -C apps/api fastify zod`
  - `pnpm add -C apps/api -D prisma tsx typescript`
  - `pnpm add -C apps/api @prisma/client`

- [x] 1.1 创建 `pnpm-workspace.yaml`，包含 `apps/*` 与 `packages/*`
- [x] 1.2 建立 `apps/web`、`apps/api`、`packages/shared` 目录与基础脚本
- [x] 1.3 建立 TypeScript 基础配置（根 `tsconfig.base.json` + 子项目继承）
- [x] 1.4 初始化 TailwindCSS 和图标库，确认前端可启动
- [x] 1.5 初始化 Prisma（SQLite），确认后端可启动

验收标准：
- `pnpm -w run build` 可执行。
- `apps/web` 和 `apps/api` 能分别本地启动。

## 2. 阶段1-数据库与模型（必须完成）

执行说明：
- 目标：先有可存储“符合条件交易”的最小表结构。
- 关键表：`ImportBatch`、`QualifiedTransaction`。

- [x] 2.1 设计 `ImportBatch`：`id, sourceType, fileName, billAccount, importedAt, rawMetaJson`
- [x] 2.2 设计 `QualifiedTransaction`：`id, batchId, transactionTime, orderId, merchantOrderId, description, direction, amount, status, category, rawRowJson`
- [x] 2.3 为 `transactionTime`、`orderId`、`category`、`status` 建立索引
- [x] 2.4 执行 Prisma 迁移并提交迁移文件

验收标准：
- `pnpm -C apps/api prisma migrate dev` 成功。
- SQLite 中可看到两张表与索引。

## 3. 阶段1-导入解析（必须完成）

执行说明：
- 目标：解析两类 CSV，并提取账单账号与交易行。
- 输入：支付宝原始 CSV（GB18030）与简化 CSV（金额,备注）。

- [x] 3.1 实现支付宝 CSV 解码与表头定位（从 `交易时间,交易分类,交易对方` 开始）
- [x] 3.2 实现导出头解析，提取 `支付宝账户` 到 `billAccount`
- [x] 3.3 实现简化 CSV 解析（正数收入、负数支出、备注回填描述）
- [x] 3.4 标准化字段映射（时间、金额、订单号、状态、描述、备注）
- [x] 3.5 保留 `rawRowJson`，用于后续审计与调试

验收标准：
- 导入参考账单时无解析报错。
- 每条入库记录都含 `billAccount` 与 `rawRowJson`。

## 4. 阶段1-符合条件筛选与入库（必须完成）

执行说明：
- 目标：只导入“符合条件数据”，统计逻辑先不做复杂聚合。
- 条件：
  - 时间：`>= 2025-12-30 00:00:00`
  - 主营关键词（不区分大小写）：`codex|gemini|90刀|满血api|90d`
  - 排除：`批量|批发`
  - 补充主营：`商品说明=闲鱼转账`
  - 成本分类：`闲鱼超级擦亮充值`、`分账-`

- [x] 4.1 实现时间过滤与关键词命中逻辑
- [x] 4.2 实现排除词优先级（命中排除词则不进入主营）
- [x] 4.3 实现显式分类（主营、流量成本、平台抽成、关闭、其他）
- [x] 4.4 按 `交易订单号` 去重，重复时保留最新状态记录
- [x] 4.5 同订单号一收一支时标记 `internal_transfer`
- [x] 4.6 仅将符合条件记录写入 `QualifiedTransaction`

验收标准：
- 导入后可查到“符合条件记录”。
- 非符合条件消费记录不进入 `QualifiedTransaction`。

## 5. 阶段1-接口与页面（必须完成）

执行说明：
- 目标：先交付“导入+明细可查”。

- [x] 5.1 实现导入接口：上传文件、解析、筛选、入库、返回批次结果
- [x] 5.2 实现明细接口：按时间、账号、分类、状态筛选
- [x] 5.3 实现导入页面：上传与导入结果提示
- [x] 5.4 实现明细页面：列表展示 `transactionTime, description, direction, amount, status, category, orderId`

验收标准：
- 用户可从页面导入两份参考账单并看到符合条件明细。
- 明细筛选可用。

## 6. 阶段1-回归与交付（必须完成）

执行说明：
- 目标：确保阶段1可独立交付。

- [x] 6.1 编写解析测试（支付宝 CSV + 简化 CSV）
- [x] 6.2 编写筛选测试（关键词/排除词/时间窗口）
- [x] 6.3 编写去重与内部互转标记测试
- [x] 6.4 生成阶段1导入报告（总导入数、符合条件数、按分类数量）
- [x] 6.5 运行 `openspec validate alipay-business-stats-app --strict`

验收标准：
- 阶段1报告可复现。
- OpenSpec 校验通过。

## 7. 阶段2-统计逻辑（后续，不阻塞阶段1）

- [x] 7.1 增加主营已到账/待到账/关闭/主营退款支出聚合
- [x] 7.2 增加纯收益计算与统计页面
- [x] 7.3 增加回归基准校验（参考账单基准值）

## 8. 阶段2-分润逻辑（后续，不阻塞阶段1）

- [x] 8.1 增加 `SettlementBatch` 表与有效批次机制
- [x] 8.2 实现累计法 `P(T)=C(T)-S(T)` 计算器
- [x] 8.3 实现负值结转、批次删除重算与历史台账页面
