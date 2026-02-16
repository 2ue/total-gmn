# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm -w build
RUN pnpm --filter @total-gmn/api prisma generate

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @total-gmn/api prisma db push && node apps/api/dist/server.js"]
