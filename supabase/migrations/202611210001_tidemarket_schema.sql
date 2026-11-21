CREATE TABLE IF NOT EXISTS public.users (
  id text PRIMARY KEY,
  name text,
  email text,
  "passwordHash" text,
  role text,
  phone text,
  location text,
  "verificationStatus" text,
  "verificationUpdatedAt" timestamptz,
  "verificationUpdatedBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  demo boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON public.users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.registration_requests (
  id text PRIMARY KEY,
  name text,
  email text,
  "passwordHash" text,
  role text,
  phone text,
  location text,
  status text,
  "reviewedAt" timestamptz,
  "reviewedBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS registration_requests_status_created_idx
  ON public.registration_requests (status, "createdAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS registration_requests_pending_email_unique
  ON public.registration_requests (lower(email)) WHERE status = 'pending' AND email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.listings (
  id text PRIMARY KEY,
  fisherman text REFERENCES public.users(id) ON DELETE SET NULL,
  "fishType" text,
  quality text,
  size text,
  quantity numeric(12, 3),
  location text,
  price numeric(12, 2),
  "expectedPrice" numeric(12, 2),
  "salePrice" numeric(12, 2),
  "saleMode" text,
  description text,
  "imageUrl" text,
  "imageVerification" text,
  status text,
  "reservedBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  "predictedLow" numeric(12, 2),
  "predictedHigh" numeric(12, 2),
  "pricePrediction" jsonb,
  "removedAt" timestamptz,
  "removedBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  demo boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT listings_positive_quantity CHECK (quantity IS NULL OR quantity > 0),
  CONSTRAINT listings_nonnegative_prices CHECK (
    (price IS NULL OR price >= 0)
    AND ("expectedPrice" IS NULL OR "expectedPrice" >= 0)
    AND ("salePrice" IS NULL OR "salePrice" >= 0)
  )
);
CREATE INDEX IF NOT EXISTS listings_fisherman_created_idx ON public.listings (fisherman, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS listings_marketplace_idx ON public.listings (status, "fishType", location);
CREATE INDEX IF NOT EXISTS listings_reservation_idx ON public.listings (status, "reservedBy");

CREATE TABLE IF NOT EXISTS public.auctions (
  id text PRIMARY KEY,
  listing text UNIQUE REFERENCES public.listings(id) ON DELETE CASCADE,
  "startPrice" numeric(12, 2),
  "currentPrice" numeric(12, 2),
  "minimumIncrement" numeric(12, 2),
  "currentBidder" text REFERENCES public.users(id) ON DELETE SET NULL,
  "bidCount" integer NOT NULL DEFAULT 0,
  "startTime" timestamptz,
  "endTime" timestamptz,
  status text,
  winner text REFERENCES public.users(id) ON DELETE SET NULL,
  "winningBid" numeric(12, 2),
  result text,
  "closedAt" timestamptz,
  "closingNoticeSentAt" timestamptz,
  "closureNotificationsSent" boolean NOT NULL DEFAULT false,
  "cancelledBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  "order" text,
  "bidderOffers" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "autoBids" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "bidHistory" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "processedRequests" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "offerSequence" bigint NOT NULL DEFAULT 0,
  demo boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT auctions_positive_amounts CHECK (
    ("startPrice" IS NULL OR "startPrice" > 0)
    AND ("minimumIncrement" IS NULL OR "minimumIncrement" > 0)
    AND ("currentPrice" IS NULL OR "currentPrice" >= 0)
  )
);
CREATE INDEX IF NOT EXISTS auctions_status_end_idx ON public.auctions (status, "endTime");
CREATE INDEX IF NOT EXISTS auctions_winner_idx ON public.auctions (winner);

CREATE TABLE IF NOT EXISTS public.bids (
  id text PRIMARY KEY,
  auction text REFERENCES public.auctions(id) ON DELETE CASCADE,
  buyer text REFERENCES public.users(id) ON DELETE SET NULL,
  amount numeric(12, 2),
  type text,
  "riskReviewNeeded" boolean,
  "riskFlags" jsonb,
  demo boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT bids_positive_amount CHECK (amount IS NULL OR amount > 0)
);
CREATE INDEX IF NOT EXISTS bids_auction_created_idx ON public.bids (auction, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS bids_buyer_created_idx ON public.bids (buyer, "createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.orders (
  id text PRIMARY KEY,
  "orderNumber" text UNIQUE,
  auction text UNIQUE REFERENCES public.auctions(id) ON DELETE SET NULL,
  listing text REFERENCES public.listings(id) ON DELETE SET NULL,
  buyer text REFERENCES public.users(id) ON DELETE SET NULL,
  fisherman text REFERENCES public.users(id) ON DELETE SET NULL,
  quantity numeric(12, 3),
  amount numeric(14, 2),
  "paymentStatus" text,
  "orderStatus" text,
  "purchaseType" text,
  "paymentMethod" text,
  gateway text,
  "gatewayOrderId" text,
  "transactionRef" text,
  address text,
  "expectedDeliveryAt" timestamptz,
  "deliveredAt" timestamptz,
  "paidAt" timestamptz,
  "cancellationActor" text,
  demo boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT orders_positive_amount CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT orders_positive_quantity CHECK (quantity IS NULL OR quantity > 0)
);
CREATE INDEX IF NOT EXISTS orders_buyer_created_idx ON public.orders (buyer, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS orders_fisherman_created_idx ON public.orders (fisherman, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS orders_listing_idx ON public.orders (listing);
CREATE INDEX IF NOT EXISTS orders_payment_status_idx ON public.orders ("paymentStatus", "orderStatus");
CREATE UNIQUE INDEX IF NOT EXISTS orders_open_buyout_listing_unique
  ON public.orders (listing)
  WHERE "purchaseType" = 'buyout' AND "paymentStatus" IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS public.payments (
  id text PRIMARY KEY,
  "order" text REFERENCES public.orders(id) ON DELETE SET NULL,
  "orderNumber" text,
  buyer text REFERENCES public.users(id) ON DELETE SET NULL,
  fisherman text REFERENCES public.users(id) ON DELETE SET NULL,
  listing text REFERENCES public.listings(id) ON DELETE SET NULL,
  amount numeric(14, 2),
  currency text,
  gateway text,
  status text,
  mode text,
  "gatewayOrderId" text UNIQUE,
  "gatewayPaymentId" text,
  "paymentMethod" text,
  "failureReason" text,
  "paidAt" timestamptz,
  demo boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT payments_nonnegative_amount CHECK (amount IS NULL OR amount >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_gateway_payment_unique
  ON public.payments ("gatewayPaymentId") WHERE "gatewayPaymentId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_attempt_per_order
  ON public.payments ("order") WHERE status IN ('creating', 'pending') AND "order" IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_buyer_created_idx ON public.payments (buyer, "createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.notifications (
  id text PRIMARY KEY,
  "user" text REFERENCES public.users(id) ON DELETE SET NULL,
  auction text REFERENCES public.auctions(id) ON DELETE CASCADE,
  bid text REFERENCES public.bids(id) ON DELETE SET NULL,
  type text,
  title text,
  message text,
  read boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications ("user", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.reviews (
  id text PRIMARY KEY,
  "order" text UNIQUE REFERENCES public.orders(id) ON DELETE SET NULL,
  fisherman text REFERENCES public.users(id) ON DELETE SET NULL,
  buyer text REFERENCES public.users(id) ON DELETE SET NULL,
  listing text REFERENCES public.listings(id) ON DELETE SET NULL,
  rating smallint,
  comment text,
  status text,
  "moderationNote" text,
  "moderatedBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  "moderatedAt" timestamptz,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT reviews_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);
CREATE INDEX IF NOT EXISTS reviews_fisherman_status_created_idx
  ON public.reviews (fisherman, status, "createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.disputes (
  id text PRIMARY KEY,
  "order" text UNIQUE REFERENCES public.orders(id) ON DELETE SET NULL,
  fisherman text REFERENCES public.users(id) ON DELETE SET NULL,
  buyer text REFERENCES public.users(id) ON DELETE SET NULL,
  listing text REFERENCES public.listings(id) ON DELETE SET NULL,
  complaint text,
  status text,
  finding text,
  "adminNote" text,
  "reviewedBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  "reviewedAt" timestamptz,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS disputes_fisherman_status_idx ON public.disputes (fisherman, status);

CREATE TABLE IF NOT EXISTS public.verification_history (
  id text PRIMARY KEY,
  fisherman text REFERENCES public.users(id) ON DELETE SET NULL,
  status text,
  admin text REFERENCES public.users(id) ON DELETE SET NULL,
  "previousStatus" text,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS verification_history_fisherman_created_idx
  ON public.verification_history (fisherman, "createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.reputations (
  id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  score numeric(5, 2),
  level text,
  status text,
  "averageRating" numeric(3, 2),
  "reviewCount" integer,
  "verifiedOrderCount" integer,
  "completedOrderCount" integer,
  "successfulDeliveryPercent" numeric(5, 1),
  "onTimeDeliveryPercent" numeric(5, 1),
  "onTimeDeliverySampleCount" integer,
  "cancellationPercent" numeric(5, 1),
  "cancellationCount" integer,
  "confirmedDisputeCount" integer,
  "verificationStatus" text,
  verified boolean,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  improvements jsonb NOT NULL DEFAULT '[]'::jsonb,
  "measuredWeight" numeric(6, 2),
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  "recentReviews" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sourceSignature" text,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.price_models (
  id text PRIMARY KEY,
  model text,
  status text,
  intercept numeric(16, 6),
  slope numeric(16, 8),
  "trainingSampleCount" integer,
  validation jsonb,
  "evaluationId" text,
  "trainedAt" timestamptz,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.price_predictions (
  id text PRIMARY KEY,
  "requestedBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  "requestedRole" text,
  input jsonb,
  "estimatePerKg" numeric(12, 2),
  "estimatedTotal" numeric(14, 2),
  reliability text,
  model text,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS price_predictions_created_idx ON public.price_predictions ("createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.price_model_evaluations (
  id text PRIMARY KEY,
  status text,
  "requestedBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  "evaluatedAt" timestamptz,
  "sampleCount" integer,
  "requiredSampleCount" integer,
  "trainingCount" integer,
  "testCount" integer,
  "selectedModel" text,
  coefficients jsonb,
  baseline jsonb,
  "linearRegression" jsonb,
  split text,
  reason text,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS price_model_evaluations_created_idx
  ON public.price_model_evaluations ("evaluatedAt" DESC);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_models_evaluation_id_fkey'
      AND conrelid = 'public.price_models'::regclass
  ) THEN
    ALTER TABLE public.price_models
      ADD CONSTRAINT price_models_evaluation_id_fkey FOREIGN KEY ("evaluationId")
      REFERENCES public.price_model_evaluations(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.auction_messages (
  id text PRIMARY KEY,
  auction text REFERENCES public.auctions(id) ON DELETE CASCADE,
  author text REFERENCES public.users(id) ON DELETE SET NULL,
  "authorRole" text,
  content text,
  status text,
  "moderationNote" text,
  "moderatedBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  "moderatedAt" timestamptz,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS auction_messages_auction_created_idx
  ON public.auction_messages (auction, "createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.auction_message_reports (
  id text PRIMARY KEY,
  auction text REFERENCES public.auctions(id) ON DELETE CASCADE,
  message text REFERENCES public.auction_messages(id) ON DELETE CASCADE,
  reporter text REFERENCES public.users(id) ON DELETE SET NULL,
  reason text,
  status text,
  "reviewedBy" text REFERENCES public.users(id) ON DELETE SET NULL,
  "reviewedAt" timestamptz,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  UNIQUE (message, reporter)
);
CREATE INDEX IF NOT EXISTS auction_message_reports_status_created_idx
  ON public.auction_message_reports (status, "createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.auction_chat_rate_limits (
  id text PRIMARY KEY,
  "lastMessageAt" bigint,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "legacyData" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_model_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_message_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_chat_rate_limits ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'registration_requests', 'listings', 'auctions', 'bids', 'orders',
    'payments', 'notifications', 'reviews', 'disputes', 'verification_history',
    'reputations', 'price_models', 'price_predictions', 'price_model_evaluations',
    'auction_messages', 'auction_message_reports', 'auction_chat_rate_limits'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    EXECUTE format('DROP POLICY IF EXISTS deny_direct_access ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY deny_direct_access ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      table_name
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_compare_and_set_record(
  p_table text,
  p_id text,
  p_expected_version bigint,
  p_record jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  allowed_tables text[] := ARRAY[
    'users', 'registration_requests', 'listings', 'auctions', 'bids', 'orders',
    'payments', 'notifications', 'reviews', 'disputes', 'verification_history',
    'reputations', 'price_models', 'price_predictions', 'price_model_evaluations',
    'auction_messages', 'auction_message_reports', 'auction_chat_rate_limits'
  ];
  columns_sql text;
  source_columns_sql text;
  row_data jsonb;
  auction_row public.auctions%ROWTYPE;
BEGIN
  IF NOT p_table = ANY(allowed_tables) THEN
    RAISE EXCEPTION 'Unsupported table: %', p_table USING ERRCODE = '22023';
  END IF;
  IF p_record->>'id' IS DISTINCT FROM p_id THEN
    RAISE EXCEPTION 'Record ID does not match the transaction key' USING ERRCODE = '22023';
  END IF;

  IF p_table = 'auctions' AND p_expected_version IS NOT NULL THEN
    SELECT * INTO auction_row FROM public.auctions WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR auction_row.version <> p_expected_version THEN
      RETURN NULL;
    END IF;
    IF (
      p_record->'bidderOffers' IS DISTINCT FROM to_jsonb(auction_row."bidderOffers")
      OR p_record->'autoBids' IS DISTINCT FROM to_jsonb(auction_row."autoBids")
      OR p_record->'bidHistory' IS DISTINCT FROM to_jsonb(auction_row."bidHistory")
    ) AND (
      auction_row.status IN ('completed', 'cancelled')
      OR auction_row."startTime" > now()
      OR auction_row."endTime" <= now()
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  IF p_expected_version IS NULL THEN
    SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position),
           string_agg(format('source_row.%I', column_name), ', ' ORDER BY ordinal_position)
      INTO columns_sql, source_columns_sql
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = p_table
       AND column_name <> 'version'
       AND p_record ? column_name;
    EXECUTE format(
      'INSERT INTO public.%1$I AS inserted (%2$s, version) SELECT %3$s, 1 FROM jsonb_populate_record(NULL::public.%1$I, $1) AS source_row ON CONFLICT (id) DO NOTHING RETURNING to_jsonb(inserted)',
      p_table, columns_sql, source_columns_sql
    ) INTO row_data USING p_record;
  ELSE
    SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position),
           string_agg(format('source_row.%I', column_name), ', ' ORDER BY ordinal_position)
      INTO columns_sql, source_columns_sql
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = p_table
       AND column_name NOT IN ('id', 'version');

    EXECUTE format(
      'UPDATE public.%1$I AS target SET (%2$s, version) = (SELECT %3$s, source_row.version + 1 FROM jsonb_populate_record(target, $1) AS source_row) WHERE target.id = $2 AND target.version = $3 RETURNING to_jsonb(target)',
      p_table, columns_sql, source_columns_sql
    ) INTO row_data USING p_record, p_id, p_expected_version;
  END IF;

  IF row_data IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_table = 'auctions' THEN
    SELECT * INTO auction_row FROM public.auctions WHERE id = p_id;
    IF p_record ? 'bidHistory' AND jsonb_typeof(p_record->'bidHistory') = 'object' THEN
      INSERT INTO public.bids (id, auction, buyer, amount, type, "createdAt", demo, "legacyData")
      SELECT COALESCE(entry.value->>'id', entry.key),
             p_id,
             entry.value->>'buyer',
             NULLIF(entry.value->>'amount', '')::numeric(12, 2),
             COALESCE(entry.value->>'type', 'manual'),
             NULLIF(entry.value->>'createdAt', '')::timestamptz,
             COALESCE((entry.value->>'demo')::boolean, false),
             '{}'::jsonb
        FROM jsonb_each(p_record->'bidHistory') AS entry
      ON CONFLICT (id) DO NOTHING;
    END IF;

    IF auction_row.status = 'completed' AND auction_row.winner IS NOT NULL
       AND auction_row."winningBid" IS NOT NULL AND auction_row."order" IS NULL THEN
      INSERT INTO public.orders (
        id, "orderNumber", auction, listing, buyer, fisherman, quantity, amount,
        "paymentStatus", "orderStatus", "purchaseType", address, "paymentMethod",
        "createdAt", "updatedAt"
      )
      SELECT 'auction_' || auction_row.id,
             'TM-A-' || md5(auction_row.id),
             auction_row.id,
             listing.id,
             auction_row.winner,
             listing.fisherman,
             listing.quantity,
             auction_row."winningBid" * listing.quantity,
             'pending',
             'awaiting-checkout',
             'auction',
             '',
             '',
             now(),
             now()
        FROM public.listings AS listing
       WHERE listing.id = auction_row.listing
      ON CONFLICT (auction) DO NOTHING;

      UPDATE public.auctions AS auction
         SET "order" = order_row.id,
             "updatedAt" = now(),
             version = auction.version + 1
        FROM public.orders AS order_row
       WHERE auction.id = p_id AND order_row.auction = p_id;
      SELECT to_jsonb(auction) INTO row_data FROM public.auctions AS auction WHERE auction.id = p_id;
    END IF;
  END IF;

  RETURN row_data;
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_reserve_listing(p_listing_id text, p_buyer_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.listings
     SET status = 'reserved',
         "reservedBy" = p_buyer_id,
         "updatedAt" = now(),
         version = version + 1
   WHERE id = p_listing_id AND status = 'available';
  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_create_auction(
  p_auction_id text,
  p_listing_id text,
  p_record jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  row_data jsonb;
BEGIN
  IF p_record->>'id' IS DISTINCT FROM p_auction_id
     OR p_record->>'listing' IS DISTINCT FROM p_listing_id THEN
    RAISE EXCEPTION 'Auction data does not match its IDs' USING ERRCODE = '22023';
  END IF;
  UPDATE public.listings
     SET status = 'auction',
         "updatedAt" = now(),
         version = version + 1
   WHERE id = p_listing_id AND status = 'available';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing is unavailable for auction' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.auctions AS inserted
  SELECT (jsonb_populate_record(
    NULL::public.auctions,
    p_record || jsonb_build_object(
      'version', 1,
      'bidCount', COALESCE(p_record->'bidCount', '0'::jsonb),
      'offerSequence', COALESCE(p_record->'offerSequence', '0'::jsonb),
      'bidderOffers', COALESCE(p_record->'bidderOffers', '{}'::jsonb),
      'autoBids', COALESCE(p_record->'autoBids', '{}'::jsonb),
      'bidHistory', COALESCE(p_record->'bidHistory', '{}'::jsonb),
      'processedRequests', COALESCE(p_record->'processedRequests', '{}'::jsonb),
      'closureNotificationsSent', COALESCE(p_record->'closureNotificationsSent', 'false'::jsonb),
      'demo', COALESCE(p_record->'demo', 'false'::jsonb),
      'legacyData', COALESCE(p_record->'legacyData', '{}'::jsonb)
    )
  )).*
  RETURNING to_jsonb(inserted) INTO row_data;
  RETURN row_data;
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_create_buyout_order(
  p_listing_id text,
  p_buyer_id text,
  p_order_id text,
  p_order_number text,
  p_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  listing_row public.listings%ROWTYPE;
  order_row public.orders%ROWTYPE;
BEGIN
  UPDATE public.listings
     SET status = 'reserved',
         "reservedBy" = p_buyer_id,
         "updatedAt" = now(),
         version = version + 1
   WHERE id = p_listing_id AND status = 'available' AND "saleMode" = 'sale'
  RETURNING * INTO listing_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing is unavailable' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.orders (
    id, "orderNumber", listing, buyer, fisherman, quantity, amount,
    "paymentStatus", "orderStatus", "purchaseType", address, "createdAt", "updatedAt"
  ) VALUES (
    p_order_id, p_order_number, listing_row.id, p_buyer_id, listing_row.fisherman,
    listing_row.quantity, COALESCE(listing_row."salePrice", listing_row."expectedPrice") * listing_row.quantity,
    'pending', 'awaiting-payment', 'buyout', p_address, now(), now()
  )
  RETURNING * INTO order_row;
  RETURN to_jsonb(order_row);
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_mark_payment_paid(p_payment_id text, p_payment_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  payment_row public.payments%ROWTYPE;
  order_row public.orders%ROWTYPE;
BEGIN
  SELECT * INTO payment_row FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF payment_row.status = 'paid' THEN
    IF payment_row."gatewayPaymentId" = p_payment_payload->>'id' THEN
      RETURN to_jsonb(payment_row);
    END IF;
    RAISE EXCEPTION 'Payment attempt was already finalized with another payment ID'
      USING ERRCODE = '23505';
  END IF;
  IF payment_row.status <> 'pending' THEN RETURN NULL; END IF;

  SELECT * INTO order_row FROM public.orders WHERE id = payment_row."order" FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.payments
     SET status = 'paid',
         "gatewayPaymentId" = p_payment_payload->>'id',
         "paymentMethod" = p_payment_payload->>'method',
         "paidAt" = (p_payment_payload->>'paidAt')::timestamptz,
         "updatedAt" = now(),
         version = version + 1
   WHERE id = payment_row.id
  RETURNING * INTO payment_row;
  UPDATE public.orders
     SET "paymentStatus" = 'paid',
         "orderStatus" = 'processing',
         "paymentMethod" = 'razorpay',
         gateway = 'razorpay',
         "gatewayOrderId" = p_payment_payload->>'gatewayOrderId',
         "transactionRef" = p_payment_payload->>'id',
         "paidAt" = (p_payment_payload->>'paidAt')::timestamptz,
         "updatedAt" = now(),
         version = version + 1
   WHERE id = order_row.id;
  IF order_row.listing IS NOT NULL THEN
    UPDATE public.listings
       SET status = 'sold', "reservedBy" = NULL, "updatedAt" = now(), version = version + 1
     WHERE id = order_row.listing;
  END IF;
  RETURN to_jsonb(payment_row);
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_mark_payment_failed(p_payment_id text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  payment_row public.payments%ROWTYPE;
  order_row public.orders%ROWTYPE;
BEGIN
  SELECT * INTO payment_row FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF payment_row.status = 'paid' THEN RETURN to_jsonb(payment_row); END IF;
  IF payment_row.status NOT IN ('creating', 'pending') THEN RETURN to_jsonb(payment_row); END IF;
  UPDATE public.payments
     SET status = 'failed',
         "failureReason" = left(COALESCE(p_reason, 'Payment was not completed'), 160),
         "updatedAt" = now(),
         version = version + 1
   WHERE id = payment_row.id
  RETURNING * INTO payment_row;
  SELECT * INTO order_row FROM public.orders WHERE id = payment_row."order" FOR UPDATE;
  IF FOUND THEN
    UPDATE public.orders
       SET "paymentStatus" = 'failed',
           "orderStatus" = 'payment-failed',
           "updatedAt" = now(),
           version = version + 1
     WHERE id = order_row.id;
    IF order_row.listing IS NOT NULL AND order_row."purchaseType" = 'buyout' THEN
      UPDATE public.listings
         SET status = 'available', "reservedBy" = NULL, "updatedAt" = now(), version = version + 1
       WHERE id = order_row.listing
         AND status = 'reserved'
         AND "reservedBy" = order_row.buyer;
    END IF;
  END IF;
  RETURN to_jsonb(payment_row);
END
$$;

REVOKE ALL ON FUNCTION public.tidemarket_compare_and_set_record(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tidemarket_reserve_listing(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tidemarket_create_auction(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tidemarket_create_buyout_order(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tidemarket_mark_payment_paid(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tidemarket_mark_payment_failed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tidemarket_compare_and_set_record(text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.tidemarket_reserve_listing(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tidemarket_create_auction(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.tidemarket_create_buyout_order(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tidemarket_mark_payment_paid(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.tidemarket_mark_payment_failed(text, text) TO service_role;
