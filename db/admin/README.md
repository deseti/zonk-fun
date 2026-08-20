# Administrative application-state procedures

`base-mainnet-bfrog-cleanup.sql` is the reviewed, one-token procedure for hiding
BFROG from Zonk.fun and removing its derived projections while preserving every
canonical raw chain event. It is not an onchain deletion.

Run the read-only inspection first against the intended database:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v apply=false -f db/admin/base-mainnet-bfrog-cleanup.sql
```

After reviewing the database target and every reported row count, stop the API
and indexer writers, then apply exactly once:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v apply=true -f db/admin/base-mainnet-bfrog-cleanup.sql
```

Restart the indexer and API and verify `/api/v1/tokens`, `/api/v1/trending`, the
creator profile, and the BFROG token endpoint. The script is idempotent; the
exclusion row makes later replay safe. To reverse the application exclusion,
delete only the exact `(8453, lowercase BFROG address)` exclusion row and replay
from BFROG's launch block so canonical projections are rebuilt from raw events.
The indexer continues scanning the excluded token, curve, and canonical pool from
the preserved launch event so later raw chain provenance is retained.
