# Fresh Supabase Implementation Report

## Status

The legacy database integration has been removed from the active repository. The application now uses the existing Express JWT/bcrypt authentication and the Supabase PostgreSQL client on the backend.

The SQL migration was created but has not been executed in the hosted Supabase project. No live database operation or live Storage upload was tested because no backend `.env` or `SUPABASE_*` process variables were available. No old records or export datasets were imported.

## Audit and cleanup

The old nested project Gitlink, database SDK dependencies/configuration, migration scripts, export/import scripts, old local dataset, and legacy database documentation have been removed. No legacy database SDK references remain in the active repository.

## New database implementation

The fresh SQL file is [`supabase/migrations/202611210001_tidemarket_schema.sql`](./supabase/migrations/202611210001_tidemarket_schema.sql).

It creates:

- `fish_categories`
- `users`
- `registration_requests`
- `listings`
- `listing_images`
- `auctions`
- `bids`
- `orders`
- `payments`
- `notifications`
- `reviews`
- `disputes`
- `verification_history`
- `reputations`
- `price_models`
- `price_predictions`
- `price_model_evaluations`
- `auction_messages`
- `auction_message_reports`
- `auction_chat_rate_limits`

It also creates primary keys, foreign keys, unique constraints, indexes, numeric/monetary columns, timestamps, version fields, row-level security, Storage bucket setup, transaction functions, and direct-client deny policies.

## Storage implementation

The migration creates the public-read `fish-images` bucket with JPG, PNG, and WEBP limits. Direct anon/authenticated writes are denied. Listing image uploads are sent through `/api/uploads/image` in the Express backend using `SUPABASE_SECRET_KEY`. Listing metadata is stored in `listing_images`, while `listings.imageUrl` retains the primary-image compatibility field.

The former disk/Multer upload storage and `/uploads` static route are removed.

## Environment

Use [`server/.env.example`](./server/.env.example) as the backend template:

```text
SUPABASE_URL=https://jrgkxtlcuakxvdkqygxs.supabase.co
SUPABASE_SECRET_KEY=your_backend_only_supabase_secret_key
```

Do not use `SUPABASE_SECRET_KEY` in React, Vite, Expo, API responses, or Git. A frontend direct-Supabase client is not used.

## Initialize the empty project

1. Open the Supabase project SQL Editor.
2. Copy and execute the complete [`202611210001_tidemarket_schema.sql`](./supabase/migrations/202611210001_tidemarket_schema.sql) file.
3. Confirm the table list, `fish-images` bucket, RLS policies, and `tidemarket_*` functions exist.
4. Copy `.env.example` to `.env`.
5. Add `SUPABASE_SECRET_KEY` and the existing JWT, admin, and Razorpay variables locally.
6. Start the API and verify a fresh account registration, login, listing upload, auction, and payment in the isolated project.

Do not execute an old export or import script. None are retained.

## Live integration check status

The live check loaded `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from `server/.env` safely. `server/.env` was not modified. The attempted command was:

```powershell
npm run check:live-supabase --prefix server
```

Live results:

- Supabase connection: **Passed**
- 18 core application tables plus `fish_categories` and `listing_images`: **Passed** (20 tables checked)
- `fish-images` Storage bucket: **Passed**
- Temporary user insert/retrieve: **Passed**
- Temporary fish listing insert/retrieve: **Passed**
- Fish image upload/public retrieval: **Passed**
- Auction creation transaction: **Passed**
- Compare-and-set bidding transaction: **Failed**: the stale expected version was accepted by the currently deployed RPC
- Direct anon/authenticated RLS denial: **Not tested** because no anon/publishable key was configured
- Temporary-row cleanup: **Passed** by the live check script

No demo records or old records were inserted. The temporary live-check records were removed.

The stale-bid failure indicates that the hosted RPC is older than the migration source. The SQL source now contains an explicit row-version precheck, but the updated migration must be reapplied in the Supabase SQL Editor before stale transactions are rejected.

## Database startup diagnosis

The former `fetch failed` startup error was caused by an unclassified network failure: it did not identify DNS, timeout, TLS, or URL validity. DNS resolution currently succeeds for `jrgkxtlcuakxvdkqygxs.supabase.co`, native Node HTTPS returns the Supabase REST endpoint successfully, and direct startup now authenticates by querying `users`.

`server/.env` is loaded from `server/src/../.env`, which resolves to `server/.env`; the backend loads it before creating the Supabase JS client. Startup now validates URL format and the complete Supabase key presence, performs `users` table access, and reports DNS/timeout/TLS/refusal/reset classifications without exposing credential values.

## Password-reset migration

The versioned migration [`202611220002_password_reset.sql`](./supabase/migrations/202611220002_password_reset.sql) adds dedicated password-reset OTP and single-use authorization tables plus user token-versioning. It does not update or delete existing users, password hashes, registration requests, or registration OTP rows. Apply it in the Supabase SQL Editor after `202611220001_pending_registrations.sql`; it has **not been applied to the hosted project in this task**.

Final clean restart result:

- Supabase connection/schema check: **Passed**
- API listener: **Passed** on port 5000
- `/api/health`: **HTTP 200**

The project was not paused or unavailable during the successful checks.

## Validation

| Check | Result |
|---|---|
| Backend tests | 78 passed |
| React production build | Passed |
| Web/mobile Playwright E2E | 15 passed |
| Mobile ESLint | Passed |
| Expo web export | Passed |
| JavaScript syntax checks | Passed |
| Legacy database reference audit | No remaining matches |
| Live Supabase schema execution | Not run; credentials unavailable |
| Live Supabase Storage upload | Not run; credentials unavailable |
| Old data migration | Not run; intentionally excluded |

## Modified/new implementation files

- [`server/src/db.js`](./server/src/db.js): Supabase adapter and Storage upload helper.
- [`server/src/routes/user.js`](./server/src/routes/user.js): memory-buffer upload endpoint and listing-image metadata.
- [`server/src/index.js`](./server/src/index.js): removed local `/uploads` static route.
- [`server/src/seed-demo.js`](./server/src/seed-demo.js): uses `SUPABASE_SECRET_KEY`.
- [`server/test/databaseConfig.test.js`](./server/test/databaseConfig.test.js): Supabase configuration checks.
- [`server/test/securityRules.test.js`](./server/test/securityRules.test.js): RLS and Storage policy assertions.
- [`client/src/fisherman/FishermanDashboard.jsx`](./client/src/fisherman/FishermanDashboard.jsx): retains uploaded Storage path in listing submission.
- [`mobile/src/features/fisherman.js`](./mobile/src/features/fisherman.js): retains uploaded Storage path in listing submission.
- [`server/package.json`](./server/package.json): legacy database scripts and dependencies removed.
- [`.env.example`](./.env.example) and [`server/.env.example`](./server/.env.example): fresh Supabase variables.
- [`README.md`](./README.md), [`server/README.md`](./server/README.md), and [`supabase/README.md`](./supabase/README.md): setup documentation.
