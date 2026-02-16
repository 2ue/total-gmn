# Docker 与 GitHub Actions 部署说明

## 1. 镜像构建（本地）

本项目拆分为两个镜像：

- API：`total-gmn-api`
- Web：`total-gmn-web`

构建命令：

```bash
# API
docker build -f apps/api/Dockerfile -t total-gmn-api:test .

# Web（默认把前端 API 地址构建为 /api）
docker build -f apps/web/Dockerfile -t total-gmn-web:test --build-arg VITE_API_BASE=/api .
```

## 2. 本地容器启动

```bash
docker compose up -d
# 如果你的 Docker 环境未启用 compose 子命令，可改用：
# docker-compose up -d
```

默认端口：

- Web: `http://localhost:8080`
- API: `http://localhost:3001`

## 3. GitHub Actions 工作流

已新增：

- `.github/workflows/docker-publish.yml`
  - 触发：`tag push (v*.*.*)` 或手动触发
  - 发布 GHCR 两个镜像：
    - `ghcr.io/<owner>/total-gmn-api:<tag>`
    - `ghcr.io/<owner>/total-gmn-web:<tag>`
  - 如配置了 Docker Hub 变量/密钥，也会同步发布 Docker Hub

- `.github/workflows/deploy-server.yml`
  - 触发：`tag push (v*.*.*)` 或手动触发
  - 行为：通过 SSH 上传 `deploy/docker-compose.prod.yml` 到服务器并执行 `docker compose pull && up -d`

## 4. 需要配置的 Variables / Secrets

### 4.1 Docker 发布

- `secrets.DOCKERHUB_USERNAME`（可选，不配则只发 GHCR）
- `secrets.DOCKERHUB_TOKEN`（可选）

### 4.2 服务器部署

- `secrets.DEPLOY_HOST`
- `secrets.DEPLOY_USER`
- `secrets.DEPLOY_SSH_KEY`
- `secrets.DEPLOY_PATH`
- `secrets.DEPLOY_DATABASE_URL`（可选）
- `secrets.DEPLOY_PROFIT_INCLUDE_CLOSED_DIRECTION_IN_PROFIT`（可选）
- `secrets.DEPLOY_WEB_PORT`（可选）

## 5. 关于“能否完全移植 star-man 的工作流”

不能“完全不改”直接移植，原因：

1. 当前仓库是 monorepo，且前后端分为两个镜像，不是单镜像。
2. Web 需要 `VITE_API_BASE` 构建参数与 Nginx 反向代理配置。
3. API 运行前需要执行 `prisma db push`。
4. 服务器部署需下发 `docker-compose.prod.yml` 并注入项目变量。

已做法：保留你原方案的核心（tag 触发、buildx、多平台、双仓库发布、自动部署），并按本项目结构完成适配。
