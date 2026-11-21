# Firebase to Supabase Migration Report

## Status

The application code and migration assets have been updated to use Supabase PostgreSQL from the Express backend. The schema migration has **not** been applied to the hosted Supabase project, and the Firebase data export/import has **not** been run. No live database connectivity or production data migration is claimed.

The backend uses `@supabase/supabase-js` with `SUPABASE_URL` and the backend-only `SUPABASE_SERVICE_ROLE_KEY`. Existing Express JWT and bcrypt authentication remains in place. Web and Expo clients continue to call the Express API and do not receive a Supabase key.

## Schema defined

[`supabase/migrations/202611210001_tidemarket_schema.sql`](./supabase/migrations/202611210001_tidemarket_schema.sql) defines 18 relational tables:

| Firebase collection | PostgreSQL table |
|---|---|
| `users` | `users` |
| `registrationRequests` | `registration_requests` |
| `listings` | `listings` |
| `auctions` | `auctions` |
| `bids` | `bids` |
| `orders` | `orders` |
| `payments` | `payments` |
| `notifications` | `notifications` |
| `reviews` | `reviews` |
| `disputes` | `disputes` |
| `verificationHistory` | `verification_history` |
| `reputations` | `reputations` |
| `priceModels` | `price_models` |
| `pricePredictions` | `price_predictions` |
| `priceModelEvaluations` | `price_model_evaluations` |
| `auctionMessages` | `auction_messages` |
| `auctionMessageReports` | `auction_message_reports` |
| `auctionChatRateLimits` | `auction_chat_rate_limits` |

The schema includes primary/foreign keys, unique constraints, indexes, timestamps, numeric monetary/quantity columns, and explicit relationships among users, listings, auctions, bids, orders, and payments. JSONB is retained for genuinely nested auction state and selected model/reputation values; `legacyData` preserves source fields that do not yet have dedicated columns.

RLS is enabled with direct `anon` and `authenticated` access denied. The service role is granted backend access and is not exposed to clients. Because service-role calls bypass RLS, Express JWT role, ownership, and authorization checks remain required.

Database functions provide version-checked auction updates and settlement, single-winner listing reservations, atomic auction creation, buyout order creation, and idempotent payment completion/failure. Auction settlement creates its checkout order transactionally. Runtime concurrency behavior still needs verification against PostgreSQL after the migration is applied.

## Backend and migration changes

- Replaced the Firebase-backed adapter in [`server/src/db.js`](./server/src/db.js) with Supabase queries while retaining the existing helper API and local JSON mode for development/tests.
- Updated startup, user routes, and demo seeding to use the new adapter and atomic RPC helpers.
- Removed `firebase-admin` from backend dependencies and the lockfile.
- Added append-only migration scripts: [`server/scripts/export-firebase.mjs`](./server/scripts/export-firebase.mjs) and [`server/scripts/import-firebase.mjs`](./server/scripts/import-firebase.mjs). The importer preserves IDs and timestamps, imports nested auction bid history, ignores conflicting IDs rather than overwriting them, and writes count, relationship, and error summaries.
- Updated [`.env.example`](./.env.example), [`server/.env.example`](./server/.env.example), [`README.md`](./README.md), [`server/README.md`](./server/README.md), and [`supabase/README.md`](./supabase/README.md).
- Replaced the obsolete Firebase rules file with database RLS policy definitions.
- Isolated mobile E2E API fixtures from desktop fixtures; removed a stale Expo Metro watch path that pointed to a nonexistent directory.
- Added focused database CRUD/configuration tests and updated the static RLS test.

## Files changed

- Configuration/docs: [`.env.example`](./.env.example), [`.gitignore`](./.gitignore), [`README.md`](./README.md), [`server/.env.example`](./server/.env.example), [`server/README.md`](./server/README.md), [`supabase/README.md`](./supabase/README.md), and this report.
- Backend: [`server/package.json`](./server/package.json), [`server/package-lock.json`](./server/package-lock.json), [`server/src/db.js`](./server/src/db.js), [`server/src/index.js`](./server/src/index.js), [`server/src/routes/user.js`](./server/src/routes/user.js), [`server/src/seed-demo.js`](./server/src/seed-demo.js), [`server/test-support/startAuctionApi.js`](./server/test-support/startAuctionApi.js), [`server/test/databaseConfig.test.js`](./server/test/databaseConfig.test.js), [`server/test/databaseCrud.test.js`](./server/test/databaseCrud.test.js), and [`server/test/securityRules.test.js`](./server/test/securityRules.test.js).
- Database and migration assets: [`supabase/migrations/202611210001_tidemarket_schema.sql`](./supabase/migrations/202611210001_tidemarket_schema.sql), [`server/scripts/export-firebase.mjs`](./server/scripts/export-firebase.mjs), and [`server/scripts/import-firebase.mjs`](./server/scripts/import-firebase.mjs).
- Client/mobile test and build configuration: [`client/e2e/workflows.mobile.spec.js`](./client/e2e/workflows.mobile.spec.js), [`client/playwright.config.js`](./client/playwright.config.js), and [`mobile/metro.config.js`](./mobile/metro.config.js).
- Deleted: `database.rules.json`.

## Verification

| Command | Result |
|---|---|
| `npm test --prefix server` | Passed: 78 tests, 0 failures. Uses the local JSON test adapter; does not test hosted Supabase. |
| `npm run build --prefix client` | Passed. |
| `npm run test:e2e --prefix client` | Passed: 15 tests, including desktop and Expo-web workflows. |
| `npm run lint --prefix mobile` | Passed. |
| `npx expo export --platform web` from `mobile/` | Passed. |
| `node --check` on the adapter and both migration scripts | Passed. |

No PostgreSQL CLI or Supabase credentials were available. The SQL migration was therefore not applied, and its functions/RLS behavior has not been exercised on a PostgreSQL instance. Native iOS/Android builds and live Razorpay/Supabase integrations were not tested.

## Remaining Firebase references

- Firebase is intentionally retained in the one-time export/import tooling and its setup instructions; those scripts are not production runtime dependencies.
- Historical audit, AI, and test reports remain unchanged as historical snapshots and may describe the former Firebase architecture.
- The root repository contains a separate `fishing-bid` Gitlink at commit `2950f05`; it has no `.gitmodules` mapping and its checked-out copy still contains the old Firebase implementation. It was not modified as part of the root repository migration. The root repository's active Express, web, and mobile source does not import or require Firebase.

## Manual steps before cutover

1. In Supabase Dashboard, confirm the project URL and obtain a service-role key. Store it only in the backend environment; do not commit it or use it in a `VITE_` variable or mobile configuration.
2. Apply [`supabase/migrations/202611210001_tidemarket_schema.sql`](./supabase/migrations/202611210001_tidemarket_schema.sql) in the intended Supabase project and verify that all 18 tables, policies, and functions were created.
3. Configure the backend with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and production JWT/admin secrets. Start the API and run isolated integration checks against a non-production Supabase project before directing users to it.
4. If there is source data to migrate, create a protected Firebase export using a read-only/appropriately scoped credential. Review the export securely because it contains private account and marketplace records.
5. After taking an approved backup and applying the schema, run `npm run migration:import-firebase --prefix server -- --confirm-append-only`. Review its generated report and resolve any row errors or orphan relationships before cutover. The importer does not delete Firebase data and does not overwrite existing Supabase rows.
6. Verify user access, auction races/settlement, payments, and RLS/service-role behavior in the isolated environment. Keep Firebase data intact until the migration is reconciled and the new deployment is accepted.

**Production data status:** Not migrated. Firebase export credentials and Supabase service-role credentials were not available during this work.
