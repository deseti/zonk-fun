#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
container_name="zonk-phase4-migration-${$}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --rm -d --name "$container_name" -e POSTGRES_DB=zonk_test -e POSTGRES_USER=zonk_test -e POSTGRES_PASSWORD=zonk_test postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$container_name" psql -U zonk_test -d postgres -tAc 'SELECT 1' >/dev/null 2>&1 && docker exec "$container_name" psql -U zonk_test -d zonk_test -tAc 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U zonk_test -d zonk_test < "$root_dir/db/migrations/001_indexer.sql" >/dev/null
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U zonk_test -d zonk_test -c "
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='chain_events') THEN RAISE EXCEPTION 'chain_events missing'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='chain_blocks_one_canonical_height') THEN RAISE EXCEPTION 'canonical block index missing'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chain_events_chain_id_transaction_hash_log_index_key') THEN RAISE EXCEPTION 'event identity constraint missing'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chain_events_block_fk') THEN RAISE EXCEPTION 'event block foreign key missing'; END IF;
  END \$\$;" >/dev/null
echo "Phase 4 PostgreSQL migration validation passed."
