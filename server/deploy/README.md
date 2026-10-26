# Existing Render deployment

Service: `antsurvival-game`, branch: `deploy/render-free-20261012`.

The existing native Node build command is retained. `npm --prefix server ci`
runs `deploy/install-runtime.cjs` on Render and installs the pinned player-model
and Alpha158 explanation dependencies into `quant/.runtime`. Missing imports
fail the build before replacing the live version.

`node server/deploy/start.cjs` verifies the pinned signals and analysis hashes,
checks the restored market-data version, applies only application migrations
011–014, and imports the bundled sector series once. The migration and data
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
