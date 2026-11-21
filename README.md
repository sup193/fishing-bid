# TideMarket Smart Fishing Platform

This is a React and Express smart fishing marketplace with Firebase Realtime Database, separated user/admin code, auctions, bidding, orders, and role-based access.

## MERN quick start

1. If a root `.env` does not exist, copy `.env.example` to `.env`. If it already exists, keep its existing Firebase settings and add only the missing variables.
2. In Firebase Console, open **Project settings → Service accounts** and generate a private key. Add it to the root `.env` as `FIREBASE_SERVICE_ACCOUNT_JSON`, or set `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` separately.
3. For test payments, create Razorpay **Test Mode** API keys in the Razorpay Dashboard and set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `.env`. The server accepts only `rzp_test_` keys in this implementation. Never expose the API secret in client code. Without the API keys, checkout reports that the gateway is not configured and does not mark orders paid.
4. Run `npm install` in the root, then `npm run install:all`.
5. Start both applications with `npm run dev`.
6. Open `http://localhost:5173`.

The React user surface is in `client/src/user/` and the admin surface is in `client/src/admin/`. API modules live under `server/src/routes/`. The administrator account is seeded when the API starts:

- `tide@gmail.com` / `Tide@123`

To open the admin dashboard locally, start the project with `npm run dev`, go to `http://localhost:5173`, choose **Log in**, and enter the admin credentials above. Logging in with an admin account opens the command center for fisherman management, buyer registration requests, marketplace metrics, and transactions. Change the default development password before using this account outside a local demo.

The credentials above are development defaults only. Production startup requires explicitly configured `JWT_SECRET` and `ADMIN_PASSWORD` values; set a unique administrator password and never use the development defaults in production.

### Save logins with a browser password manager

The login and account-creation forms use standard username/password autocomplete fields so Chrome/Google Password Manager can offer to save or autofill each account after you sign in. Accept Chrome's **Save password?** prompt and choose the Google account/profile where you want it stored. If the prompt is not shown, use the key icon in Chrome's address bar or check Chrome → **Settings → Password Manager**. TideMarket stores account passwords as bcrypt hashes; it does not send plaintext passwords to Google. Admin, buyer, and fisherman logins use the same compatible login form.

The API stores users, listings, auctions, bids, orders, and payment attempts in Firebase Realtime Database under the `users`, `listings`, `auctions`, `bids`, `orders`, and `payments` nodes. Its indicative price guide is a transparent rule-based estimate in `server/src/utils.js`, based on species, seller-reported grade, size, and quantity. It is not an ML prediction or a live market quote, and it does not guarantee a sale price. Seafood quality grades are seller-reported; photo identification checks species only and does not detect freshness or food safety.

### Explore the complete marketplace with demo data

For a local walkthrough, run `npm run seed:demo` from the project root, then open `http://localhost:5173`. The command is repeatable and adds labeled practice records without overwriting existing records. It creates four fisherman accounts, three buyer accounts, 15 seafood species, a mix of fixed-price and auction listings, bid history, and pending practice checkouts with practice-only transaction entries. Demo checkouts are not real payments and are never marked as verified/paid. The seed command refuses to write when Firebase credentials are configured unless you explicitly run `npm run seed:demo --prefix server -- --allow-firebase`.

All demo accounts use the password `TideDemo!2026`:

| Role | Email |
|---|---|
| Fisherman | `asha.fisherman@tidemarket.demo` |
| Fisherman | `ravi.fisherman@tidemarket.demo` |
| Fisherman | `meera.fisherman@tidemarket.demo` |
| Fisherman | `arun.fisherman@tidemarket.demo` |
| Buyer | `kiran.buyer@tidemarket.demo` |
| Buyer | `nisha.buyer@tidemarket.demo` |
| Buyer | `dev.buyer@tidemarket.demo` |

### Walkthrough

