# TideMarket API

The Express API uses the official `@supabase/supabase-js` client with a backend-only service role key. Existing JWT/bcrypt authentication and the web/mobile API contracts remain in Express; browser and Expo clients must not connect to PostgreSQL directly.

## Configure and run

1. Copy the root `.env.example` to `.env`.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Supabase **Project Settings → API**. Keep the service role key private and never use it as an anon/publishable key.
3. Apply [`../supabase/migrations/202611210001_tidemarket_schema.sql`](../supabase/migrations/202611210001_tidemarket_schema.sql) in the Supabase SQL Editor.
4. Run `npm run dev` from the repository root or `npm run dev` from this directory.

The server checks database access and schema when starting. Without Supabase credentials, non-production runs use `data/local-db.json` for isolated development/tests. Production refuses local mode and missing or partial Supabase configuration. The local JSON adapter is not concurrency-safe and must not be used in production.

## Firebase data migration

The export uses a Firebase service account only for a one-time server-side export. Set these temporary variables in a private local environment (do not commit them):

```text
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Alternatively set `FIREBASE_SERVICE_ACCOUNT_FILE` to a local service-account JSON file or provide a short-lived `FIREBASE_DATABASE_TOKEN`. Then run:

```powershell
npm run migration:export-firebase --prefix server
```

Review the generated `server/data/firebase-export.json` before importing. Apply the schema migration first, configure the Supabase variables, and run the append-only import explicitly:

```powershell
npm run migration:import-firebase --prefix server -- --confirm-append-only
```

Use `--input <path>` and `--report <path>` to select other local files. The importer preserves Firebase IDs, converts epoch timestamps, flattens nested auction bid history into the `bids` table while retaining the auction history, imports in foreign-key order, and writes per-table counts, source orphan checks, target counts, and row errors to a uniquely named report in `server/data/`. It uses `ON CONFLICT DO NOTHING`: existing Supabase rows are never overwritten. Resolve conflicts or missing relationships manually and rerun; the migration does not delete or modify Firebase data. Never test this against production data without an approved backup and isolated environment.

## Demo records

Use local storage for a development demo:

```powershell
node src/seed-demo.js --local
```

To add the labeled demo accounts to the configured Supabase project, explicitly run `node src/seed-demo.js --allow-supabase`. The separate `--reset-activity` option replaces demo activity records; only use it on an isolated project after reviewing the script and database backup.
