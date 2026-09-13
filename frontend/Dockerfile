# Next.js（画面 + BFF、design.md 2.1、2.3）。本番は Azure Container Apps の外部 Ingress で動かす
FROM node:24.21.0-slim AS base
# ベースイメージの OS パッケージに出ているセキュリティ更新を取り込む（2026-09-14 時点で libpcre2 に更新あり）
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# package-lock.json どおりに依存を入れる
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 実行に必要なファイル（standalone 出力）だけを載せ、root 以外のユーザーで動かす
FROM base AS runner
ENV NODE_ENV=production \
    TZ=Asia/Tokyo \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
