# TideMarket PostgreSQL schema

Apply the SQL migration in `migrations/202611210001_tidemarket_schema.sql` to the intended Supabase project before starting the API. It is written to be re-runnable, creates the schema and RPCs, enables RLS, revokes direct client table privileges, and grants data/RPC access only to the backend `service_role`.

## Tables and relationships

| Table | Purpose and main relationships |
|---|---|
| `users` | Express JWT identities, bcrypt hashes, role, profile, and verification state. Email is case-insensitively unique. |
| `registration_requests` | Pending buyer onboarding requests and optional admin review reference. |
| `listings` | Catch inventory, seller (`users`), price, quantity, availability/reservation state, and optional prediction summary. |
| `auctions` | One auction per listing; seller listing, current/winning bidder, lifecycle, private bidder state, and legacy-compatible bid history. |
| `bids` | Relational auction and buyer references, numeric bid, moderation flags; indexed by auction/buyer/time. |
| `orders` | Buyer, fisherman, listing, optional auction, quantity/amount, delivery/payment states. At most one auction order and one open buyout order per listing. |
| `payments` | Private Razorpay attempts for orders, amount, gateway identifiers and state. One open attempt per order and unique gateway payment/order IDs. |
| `notifications` | Private user notices, optional auction and bid references. |
| `reviews` | One review per order, reviewer, fisherman, listing, rating, and moderation state. |
| `disputes` | One complaint per order, the parties/listing, and administrator finding. |
| `verification_history` | Fisherman verification decisions and administrator reference. |
| `reputations` | Per-fisherman score and structured factors; histories and display summaries remain JSONB. |
| `price_models` | Active validated estimate model and its regression/validation data. |
| `price_predictions` | Individual prediction requests and structured input. |
| `price_model_evaluations` | Model holdout metrics, selected model and coefficients. |
| `auction_messages` | Auction chat, author, content, and moderation state. |
| `auction_message_reports` | Buyer reports linked to message, auction, and reporter. |
| `auction_chat_rate_limits` | Hashed per-auction/user send marker; no raw user key is stored. |

Primary keys preserve the original Firebase child IDs. Timestamps use `timestamptz`, fish quantities use `numeric(12,3)`, and prices/amounts use fixed-point numeric columns. Nested reputation history, validation metrics, bid risk flags, prediction inputs, and the legacy-compatible auction offer/history maps use JSONB. `legacyData` stores only unmodeled source properties so migration does not silently discard older application fields; relational columns remain authoritative.

Automatic bid maximums and total budgets are held in the private `auctions.autoBids` JSONB column. RLS denies direct access to every table, including otherwise public marketplace data. The frontend and mobile app continue to request data through Express. All returned public auction objects must continue to pass through `publicAuction`; never expose the service role key, password hashes, or private bidder state.

## Transaction and authorization boundary

- `tidemarket_compare_and_set_record` checks the database row version and updates it atomically; the Express adapter retries transforms against the latest version. An auction commit also mirrors nested bids and, when closing with a winner, creates its checkout order in the same SQL transaction.
- `tidemarket_reserve_listing` performs a conditional update only from `available`.
- `tidemarket_create_buyout_order` reserves a listing and creates its first buyer order in a single transaction. The unique open-order index adds a second guard.
- `tidemarket_mark_payment_paid` / `tidemarket_mark_payment_failed` serialize payment finalization and update the order/listing state in one transaction.
- SQL functions are executable by `service_role` only. Supabase service-role requests bypass RLS; therefore the existing Express JWT role checks, buyer/seller ownership checks, admin middleware, response sanitizers, and chat restrictions remain mandatory. Never treat RLS as authorization for API calls made with the service key.

## Manual Supabase setup

1. In Supabase Dashboard, confirm the project URL matches `SUPABASE_URL`; copy the **service_role** key into the backend environment only.
2. Run the migration in **SQL Editor** and confirm the tables, indexes, functions, grants, and RLS are present.
3. Configure the same URL/key in the server deployment environment. Do not configure either value as a Vite or Expo public variable.
4. Start the API and verify `/api/health`, a login, and an API read against an isolated test account before switching production traffic.

No Supabase direct-client table access is supported. If that architecture changes, add narrowly scoped policies and review them separately; do not broaden these default-deny policies.

## Append-only Firebase import

See [`server/README.md`](../server/README.md) for export/import commands. The export script is a one-time migration utility and is the only remaining code that needs Firebase credentials. The importer requires `--confirm-append-only`, preserves IDs, skips conflicting primary keys instead of overwriting them, and generates a count/relationship/error report. It does not delete Firebase data. Existing records with conflicting IDs or invalid relationships require manual reconciliation before a clean import can be reported.
