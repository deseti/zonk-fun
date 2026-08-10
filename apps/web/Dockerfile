FROM node:22-alpine

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY apps/web ./apps/web
RUN pnpm --filter web build

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
