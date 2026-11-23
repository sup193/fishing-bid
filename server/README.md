# TideMarket API Setup

The Express API uses `@supabase/supabase-js` only on the server.

```text
SUPABASE_URL=https://jrgkxtlcuakxvdkqygxs.supabase.co
SUPABASE_SECRET_KEY=your_backend_only_secret_key
JWT_SECRET=your_private_jwt_secret
ADMIN_PASSWORD=your_private_admin_password
```

Never place `SUPABASE_SECRET_KEY` in `VITE_` variables or Expo configuration. Never expose it in responses or client code.

Apply the SQL migrations in version order before starting production: `../supabase/migrations/202611210001_tidemarket_schema.sql`, `../supabase/migrations/202611220001_pending_registrations.sql`, and `../supabase/migrations/202611220002_password_reset.sql`. The password-reset migration adds dedicated OTP and single-use reset-token records plus session token-versioning; it does not change existing user password hashes or registration requests. Direct table and storage writes remain unavailable to browser roles; Express remains the authorization boundary.

Run the API:

```powershell
npm run dev
```

Tests can use `TIDEMARKET_DATABASE=local` and an isolated temporary JSON file. Production rejects local database mode and requires both Supabase variables.
