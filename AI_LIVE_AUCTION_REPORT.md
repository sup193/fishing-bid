# Fishing Bid Live Auction Enhancements Report

## Summary

This update extends the existing Fishing Bid auction workflow; it does not replace auction creation, atomic bidding, automatic-bid ranking, late-bid extensions, settlement, checkout, notifications, or the existing bid-review dashboard.

Added functionality:

- Buyer-facing auction guidance that combines verified completed-auction outcomes with the existing fish-price and demand prediction modules.
- Optional total-spend limits for automatic bidding, enforced by the backend against the full listing quantity.
- Authenticated buyer/fisherman auction chat with message validation, rate limiting, buyer reporting, and administrator moderation.
- Admin auction activity analytics by species and location, plus aggregate review signals.
- Web and Expo interfaces for those features.

## Architecture and Workflow

1. Existing auction bidding remains transactionally serialized in `server/src/auctionBidding.js`; the total-budget ceiling is stored only with the buyer's private automatic-bid state.
2. The auction-insights endpoint reads completed auction orders and includes only orders verified as paid through the existing Razorpay verification convention. It compares same-species per-kilogram sale prices when enough observations exist.
3. If there are fewer than five verified comparable auction sales, the service returns a low-confidence activity baseline rather than inventing historical prices or claiming model accuracy.
4. The insights response also invokes the existing fish-price prediction and verified-sales demand services, and presents those estimates separately from the auction closing range.
5. Authenticated buyers and the listing fisherman share a public-to-logged-in-participants chat. Administrators can review reports and hide or restore a message.
6. Admin analytics use aggregated auction, listing, and bid data. Risk signals are review prompts only; they do not prevent bids, alter winners, or cancel auctions.
7. Live auction detail refresh continues to use the project's current web/mobile polling. Polling updates auction details without overwriting a buyer's manually edited bid amount or clearing validation feedback. Chat refreshes every five seconds while open. Existing outbid/leader/closure notices remain; accepted bids also notify the listing fisherman. Automatic settlement remains unchanged.

## Auction Guidance Method

Model/version label: `verified-auction-reference-v1`.

- **Comparable data:** completed auction orders with `paymentStatus === "paid"`, `gateway === "razorpay"`, a non-empty `transactionRef`, a valid quantity and amount, and a non-demo listing/order.
- **Unit price:** verified order amount divided by order quantity.
- **Historical estimate:** only when at least five same-species verified sales are available. The final-price range uses the empirical 25th and 75th percentiles, floored at the live current price. The median is also returned as a reference.
- **Insufficient-data baseline:** minimum is the current price; maximum is current price plus one to three minimum increments. The increment count is capped at three and based on the number of distinct recorded bidders.
- **Suggested next bid:** current price plus the auction's minimum increment. The UI only offers to prefill the bid field; it never submits a bid.
- **Confidence:** `moderate` with five or more verified same-species completed paid auction observations; otherwise `low`.
- **Demand and price context:** returned from the existing verified-sales demand forecast and fish-price prediction services, each with its own data-status/reliability metadata and disclaimer.

No separate regression, neural network, or auction-specific trained model is implemented. No live market accuracy or performance claim is made. Forecast outputs are guidance, not a guaranteed closing price.

## Automatic-Bidding Budget

The existing per-kilogram maximum remains supported. A buyer may also provide a total budget:

`effectivePerKgLimit = min(requestedPerKgLimit, floor(totalBudget / listingQuantity * 100) / 100)`

When only a total budget is supplied, the budget-derived per-kilogram limit is used. Bids still must satisfy the current minimum bid. The total budget and effective per-kg limit are stored privately in `auctions/{id}/autoBids/{buyerId}`. Public auction responses continue stripping all automatic limits. The listing quantity is fixed for an active auction by existing listing rules.

## Suspicious-Activity Signals

Existing per-bid rules continue to flag rapid bidding and unusually large jumps. The new auction-level activity summary adds:

- Bid concentration: at least six recorded bids, with one account responsible for at least 75%.
- Rapid activity: at least five bids by one account in the last 60 seconds.

These are deterministic heuristics, not an AI fraud detector. They are not proof of wrongdoing and do not block bids. Administrators and fishermen retain human review responsibility.

## Chat and Data Structures

New server-only Firebase nodes:

- `auctionMessages/{messageId}` — auction ID, author ID/role, text, creation time, publication status, and optional moderation metadata.
- `auctionMessageReports/{reportId}` — reported message, auction, reporter, reason, and review status.
- `auctionChatRateLimits/{hashedAuctionUserKey}` — last message timestamp used for a server-side 1.5-second per-user/per-auction send interval.

Existing node extended:

- `auctions/{id}/autoBids/{buyerId}` — optional private `totalBudget` alongside the existing effective per-kilogram maximum.

Messages are capped at 500 characters. The API rejects email-address patterns and text containing ten or more digits to reduce contact-detail sharing; this is a basic guard, not comprehensive PII detection. Chat responses do not return author account IDs or contact data. The existing Firebase client rules remain default-deny; all reads/writes go through authenticated Express routes and Firebase Admin.

## API Endpoints

All routes require bearer authentication. Admin endpoints are additionally protected by the existing admin router middleware.

