# TideMarket Smart Fishing Platform

TideMarket is a React/Vite web application and Expo mobile application served by an Express API. PostgreSQL is provided by Supabase. Authentication remains Express JWT plus bcrypt; the React and mobile clients do not connect directly to Supabase.

## Fresh setup

1. Copy `.env.example` to `.env`.
2. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Use the Supabase project URL and keep the secret key only on the Express server.
3. Run the Supabase migrations in version order: [`202611210001_tidemarket_schema.sql`](./supabase/migrations/202611210001_tidemarket_schema.sql), [`202611220001_pending_registrations.sql`](./supabase/migrations/202611220001_pending_registrations.sql), [`202611220002_password_reset.sql`](./supabase/migrations/202611220002_password_reset.sql), then [`202611240001_fisherman_registration_approval.sql`](./supabase/migrations/202611240001_fisherman_registration_approval.sql). The final migration makes buyer OTP verification activate accounts directly and queues fisherman registrations for admin approval.
4. Configure Razorpay and JWT/admin variables if you intend to use payments or production startup.
5. Install and run:

```powershell
npm install
npm run install:all
npm run dev
```

The web application runs at `http://localhost:5173`. The API runs at `http://localhost:5000`.

## Fish images

Listing uploads use the Supabase `fish-images` storage bucket. The Express `/api/uploads/image` endpoint validates and uploads fish photos and returns a public URL plus storage path. The bucket permits public reads and denies direct browser/client writes; the backend service secret uploads images and then stores metadata in `listing_images`. The existing listing UI remains unchanged.

## Database behavior

Supabase credentials require PostgreSQL mode. Non-production tests may use the isolated local JSON adapter, but production does not fall back to local storage. Auction bids, listing reservations, buyout orders, settlement, and payment finalization use PostgreSQL transaction functions and row constraints.

Run validation:

```powershell
npm test --prefix server
npm run build --prefix client
npm run test:e2e --prefix client
npm run lint --prefix mobile
npx expo export --platform web
```