1. Sign in as a fisherman and review Inventory, Buyer orders, and Transactions. A fisherman can publish a fixed-price catch or an auction listing.
2. Sign in as a buyer and filter the marketplace by seafood, location, quantity, or sale type. Fixed-price catches use Buy now; open auctions show the current highest bid and let buyers place bids above the minimum increment.
3. Use Bids & Orders and Transactions in the buyer dashboard to review private bid, checkout, and payment-attempt history. Practice entries are visibly labeled and have not charged a payment method.
4. The public Market Pulse chart compares daily auction-bid prices, fixed-price listing prices, and verified paid-order prices per kilogram. Filter by date range and seafood type; paid sales include only verified Razorpay orders, not practice or pending checkouts.
5. To test a real payment flow, configure Razorpay Test Mode as described below, then check out an eligible order with Razorpay's test payment details. Without test credentials, payment stays unavailable rather than being falsely recorded as paid.

### Mobile app

The Expo app has role-specific tabs for buyers, fishermen, and admins, including marketplace browsing, manual and automatic auction bidding, live auction details and notices, the auction/listing/verified-sales trend chart, listing and order management, buyer approvals, moderation, bid review, and transaction history. See [mobile/README.md](./mobile/README.md) for setup instructions. Native Razorpay checkout is not enabled yet; buyers can use the website to complete a payment.

### Auction settlement and bid review

The API checks auctions on startup and every 15 seconds. When an auction reaches its end time, it closes automatically, records the highest bidder as the winner, and creates a pending checkout order. A fisherman can also stop bidding early from Inventory; the same winner settlement runs immediately. Fishermen can review auction history in **Bid history**, and administrators can review all auctions under **Bid review**.

Buyer auction details poll the API for live bid history and timer updates. Manual bids and automatic maximums are validated and serialized in an auction-record transaction. Automatic limits and bidder offer ceilings are stored privately under each auction and removed from public API responses; each accepted leading bid is also mirrored to the existing `bids` node for dashboard and history compatibility. Automatic bidding raises the public price only as needed, breaks equal maximums in favor of the earlier eligible offer, and never bids above a buyer's configured limit. A valid bid in the final 30 seconds extends the server-owned end time by 30 seconds. Auction results use the transactionally stored leader and price, then create the existing pending Razorpay checkout order.

The API stores auction activity in `auctions/{id}` (`currentPrice`, `currentBidder`, `bidCount`, `bidderOffers`, `autoBids`, `bidHistory`, and request de-duplication keys), mirrors bid records to `bids`, and writes bid/closure notices for buyers and fishermen to `notifications`. The maximum amounts are private application data and are not returned by public listing or auction endpoints. Deploy [database.rules.json](./database.rules.json) to Firebase Realtime Database to deny direct client reads and writes; the server's Firebase Admin SDK continues to perform authorized operations. Do not give browser or mobile clients Firebase Admin credentials.

New bids are flagged for human review when one buyer places at least five bids in 60 seconds, or when a bid is at least twice the previous high and exceeds it by at least five minimum increments. These are review signals, not proof of fraud; bids are not blocked automatically. The bid review screens show the full bid timeline and flagged activity.

### Auction guidance, budget caps, and chat

The buyer auction view includes an advisory next-bid suggestion, a final-price range, the existing fish-price estimate, and a demand snapshot. Historical auction ranges use same-species auction orders that completed and were verified as paid through Razorpay; at least five such orders are required. Below that threshold, the system clearly marks a low-confidence baseline that starts from the current bid and adds one to three minimum increments based on bidder activity. This is a transparent heuristic, not a trained auction model or an accuracy claim. The suggested next bid is the server-computed minimum increment and is never placed automatically.

Automatic bidding can be limited by both a maximum bid per kilogram and an optional maximum total spend for the full listing. The backend derives the effective per-kilogram cap from the listing quantity, stores both limits privately with the auction, and never exposes them in public auction responses. Fishermen can answer buyer questions in a per-auction chat. Chat is visible to signed-in buyers and the listing fisherman, caps message length, rate-limits sends, and rejects email addresses and phone-like contact strings. Buyers can report messages for administrator review; moderation can hide or restore a message.

