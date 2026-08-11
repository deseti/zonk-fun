# zonk.fun

Base-native permissionless token launch infrastructure.

## Status

Project foundation is under active development.

Current development target:

- modular monorepo
- Base Sepolia first
- Base Mainnet after security and E2E validation
- non-custodial wallet execution
- onchain financial state as source of truth

## Repository

- apps/web — Next.js frontend
- apps/api — Go HTTP API
- apps/indexer — Go Base blockchain indexer
- contracts — Solidity / Foundry contracts
- packages/contracts-sdk — shared contract integration layer
- packages/shared — shared TypeScript utilities
- packages/config — shared configuration
- packages/types — shared types
- db — migrations, queries, and seeds
- infra — local and production infrastructure assets
- docs — architecture and operational documentation

## Local Development

Prerequisites: Docker with Compose, Node.js 22+, pnpm 10.33.0, Go 1.26+, and Foundry.

Install dependencies and copy the safe local configuration:

```shell
pnpm install --frozen-lockfile
cp .env.example .env
```

Before starting Compose, replace `replace_with_local_secret` in `.env` with a
unique local-only PostgreSQL password in both `POSTGRES_PASSWORD` and
`DATABASE_URL`. Do not reuse a production credential or commit `.env`.
Compose fails closed when the required PostgreSQL variables are missing.

Start the complete local stack:

```shell
docker compose up -d --build
docker compose ps
```

The local services are available at:

- web: http://localhost:3000
- API: http://localhost:4000
- API health: http://localhost:4000/health
- PostgreSQL: localhost:15434 (local host only)
- Redis: internal Compose network only; it is not published to the host

The indexer runs in explicit idle development mode when no RPC URL is configured.
Set `BASE_SEPOLIA_RPC_URL` in `.env` only when a local validation environment provides
an RPC endpoint. Base Sepolia is the configured target network; no credentials are
required for Phase 0.

Run the complete local validation suite:

```shell
pnpm install --frozen-lockfile
pnpm --filter web lint
pnpm --filter web exec tsc --noEmit
pnpm --filter web build
cd apps/api && go test ./... && go build ./cmd/server
cd ../indexer && go test ./... && go build ./cmd/indexer
cd ../../contracts && forge build && forge test
cd ../ && docker compose config
```

Stop local services with `docker compose down`. `make validate` remains available as
a shorthand for the non-Compose checks.

## Security

Never commit private keys, seed phrases, wallet credentials, RPC secrets,
database credentials, API keys, or production .env files.
