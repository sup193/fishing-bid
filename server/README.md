# TideMarket API Setup

The Express API uses `@supabase/supabase-js` only on the server.

```text
SUPABASE_URL=https://jrgkxtlcuakxvdkqygxs.supabase.co
SUPABASE_SECRET_KEY=your_backend_only_secret_key
JWT_SECRET=your_private_jwt_secret
ADMIN_PASSWORD=your_private_admin_password
```

Never place `SUPABASE_SECRET_KEY` in `VITE_` variables or Expo configuration. Never expose it in responses or client code.

Apply `../supabase/migrations/202611210001_tidemarket_schema.sql` before starting production. The migration creates all application tables and the public-read `fish-images` bucket. It also leaves direct table and storage writes unavailable to browser roles; Express remains the authorization boundary.

Run the API:

```powershell
npm run dev
```

Tests can use `TIDEMARKET_DATABASE=local` and an isolated temporary JSON file. Production rejects local database mode and requires both Supabase variables.