Admin auction analytics aggregate auctions and bids by species and location, with optional date/species/category/location/status filters. Bid concentration and rapid-bid signals are rule-based review prompts only. Neither those signals nor chat reports automatically block bids, cancel auctions, or establish misconduct. Auction details continue using the existing short-interval API refresh in web and mobile; the project does not currently have client-authorized Firebase listeners or a WebSocket/SSE transport. Notifications for outbids, leading-bid changes, new seller bids, closing, and settlement remain in the notification workflow.

The new authenticated endpoints are:

| Endpoint | Allowed role | Purpose |
|---|---|---|
| `GET /api/auctions/:id/insights` | Buyer | Advisory auction range, next bid, price estimate, and demand snapshot |
| `GET /api/auctions/:id/chat` | Buyer, owning fisherman | Read recent auction messages |
| `POST /api/auctions/:id/chat` | Buyer, owning fisherman | Send a validated message in an open auction |
| `POST /api/auctions/:id/chat/:messageId/report` | Buyer | Submit a message for admin review |
| `GET /api/admin/auction-analytics` | Admin | Aggregate/filter auction activity and human-review signals |
| `GET /api/admin/auction-chat/reports` | Admin | List pending chat reports |
| `PATCH /api/admin/auction-chat/:id/moderation` | Admin | Hide or restore a reported message |

Chat records and rate-limit markers are stored in the server-only `auctionMessages`, `auctionMessageReports`, and `auctionChatRateLimits` Firebase nodes. Budget ceilings remain in the existing private `auctions/{id}/autoBids` data. No Firebase client rule was loosened; deploy the existing default-deny [database.rules.json](./database.rules.json), and continue accessing these nodes only through the authenticated Express API/Firebase Admin SDK.

### Upload a real catch photo

When signed in as a fisherman, choose **Post a catch**, select fixed price or bidding, then choose **Identify species & upload photo**. The app attempts to identify the catch, selects the model's best species match, and uploads the photo for the listing. Confirm or change the species before publishing. Photo upload still works when the classifier is unavailable, so you can select the species manually. Accepted formats are JPG, PNG, and WEBP, up to 5 MB; uploaded listing photos are served from `server/uploads/`.

Buyers and guests can use **Search by photo** beside the marketplace search field. On mobile devices this opens the camera when supported; desktop browsers can select an image. A successful prediction filters listings to the suggested species and shows alternative model matches.

Photo identification requires the actual `server/models/fish_classifier.keras` weights and Python with TensorFlow and NumPy installed. This checkout may contain only a Git LFS pointer instead of the model weights; in that case, retrieve the model asset (or train it with `python train.py`) and install the classifier dependencies. The detector will report that setup is missing instead of pretending it identified the fish. Its model recognizes the 31 classes in `server/models/fish_labels.json`; visual predictions are suggestions and fishermen should confirm the species.

### Razorpay checkout and transaction history

The checkout uses Razorpay Checkout and must be configured with Razorpay API keys. The server creates INR payment orders, verifies the checkout signature, confirms/captures the payment with Razorpay, and only then marks an order paid. Payment attempts are recorded in the `payments` node; buyers, fishermen, and admins have role-scoped transaction-history views. Configure the Razorpay webhook at `/api/payments/razorpay/webhook` with the `RAZORPAY_WEBHOOK_SECRET` from the Razorpay Dashboard, subscribing to `payment.captured`, `order.paid`, and `payment.failed`, so payment updates are still recorded if a buyer closes the browser before returning from checkout. Test keys do not charge real money. Use Razorpay's test payment details while testing. This implementation accepts test keys only.

Orders marked paid by the old demo checkout are not treated as verified Razorpay transactions and are excluded from verified paid-volume totals.

### Fisherman reputation and fish-price estimates

