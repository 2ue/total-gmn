# 闲鱼账单与分润管理台（total-gmn）

用于导入支付宝账单、查看交易明细与统计报表，并按分润配置生成分润批次（支持留存比例）。

## 技术栈

- Monorepo: `pnpm workspace`
- Web: `React + Vite + TypeScript`
- API: `Fastify + Prisma + SQLite`
- Shared: `packages/shared`

## 目录结构

- `apps/web`: 前端页面
- `apps/api`: 后端接口、分润与统计逻辑
- `packages/shared`: 前后端共享类型与工具
- `docs`: 业务与实现说明文档

## 文档

- `docs/导入统计与分润计算逻辑.md`：业务逻辑文档索引（以代码实现为准）
- `docs/业务逻辑/01-系统总览与实体关系.md`：系统边界、模块职责、实体关系与端到端链路
- `docs/业务逻辑/02-导入与入库规则.md`：导入格式、分类过滤、去重幂等、手动导入与批次编辑
- `docs/业务逻辑/03-统计口径与报表规则.md`：明细汇总、图表指标、利润报表口径与差异
- `docs/业务逻辑/04-分润与结算规则.md`：分润者配置、累计/增量分润、累计目标补差与个人差量分配
- `docs/业务逻辑/06-202603账单增量导入对照说明.md`：本次增量账单导入的覆盖、退款、漏判与风险说明
- `docs/Docker与GitHubActions部署.md`：Docker 构建、镜像发布与服务器部署说明

## 环境要求

- Node.js `>=20`
- pnpm `>=9`

## 快速启动

1. 安装依赖

```bash
pnpm install
```

2. 配置 API 环境变量（`apps/api/.env`）

```env
DATABASE_URL="file:./dev.db"
PROFIT_INCLUDE_CLOSED_DIRECTION_IN_PROFIT=true
```

3. 配置 Web 环境变量（`apps/web/.env`，可选）

```env
VITE_API_BASE=http://localhost:3001/api
VITE_DEFAULT_SETTLEMENT_CARRY_PERCENT=30
```

4. 初始化 Prisma Client 与数据库

```bash
pnpm --filter @total-gmn/api prisma generate
pnpm --filter @total-gmn/api prisma db push
```

5. 启动前后端开发服务

```bash
pnpm dev
```

- Web 默认地址: `http://localhost:5173`
- API 默认地址: `http://localhost:3001/api`

## 常用命令

```bash
pnpm test
pnpm build
```

仅启动单个应用：

```bash
pnpm --filter @total-gmn/api dev
pnpm --filter @total-gmn/web dev
```

## Docker 部署

本项目默认使用远端镜像（API + Web）：

```bash
# 1) 复制环境变量
cp .env.example .env

# 2) 如 GHCR 镜像是私有仓库，先登录（公开仓库可跳过）
# echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin

# 3) 启动
docker compose up -d
```

默认访问：

- Web: `http://localhost:8080`
- API: `http://localhost:3001`

可在 `.env` 中修改 `IMAGE_TAG`、`WEB_PORT`、`API_PORT`。
