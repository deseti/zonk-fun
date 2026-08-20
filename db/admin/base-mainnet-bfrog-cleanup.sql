\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply false
\endif

-- This procedure changes application-derived PostgreSQL state only. It never
-- sends an RPC request or transaction and never mutates Base Mainnet.
BEGIN;

DO $$
DECLARE
  launch_count bigint;
BEGIN
  IF current_setting('transaction_read_only') = 'on' THEN
    RETURN;
  END IF;
  SELECT count(*) INTO launch_count
  FROM chain_events
  WHERE chain_id = 8453
    AND is_canonical
    AND event_name = 'TokenLaunchedV3'
    AND lower(contract_address) = '0x90b371f571975a0b0693dc3c46eea19733c72ddd'
    AND lower(decoded->>'token') = '0xec2710a9df34b66b07bf96933d13b76e1d526c07'
    AND lower(decoded->>'curve') = '0x83cae06f86672038d203e3676ae1943d36f3e2a2';
  IF launch_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one canonical BFROG TokenLaunchedV3 from the Base Mainnet factory, found %', launch_count;
  END IF;
END $$;

SELECT relation, rows
FROM (
  SELECT 1 n, 'application_token_exclusions' relation, count(*) rows FROM application_token_exclusions WHERE chain_id=8453 AND token_address='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 2, 'tokens', count(*) FROM tokens WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 3, 'curves', count(*) FROM curves WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 4, 'trades', count(*) FROM trades WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 5, 'fees', count(*) FROM fees WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 6, 'graduations', count(*) FROM graduations WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 7, 'liquidity_events', count(*) FROM liquidity_events WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 8, 'token_holder_balances', count(*) FROM token_holder_balances WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 9, 'token_trade_buckets', count(*) FROM token_trade_buckets WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 10, 'token_metrics', count(*) FROM token_metrics WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 11, 'token_metadata_drafts', count(*) FROM token_metadata_drafts WHERE lower(coalesce(token_address,''))='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  UNION ALL SELECT 12, 'chain_events (preserved)', count(*) FROM chain_events WHERE chain_id=8453 AND (lower(decoded->>'token')='0xec2710a9df34b66b07bf96933d13b76e1d526c07' OR (event_name='Transfer' AND lower(contract_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'))
) inspected ORDER BY n;

\if :apply
INSERT INTO application_token_exclusions(chain_id,token_address,reason)
VALUES (8453,'0xec2710a9df34b66b07bf96933d13b76e1d526c07','Pre-production BFROG application-state cleanup; onchain token remains live on Base Mainnet')
ON CONFLICT (chain_id,token_address) DO UPDATE SET reason=excluded.reason;

DELETE FROM token_holder_balances WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07';
DELETE FROM token_trade_buckets WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07';
DELETE FROM token_metrics WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07';
DELETE FROM token_metadata_drafts WHERE lower(coalesce(token_address,''))='0xec2710a9df34b66b07bf96933d13b76e1d526c07';
DELETE FROM trades WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07';
DELETE FROM fees WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07';
DELETE FROM liquidity_events WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07';
DELETE FROM graduations WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07';
DELETE FROM curves WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07';
DELETE FROM tokens WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM application_token_exclusions WHERE chain_id=8453 AND token_address='0xec2710a9df34b66b07bf96933d13b76e1d526c07') THEN
    RAISE EXCEPTION 'BFROG exclusion was not recorded';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tokens WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
    UNION ALL SELECT 1 FROM curves WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
    UNION ALL SELECT 1 FROM trades WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
    UNION ALL SELECT 1 FROM token_metrics WHERE chain_id=8453 AND lower(token_address)='0xec2710a9df34b66b07bf96933d13b76e1d526c07'
  ) THEN RAISE EXCEPTION 'BFROG derived rows remain'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chain_events WHERE chain_id=8453 AND is_canonical AND event_name='TokenLaunchedV3' AND lower(decoded->>'token')='0xec2710a9df34b66b07bf96933d13b76e1d526c07') THEN
    RAISE EXCEPTION 'Canonical BFROG raw launch provenance was unexpectedly removed';
  END IF;
END $$;
COMMIT;
\else
\echo 'DRY RUN ONLY: no rows changed. Re-run with -v apply=true after reviewing the counts above.'
ROLLBACK;
\endif