The marketplace shows an explainable fisherman trust score based on verified paid orders, approved reviews, recorded delivery data, administrator-reviewed disputes, and verification status. Buyers may review only their own verified completed orders; reviews are moderated before being included in public scores. The price assistant uses a transparent baseline until enough verified sales exist to evaluate a regression calibration. Recommendations are estimates, not guaranteed prices, and never overwrite a fisherman’s chosen listing price. See [FISHERMAN_TRUST_AND_AI_PRICE_PREDICTION_REPORT.md](./FISHERMAN_TRUST_AND_AI_PRICE_PREDICTION_REPORT.md) for formulas, database nodes, endpoints, model evaluation rules, testing status, and limitations.

### AI demand forecasting

The buyer, fisherman, and admin workspaces include demand insights derived from verified, non-demo Razorpay-paid marketplace orders. Only order quantities are used for quantitative demand forecasts; current listings and auction bids appear as separate activity context and are not treated as sales. Buyer insights are scoped to the buyer's saved location when present. Location comparisons use aggregated landing-area labels and do not expose buyer identities or order-level records.

The current baseline is a weighted moving average over recent daily verified sales (7-, 28-, and 90-day lookbacks for 24-hour, 7-day, and 30-day estimates). A species forecast requires at least three distinct sale days in its window; otherwise the UI reports insufficient data. Demand categories compare the forecast daily rate with that species' observed average (High at 120% or more, Low at 80% or less, otherwise Medium). Confidence reflects the count of sale days. Weekly day-of-week insights appear only when history is sufficiently long. This is a transparent baseline, not a deep-learning model, guaranteed demand, or proof of seasonal/festival effects.

Admins can filter analytics by date range, species, category, and location, and review rolling one-day-ahead performance (MAE, MAPE when defined, and sMAPE) when enough held-out observations exist. Evaluation uses only the 28 days before each evaluated day. Fisherman quantity suggestions are advisory and capped by that fisherman's recorded available catch. The listing form may show a demand note next to the existing price estimate; no forecast automatically creates or edits a listing, price, or quantity.

Demand endpoints (all require bearer-token authentication):

| Endpoint | Allowed role | Purpose |
|---|---|---|
| `GET /api/demand/forecast` | Buyer, fisherman | Filterable demand snapshot |
| `GET /api/demand/trending` | Buyer | Compact trending and location insights |
| `GET /api/demand/buyer` | Buyer | Buyer dashboard forecast and aggregated locations |
| `GET /api/demand/fisherman` | Fisherman | Forecasts and inventory-capped recommendations |
| `GET /api/admin/demand/analytics` | Admin | Filterable aggregate demand analytics |
| `GET /api/admin/demand/performance` | Admin | Walk-forward forecast evaluation |

Optional query filters are `from` and `to` (`YYYY-MM-DD`), `fishType`, `category`, and `location`; date ranges are limited to 366 days. Forecast and performance results are computed from existing `orders`, `listings`, `auctions`, and `bids` nodes; no duplicate demand-history node or model training store is required. Existing Firebase rules remain default-deny for direct client access; the authenticated Express API uses Firebase Admin. See [AI_DEMAND_FORECASTING_REPORT.md](./AI_DEMAND_FORECASTING_REPORT.md) for implementation details, evaluation status, setup, and limitations.

Run validation from the repository root:

```powershell
npm test --prefix server
npm run build --prefix client
npm run test:e2e --prefix client
```

For Expo compatibility, run `npx expo export --platform web` from `mobile/`; run `npm run lint` there for the full mobile lint suite.

See [AI_LIVE_AUCTION_REPORT.md](./AI_LIVE_AUCTION_REPORT.md) for auction-guidance methodology, data requirements, endpoints, tests, and current limitations.

## Fish image classifier

The 31-class model is trained from `dataset/FishImgDataset/` with EfficientNetB0 transfer learning:

```powershell
python train.py
```

Training writes the model, class labels, and test metrics to `server/models/`. To classify a new image:

```powershell
python predict.py --image path\to\fish.jpg
```

The completed training run achieved 93.58% accuracy on the supplied test split. `predict.py` prints the top prediction and two alternatives with confidence scores.