| Method and path | Roles | Purpose |
|---|---|---|
| `GET /api/auctions/:id/insights` | Buyer | Bid suggestion, closing range, price estimate, and demand context |
| `GET /api/auctions/:id/chat` | Buyer, owning fisherman | Read recent visible messages |
| `POST /api/auctions/:id/chat` | Buyer, owning fisherman | Post a message in an open auction |
| `POST /api/auctions/:id/chat/:messageId/report` | Buyer | Report another author's message |
| `POST /api/auctions/:id/automatic-bidding` | Buyer | Existing per-kg maximum plus optional `totalBudget` |
| `GET /api/auctions/:id/automatic-bidding` | Buyer | Return only the authenticated buyer's limits |
| `GET /api/admin/auction-analytics` | Admin | Aggregate counts, species activity, and review signals; supports `from`, `to`, `fishType`, `category`, `location`, and `status` |
| `GET /api/admin/auction-chat/reports` | Admin | List pending reported messages |
| `PATCH /api/admin/auction-chat/:id/moderation` | Admin | Set message status to `hidden` or `published` |

## Screens and Components

- Web buyer auction detail: smart auction guide, prefilling the next minimum bid, budget-aware automatic bidding, and moderated auction chat.
- Web fisherman inventory: per-auction chat modal for answering buyer questions.
- Web admin dashboard: filterable auction analytics, species activity, review signals, and chat moderation in `AuctionAnalytics`.
- Expo buyer auction detail: equivalent guidance, chat, and total-budget input.
- Expo fisherman inventory: auction chat modal.
- Expo admin navigation: auction analytics and chat moderation.

## Tests and Build Results

Automated coverage added for:

- Verified-history percentile and insufficient-history fallback behavior.
- Advisory-only bid concentration flags and privacy-preserving analytics aggregates.
- Automatic-bid total-budget persistence and privacy.
- Budget-derived effective bid limits, including a budget below the minimum bid.
- Buyer-only, read-only insights access and preliminary price/demand states; tests confirm guidance does not change auction price or bid history.
- Chat participant checks (buyers and the listing fisherman only), message length/contact validation, send-rate limiting, reporting, and admin moderation.
- Admin-only auction analytics, filters, and omission of bidder identifiers.

Validation run for this implementation:

- Backend: `npm.cmd test --prefix server` — **65 passed, 0 failed**. This suite includes auction, automatic-bidding, demand, reputation, and price-prediction tests.
- Web production build: `npm.cmd run build --prefix client` — **passed**. Vite emitted a bundle-size advisory; the largest generated JavaScript chunk was 502.55 kB.
- Web and Expo-web Playwright suite: `npm.cmd run test:e2e --prefix client` — **10 passed, 0 failed**. The suite runs with one worker because the test API shares a mutable file-backed fixture. A multi-worker attempt produced API-unreachable failures; serializing the same unchanged assertions made the full suite pass.
- Expo web export: `npx.cmd expo export --platform web` from `mobile/` — **passed**.
- Targeted ESLint on all changed mobile JavaScript files — **passed**.
- Full mobile lint — **one pre-existing error remains** in `mobile/src/components/common.js:188` (`react-hooks/set-state-in-effect`); that file was not changed for this feature.
- `git diff --check` — **passed**.
- No live production database or real Razorpay sale history was available for measuring price/closing-range accuracy.

## Limitations and Follow-up

- The auction range is a transparent empirical/heuristic baseline, not a trained auction model; model confidence should not be read as a calibrated probability.
- The minimum five-sale threshold is a conservative availability gate, not evidence that five records ensure statistical accuracy.
- Sparse-history ranges may be wide or uninformative. Seasonality, location-specific auction effects, buyer intent, and auction duration are not calibrated.
- The total-spend ceiling is a bid-value cap before checkout; it does not include taxes, delivery, or later checkout changes.
- Web/mobile auction updates use the existing short polling intervals. There is no client-facing Firebase listener, WebSocket, or SSE transport in this implementation.
- Chat contact filtering is deliberately basic. Production deployments should add stronger abuse controls, retention policy, and a human response workflow.
- Admin analytics report bid activity and signals, not measured fraud, bid collusion, or prediction error. A real-time model monitoring dataset is not present.
- Firebase rules are not loosened. Deploy the existing `database.rules.json` and keep Admin SDK credentials server-side.

## Changed Files

New:

- `AI_LIVE_AUCTION_REPORT.md`
- `client/playwright.config.js`
- `client/src/AuctionAnalytics.jsx`
- `mobile/src/app/admin/auction-analytics.js`
- `mobile/src/features/auctionAnalytics.js`
- `server/src/auctionInsights.js`
- `server/test/auctionInsights.test.js`

Modified:

- `README.md`
- `client/src/BidMonitoring.jsx`
- `client/src/admin/AdminDashboard.jsx`
- `client/src/api.js`
- `client/src/fisherman/FishermanDashboard.jsx`
- `client/src/styles.css`
- `client/src/user/UserApp.jsx`
- `mobile/api.js`
- `mobile/src/app/admin/_layout.js`
- `mobile/src/features/buyer.js`
- `mobile/src/features/fisherman.js`
- `mobile/src/features/shared.js`
- `server/src/auctionBidding.js`
- `server/src/routes/admin.js`
- `server/src/routes/user.js`
- `server/test/auctionApi.test.js`
- `server/test/auctionBidding.test.js`
