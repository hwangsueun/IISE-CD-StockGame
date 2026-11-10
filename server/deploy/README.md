# Existing Render deployment

Service: `antsurvival-game`, branch: `deploy/render-free-20261012`.

The existing native Node build command is retained. `npm --prefix server ci`
runs `deploy/install-runtime.cjs` on Render and installs the pinned player-model
and Alpha158 explanation dependencies into `quant/.runtime`. Missing imports
fail the build before replacing the live version.

`node server/deploy/start.cjs` verifies the pinned signals and analysis hashes,
checks the restored market-data version, applies only application migrations
011–015, and imports the bundled sector series and financial statements once. The migration and data
ledgers preserve existing games and prevent accidental replay of the original
database initialization. No external database access is needed.

The analysis bundle contains the original LightGBM checkpoints and unchanged
Alpha158 feature values for signal dates. Features are split into yearly files
with small row groups to limit memory used by date-filtered explanation reads.
These files are server-only and are not served by the frontend static directory.

To rebuild the bundle from the pinned local model export and sector source:

```sh
quant/.runtime/bin/python server/deploy/package-analysis.py MODEL_DIRECTORY SECTOR_CSV
```

The packager verifies checkpoint and signal hashes. Commit the resulting
`analysis/`, `analysis-manifest.json` and `sectors.csv.gz` together. Verify score
reconstruction before deploying. The signals bundle remains separately pinned
by `quant-manifest.json`.

Automatic deployment is disabled. Push the reviewed deployment branch and
trigger one manual deployment, then check health, model availability, actual
model training, and Alpha158 explanations on the live service.

## Temporary database transfer

Normal startup does not load the transfer server. An explicitly configured
`MIGRATION_MODE` runs a maintenance server instead of the game, so new game
writes cannot race the final snapshot. Only the existing Render service and
its internal database connection are used; external database access is not
required.

The transfer uses PostgreSQL 16's native `pg_dump` / `pg_restore`. The client
bundle is pinned to an official image digest and verified before execution.
Every transfer request requires a temporary bearer token and expires within
two hours. Database contents travel as authenticated ciphertext; the export
private key stays on the operator's computer. Connection secrets and archive
contents must never be logged, committed, or placed in frontend assets.

Before replacing a database, download the final snapshot, verify its archive
checksum, and restore it into a disposable local PostgreSQL instance. Keep the
verified backup. The restore server accepts only an empty replacement database
whose ID matches the configured target, and refuses the original database.
After verifying the replacement, clear all `MIGRATION_*` configuration and
redeploy to resume normal gameplay at the existing URL.
