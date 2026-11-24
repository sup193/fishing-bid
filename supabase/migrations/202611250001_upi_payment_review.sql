ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS "upiRecipientId" text,
  ADD COLUMN IF NOT EXISTS "upiPaymentReference" text,
  ADD COLUMN IF NOT EXISTS "upiUtr" text,
  ADD COLUMN IF NOT EXISTS "referenceSubmittedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "verificationStatus" text,
  ADD COLUMN IF NOT EXISTS "verifiedBy" text,
  ADD COLUMN IF NOT EXISTS "verifiedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "rejectionReason" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_verified_by_fkey'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_verified_by_fkey
      FOREIGN KEY ("verifiedBy") REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS payments_upi_reference_unique
  ON public.payments ("upiPaymentReference")
  WHERE "upiPaymentReference" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_upi_utr_unique
  ON public.payments (upper(btrim("upiUtr")))
  WHERE "upiUtr" IS NOT NULL AND btrim("upiUtr") <> '';
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_upi_attempt_per_order
  ON public.payments ("order")
  WHERE gateway = 'upi' AND status IN ('pending', 'pending_verification') AND "order" IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_upi_verification_queue_idx
  ON public.payments ("createdAt" DESC)
  WHERE gateway = 'upi' AND status = 'pending_verification';

CREATE OR REPLACE FUNCTION public.tidemarket_create_upi_payment_attempt(
  p_payment_id text,
  p_order_id text,
  p_buyer_id text,
  p_upi_reference text,
  p_upi_recipient text,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  order_row public.orders%ROWTYPE;
  payment_row public.payments%ROWTYPE;
  listing_row public.listings%ROWTYPE;
  auction_row public.auctions%ROWTYPE;
BEGIN
  SELECT * INTO order_row
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;
  IF NOT FOUND OR order_row.buyer <> p_buyer_id THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF order_row."paymentStatus" = 'paid' THEN
    RETURN jsonb_build_object('status', 'already_paid');
  END IF;
  IF COALESCE(order_row."paymentStatus", 'pending') NOT IN ('pending', 'failed')
     OR order_row.amount IS NULL OR order_row.amount <= 0
     OR order_row.amount <> round(order_row.amount, 2) THEN
    RETURN jsonb_build_object('status', 'invalid_amount');
  END IF;

  SELECT * INTO payment_row
    FROM public.payments
   WHERE "order" = p_order_id
     AND gateway = 'upi'
     AND status IN ('pending', 'pending_verification')
   ORDER BY "createdAt" DESC
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'existing', 'payment', to_jsonb(payment_row), 'order', to_jsonb(order_row));
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payments
     WHERE "order" = p_order_id
       AND COALESCE(gateway, '') <> 'upi'
       AND status IN ('creating', 'pending')
  ) THEN
    RETURN jsonb_build_object('status', 'active_other_payment');
  END IF;

  IF order_row."purchaseType" = 'buyout' THEN
    SELECT * INTO listing_row
      FROM public.listings
     WHERE id = order_row.listing
     FOR UPDATE;
    IF NOT FOUND OR listing_row.status <> 'reserved' OR listing_row."reservedBy" <> p_buyer_id THEN
      RETURN jsonb_build_object('status', 'ineligible');
    END IF;
  ELSIF order_row.auction IS NOT NULL THEN
    SELECT * INTO auction_row
      FROM public.auctions
     WHERE id = order_row.auction
     FOR UPDATE;
    IF NOT FOUND OR auction_row.status <> 'completed' OR auction_row.winner <> p_buyer_id THEN
      RETURN jsonb_build_object('status', 'ineligible');
    END IF;
  ELSE
    RETURN jsonb_build_object('status', 'ineligible');
  END IF;

  INSERT INTO public.payments (
    id, "order", "orderNumber", buyer, fisherman, listing, amount, currency,
    gateway, status, mode, "paymentMethod", "upiRecipientId",
    "upiPaymentReference", "verificationStatus", demo, "createdAt", "updatedAt"
  ) VALUES (
    p_payment_id, order_row.id, order_row."orderNumber", order_row.buyer,
    order_row.fisherman, order_row.listing, order_row.amount, 'INR',
    'upi', 'pending', 'manual', 'upi_qr', p_upi_recipient,
    p_upi_reference, 'awaiting_payment', order_row.demo, p_now, p_now
  ) RETURNING * INTO payment_row;

  UPDATE public.orders
     SET "paymentStatus" = 'pending',
         "orderStatus" = 'awaiting-payment',
         "paymentMethod" = 'upi_qr',
         gateway = 'upi',
         "updatedAt" = p_now,
         version = version + 1
   WHERE id = order_row.id
  RETURNING * INTO order_row;

  RETURN jsonb_build_object(
    'status', 'created',
    'payment', to_jsonb(payment_row),
    'order', to_jsonb(order_row)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_submit_upi_reference(
  p_payment_id text,
  p_buyer_id text,
  p_utr text,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  payment_row public.payments%ROWTYPE;
  order_row public.orders%ROWTYPE;
  order_id text;
  normalized_utr text := upper(btrim(p_utr));
BEGIN
  SELECT "order" INTO order_id
    FROM public.payments
   WHERE id = p_payment_id AND buyer = p_buyer_id AND gateway = 'upi';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO order_row
    FROM public.orders
   WHERE id = order_id
   FOR UPDATE;
  IF NOT FOUND OR order_row.buyer <> p_buyer_id
     OR order_row."paymentStatus" = 'paid' THEN
    RETURN jsonb_build_object('status', 'ineligible');
  END IF;
  SELECT * INTO payment_row
    FROM public.payments
   WHERE id = p_payment_id AND buyer = p_buyer_id AND gateway = 'upi'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF payment_row.gateway <> 'upi' OR payment_row.status <> 'pending' THEN
    RETURN jsonb_build_object('status', 'invalid_status');
  END IF;
  IF normalized_utr !~ '^[A-Z0-9]{6,40}$' THEN
    RETURN jsonb_build_object('status', 'invalid_reference');
  END IF;

  IF order_row.id <> payment_row."order" OR order_row.buyer <> p_buyer_id
     OR order_row.amount <> payment_row.amount
     OR order_row."paymentStatus" = 'paid' THEN
    RETURN jsonb_build_object('status', 'ineligible');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payments
     WHERE id <> payment_row.id
       AND upper(btrim("upiUtr")) = normalized_utr
  ) THEN
    RETURN jsonb_build_object('status', 'duplicate_reference');
  END IF;

  BEGIN
    UPDATE public.payments
       SET status = 'pending_verification',
           "upiUtr" = normalized_utr,
           "referenceSubmittedAt" = p_now,
           "verificationStatus" = 'pending',
           "updatedAt" = p_now,
           version = version + 1
     WHERE id = payment_row.id
    RETURNING * INTO payment_row;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'duplicate_reference');
  END;

  RETURN jsonb_build_object('status', 'submitted', 'payment', to_jsonb(payment_row));
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_review_upi_payment(
  p_payment_id text,
  p_action text,
  p_admin_id text,
  p_rejection_reason text,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  payment_row public.payments%ROWTYPE;
  order_row public.orders%ROWTYPE;
  listing_row public.listings%ROWTYPE;
  auction_row public.auctions%ROWTYPE;
  order_id text;
BEGIN
  IF p_action NOT IN ('verify', 'reject') THEN
    RETURN jsonb_build_object('status', 'invalid_action');
  END IF;
  SELECT "order" INTO order_id
    FROM public.payments
   WHERE id = p_payment_id AND gateway = 'upi';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO order_row
    FROM public.orders
   WHERE id = order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_order');
  END IF;
  SELECT * INTO payment_row
    FROM public.payments
   WHERE id = p_payment_id AND gateway = 'upi'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF payment_row.status <> 'pending_verification'
     OR payment_row."verificationStatus" <> 'pending' THEN
    RETURN jsonb_build_object('status', 'already_reviewed');
  END IF;
  IF order_row.id <> payment_row."order" OR order_row.buyer <> payment_row.buyer
     OR order_row.amount IS DISTINCT FROM payment_row.amount THEN
    RETURN jsonb_build_object('status', 'invalid_order');
  END IF;
  IF order_row."paymentStatus" IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('status', 'invalid_order');
  END IF;

  IF p_action = 'reject' THEN
    UPDATE public.payments
       SET status = 'rejected',
           "verificationStatus" = 'rejected',
           "verifiedBy" = p_admin_id,
           "verifiedAt" = p_now,
           "rejectionReason" = left(COALESCE(NULLIF(btrim(p_rejection_reason), ''), 'Payment reference could not be verified'), 300),
           "updatedAt" = p_now,
           version = version + 1
     WHERE id = payment_row.id
    RETURNING * INTO payment_row;
    UPDATE public.orders
       SET "paymentStatus" = 'failed',
           "orderStatus" = 'payment-failed',
           "updatedAt" = p_now,
           version = version + 1
     WHERE id = order_row.id
    RETURNING * INTO order_row;
    IF order_row."purchaseType" = 'buyout' THEN
      UPDATE public.listings
         SET status = 'available',
             "reservedBy" = NULL,
             "updatedAt" = p_now,
             version = version + 1
       WHERE id = order_row.listing
         AND status = 'reserved'
         AND "reservedBy" = order_row.buyer;
    END IF;
    RETURN jsonb_build_object(
      'status', 'rejected',
      'payment', to_jsonb(payment_row),
      'order', to_jsonb(order_row)
    );
  END IF;

  IF order_row."paymentStatus" IS DISTINCT FROM 'pending'
     OR payment_row.amount IS NULL
     OR payment_row.amount <= 0
     OR payment_row."upiUtr" IS NULL
     OR payment_row."upiUtr" !~ '^[A-Z0-9]{6,40}$'
     OR EXISTS (
       SELECT 1 FROM public.payments other
        WHERE other.id <> payment_row.id
          AND upper(btrim(other."upiUtr")) = upper(btrim(payment_row."upiUtr"))
     ) THEN
    RETURN jsonb_build_object('status', 'invalid_order');
  END IF;

  IF order_row."purchaseType" = 'buyout' THEN
    SELECT * INTO listing_row
      FROM public.listings
     WHERE id = order_row.listing
     FOR UPDATE;
    IF NOT FOUND OR listing_row.status <> 'reserved' OR listing_row."reservedBy" <> order_row.buyer THEN
      RETURN jsonb_build_object('status', 'invalid_order');
    END IF;
  ELSIF order_row.auction IS NOT NULL THEN
    SELECT * INTO auction_row
      FROM public.auctions
     WHERE id = order_row.auction
     FOR UPDATE;
    IF NOT FOUND OR auction_row.status <> 'completed' OR auction_row.winner <> order_row.buyer THEN
      RETURN jsonb_build_object('status', 'invalid_order');
    END IF;
  ELSE
    RETURN jsonb_build_object('status', 'invalid_order');
  END IF;

  UPDATE public.payments
     SET status = 'paid',
         "verificationStatus" = 'verified',
         "verifiedBy" = p_admin_id,
         "verifiedAt" = p_now,
         "paidAt" = p_now,
         "updatedAt" = p_now,
         version = version + 1
   WHERE id = payment_row.id
  RETURNING * INTO payment_row;
  UPDATE public.orders
     SET "paymentStatus" = 'paid',
         "orderStatus" = 'processing',
         "paymentMethod" = 'upi_qr',
         gateway = 'upi',
         "transactionRef" = payment_row."upiUtr",
         "paidAt" = p_now,
         "updatedAt" = p_now,
         version = version + 1
   WHERE id = order_row.id
  RETURNING * INTO order_row;
  IF order_row.listing IS NOT NULL THEN
    UPDATE public.listings
       SET status = 'sold',
           "reservedBy" = NULL,
           "updatedAt" = p_now,
           version = version + 1
     WHERE id = order_row.listing;
  END IF;

  RETURN jsonb_build_object(
    'status', 'verified',
    'payment', to_jsonb(payment_row),
    'order', to_jsonb(order_row),
    'fishermanId', order_row.fisherman
  );
END
$$;

REVOKE ALL ON FUNCTION public.tidemarket_create_upi_payment_attempt(text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tidemarket_submit_upi_reference(text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tidemarket_review_upi_payment(text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tidemarket_create_upi_payment_attempt(text, text, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.tidemarket_submit_upi_reference(text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.tidemarket_review_upi_payment(text, text, text, text, timestamptz) TO service_role;
