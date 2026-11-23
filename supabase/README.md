# Fresh TideMarket Supabase Setup

On a new project, run the migrations in order in the Supabase SQL Editor:

1. [`migrations/202611210001_tidemarket_schema.sql`](./migrations/202611210001_tidemarket_schema.sql)
2. [`migrations/202611220001_pending_registrations.sql`](./migrations/202611220001_pending_registrations.sql)
3. [`migrations/202611220002_password_reset.sql`](./migrations/202611220002_password_reset.sql)

For an existing Fishing Bid project that already has the first two migrations, apply only the password-reset migration. It adds reset-only tables and `users.tokenVersion`; it preserves all user records, password hashes, registration requests, and registration OTP records.

The migration creates:

- User and registration records for the existing Express JWT/bcrypt system
- Fish categories and listings
- One or more image records per listing in `listing_images`
- Auctions, bids, bids history, and private proxy-bid state
- Orders, payments, notifications, reviews, disputes, reputation, verification history
- Price models, predictions, evaluations
- Auction chat, reports, and rate limits
- The public-read `fish-images` Storage bucket
- Indexes, constraints, row versions, RLS, and transaction functions

No old application data is imported. The SQL is intended only for a fresh database.

Set this in the backend environment:

```text
SUPABASE_URL=https://jrgkxtlcuakxvdkqygxs.supabase.co
SUPABASE_SECRET_KEY=<your-backend-only-secret-key>
```

The SQL disables direct table access for `anon` and `authenticated`. Storage permits public image reads but denies direct client writes. The backend secret key and Express authorization checks are required for writes.
