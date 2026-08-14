#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
container_name="zonk-stage2-migration-${$}"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --rm -d --name "$container_name" \
  -p 127.0.0.1::5432 \
  -v "$root_dir/db:/zonk-db:ro" \
  -e POSTGRES_DB=postgres \
  -e POSTGRES_USER=zonk_test \
  -e POSTGRES_PASSWORD=zonk_test \
  postgres:17-alpine >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready -U zonk_test -d postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "PostgreSQL validation container did not become ready" >&2
  exit 1
fi

for database in empty_test existing_test partial_test; do
  docker exec "$container_name" createdb -U zonk_test "$database"
done

# Simulate a populated pre-ledger database. The ordered migrator must preserve
# the historical row without exposing a legacy runtime field.
for database in existing_test partial_test; do
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U zonk_test -d "$database" < "$root_dir/db/migrations/001_indexer.sql" >/dev/null
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U zonk_test -d "$database" < "$root_dir/db/migrations/002_token_metadata.sql" >/dev/null
done
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U zonk_test -d existing_test -c "
  INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp)
  VALUES(84532,1,'0xhistoricalblock','0xparent',1);
  INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,block_number,block_hash,transaction_hash,log_index)
  VALUES(84532,'0x0000000000000000000000000000000000000001','0x0000000000000000000000000000000000000002','Historical','HST',1000,1,'0xhistoricalblock','0xhistoricaltx',0);" >/dev/null

for database in empty_test existing_test; do
  database_url="postgresql://zonk_test:zonk_test@127.0.0.1:5432/$database?sslmode=disable"
  docker exec -e DATABASE_URL="$database_url" "$container_name" /bin/sh /zonk-db/migrate.sh >/dev/null
  docker exec -e DATABASE_URL="$database_url" "$container_name" /bin/sh /zonk-db/migrate.sh >/dev/null
  docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U zonk_test -d "$database" -tAc "
    DO \$\$ BEGIN
      IF (SELECT array_agg(version ORDER BY version) FROM schema_migrations) IS DISTINCT FROM ARRAY[1,2,3,4,5,6,7] THEN RAISE EXCEPTION 'migration versions invalid'; END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='graduations' AND column_name='orphaned_at') THEN RAISE EXCEPTION 'orphaned_at missing'; END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='token_metrics' AND column_name='current_price') THEN RAISE EXCEPTION 'current_price missing'; END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='token_metrics' AND column_name='fully_diluted_value') THEN RAISE EXCEPTION 'fully_diluted_value missing'; END IF;
      IF to_regclass('public.token_holder_balances') IS NULL OR to_regclass('public.token_trade_buckets') IS NULL THEN RAISE EXCEPTION 'analytics tables missing'; END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='token_trade_buckets' AND column_name='open_price') THEN RAISE EXCEPTION 'OHLC columns missing'; END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tokens' AND column_name='is_legacy') THEN RAISE EXCEPTION 'legacy runtime column still present'; END IF;
    END \$\$;" >/dev/null
done

docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U zonk_test -d existing_test -tAc "
  DO \$\$ BEGIN
    IF NOT (SELECT count(*)=1 FROM tokens WHERE token_address='0x0000000000000000000000000000000000000001') THEN
      RAISE EXCEPTION 'historical row was not preserved';
    END IF;
  END \$\$;" >/dev/null

host_port=$(docker port "$container_name" 5432/tcp | tail -n 1 | sed 's/.*://')
prepared_url="postgresql://zonk_test:zonk_test@127.0.0.1:${host_port}/empty_test?sslmode=disable"
unprepared_url="postgresql://zonk_test:zonk_test@127.0.0.1:${host_port}/partial_test?sslmode=disable"

(
  cd "$root_dir/apps/indexer"
  INDEXER_TEST_DATABASE_URL="$prepared_url" UNPREPARED_TEST_DATABASE_URL="$unprepared_url" go test ./...
)
(
  cd "$root_dir/apps/api"
  API_TEST_DATABASE_URL="$prepared_url" UNPREPARED_TEST_DATABASE_URL="$unprepared_url" go test ./...
)

compose_json=$(env \
  POSTGRES_DB=zonk POSTGRES_USER=zonk POSTGRES_PASSWORD=local-test \
  DATABASE_URL=postgresql://zonk:local-test@postgres:5432/zonk \
  NEXT_PUBLIC_PRIVY_APP_ID=test \
  NEXT_PUBLIC_ZONK_FACTORY_V3_ADDRESS=0x0000000000000000000000000000000000000001 \
  docker compose -f "$root_dir/compose.yaml" config --format json)
COMPOSE_JSON="$compose_json" python3 -c '
import json, os
services = json.loads(os.environ["COMPOSE_JSON"])["services"]
for service in ("api", "indexer"):
    dependency = services[service]["depends_on"].get("migrate", {})
    assert dependency.get("condition") == "service_completed_successfully", (service, dependency)
'

echo "Stage 2 migrations, startup ordering, PostgreSQL projections, reorg handling, and API compatibility validation passed."
