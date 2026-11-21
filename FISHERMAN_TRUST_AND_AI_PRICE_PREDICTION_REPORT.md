# Fisherman Trust & Fish Price Prediction

## Summary

The project now integrates fisherman reputation and fish-price guidance with the existing Express API, Firebase Realtime Database adapter, React web client, and Expo app. The backend remains authoritative for scores, eligibility, sale observations, and prediction results. Direct Firebase client reads and writes remain denied by `database.rules.json`.

Reputation is earned only from verified Razorpay-paid marketplace orders that have a transaction reference and are not marked as demo data. Buyers can submit one 1–5 star review per verified completed order. Reviews are pending until an administrator approves them; only approved reviews affect the public score. Complaints affect reputation only after an administrator confirms a finding.

Price prediction uses a transparent rule baseline until enough verified paid sales are available. The model evaluator compares that baseline with a one-variable linear regression calibration on a chronological holdout. A model is not called validated unless evaluation shows a material improvement. No actual market accuracy is claimed by this implementation.

## Architecture and workflows

### Reputation

1. A buyer pays for a listing/auction order through the existing payment workflow.
2. The backend verifies captured Razorpay payment status and transaction reference. A fisherman advances a paid order through processing, delivered, and completed states.
3. The buyer submits a review against their own completed order. An atomic database transaction reserves one review key per order.
4. An administrator approves/rejects the review, reviews complaints, and manages fisherman verification.
5. Backend services calculate the score from verified orders, approved reviews, administrator-confirmed disputes, and verified account status. Recalculation is persisted with a score history when the score, level, or rated status changes.
6. Public listing and fisherman reputation responses include a privacy-limited score summary and approved recent reviews; buyer identity is not included in public review summaries.

### Price guidance

1. A buyer or fisherman requests a prediction, or the seller enters/edits a listing.
2. The backend validates the species, quantity, grade, size, freshness, location, and season month.
3. Training/market observations are built only from non-demo Razorpay-paid orders with transaction references and valid quantity and amount.
4. The system uses the existing per-species/grade/size/quantity price guide as a baseline. With sufficient verified data it can apply guarded local/seasonal adjustments or a validated linear calibration.
5. The response includes a per-kg estimate, total, ±8% range, trend, reliability, explanatory factors, optional historical data, prediction date, and an estimate disclaimer.
6. Seller interfaces warn if their price is over 20% outside the recommendation. The system never changes the entered price.

## Trust score formula

The weights sum to 100. Only measured factors participate; the weighted average is normalized by the sum of measured weights. A fisherman with no verified paid activity is `unrated` with no earned reputation level (the numeric storage value is 0).

| Factor | Weight | Evidence and factor score |
|---|---:|---|
| Completion | 25% | Completed verified paid orders / verified paid orders × 100 |
| On-time delivery | 15% | On-time deliveries / completed orders having both expected and delivered timestamps × 100; omitted when no timestamped delivery exists |
| Ratings | 20% | Approved verified-order rating average / 5 × 100; omitted without approved reviews |
| Cancellations | 10% | 100 − fisherman-attributed cancellations / verified paid orders × 100; only verified paid orders are counted |
| Disputes | 10% | max(0, 100 − 35 × administrator-confirmed disputes); unreviewed and unconfirmed complaints do not count |
| Verification | 10% | 100 for administrator-verified account, otherwise 0 |
| Consistency | 10% | min(100, 10 × verified completed orders) |

Levels: Excellent 90–100, Trusted 75–89, Good 60–74, Average 40–59, Needs Improvement 0–39. Scores are computed on the server; no fisherman-facing write endpoint exists. Factors, sample counts, explanations, improvement suggestions, and status are returned for transparency.

## Firebase data structure

Existing records are retained; these features add/read the following nodes:

| Node | Purpose |
|---|---|
| `reputations/{fishermanId}` | Current calculated score, factor breakdown, source signature, update time, and score-change history |
| `reviews/order_{orderId}` | One review per order; buyer/fisherman/order references, rating, comment, moderation status and administrator metadata |
| `disputes/order_{orderId}` | One complaint per order; references, complaint text, review finding and administrator metadata |
| `verificationHistory/{id}` | Administrator verification changes |
| `pricePredictions/{id}` | Prediction audit record; requester, role, inputs, estimate, model and timestamp |
| `priceModels/active` | Active validated linear-calibration coefficients or evaluated rule baseline |
| `priceModelEvaluations/{id}` | Evaluation status, data counts, holdout metrics, selected model and evaluator |

Training sales are derived from existing `orders` and `listings`; no fake historical prices are created. Firebase’s Admin SDK is used server-side. The database rules continue to deny clients all direct reads and writes.

## API endpoints

### Public and authenticated marketplace endpoints

| Endpoint | Access | Purpose |
|---|---|---|
| `GET /api/fishermen/:id/reputation` | Public | Public, privacy-limited reputation summary |
| `GET /api/fisherman/reputation` | Fisherman | Own dashboard and score breakdown |
| `GET /api/buyer/reviews` | Buyer | Reviews submitted by the signed-in buyer |
| `POST /api/orders/:id/reviews` | Buyer | Submit a review for own verified completed order |
| `POST /api/orders/:id/disputes` | Buyer | Report an issue with own verified paid order |
| `POST /api/price-predictions/preview` | Buyer, fisherman | Non-persisting estimate (used by listing forms) |
| `POST /api/price-predictions` | Buyer, fisherman | Estimate and record a prediction request |
| `GET /api/price-predictions` | Buyer, fisherman | Own prediction history |
| `PATCH /api/listings/:id` | Owning fisherman | Update fixed-price listing price, quantity, or freshness; refreshes stored estimate when needed |

### Administrator endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/reputation` | Fisherman scores and calculation details |
| `GET /api/admin/reviews` / `PATCH /api/admin/reviews/:id/moderation` | Investigate and moderate reviews |
| `GET /api/admin/disputes` / `PATCH /api/admin/disputes/:id/review` | Investigate complaints and record findings |
| `PATCH /api/admin/fishermen/:id/verification` | Update verification and record its history |
| `GET /api/admin/price-analytics` | Verified sale data availability, species summaries, model state and evaluations |
| `POST /api/admin/price-model/evaluate` | Evaluate available verified sales and update the active model |

All authenticated endpoints use the existing JWT authentication and role middleware. API validation rejects malformed inputs and role/ownership violations.

## Prediction model, training requirements, and evaluation

- **Current baseline:** existing project price guide by species, grade, size, and a quantity adjustment. It is explicitly preliminary.
- **Candidate model:** ordinary least-squares linear regression mapping the rule-baseline price to verified historical price per kg. This compact candidate avoids adding a new ML runtime/dependency to the Node service.
- **Evaluation:** chronological 80/20 split; at least 50 verified sale observations are required, with at least 10 held-out observations. MAE, RMSE, and sMAPE are computed. Regression is selected only when holdout MAE is at least 5% lower than baseline MAE; otherwise the rule baseline remains active.
- **Location and season:** median adjustments are applied only with at least five matching verified samples and are clamped to 0.8–1.2×. Trend compares the last 30 days against the preceding 30 days, requiring at least three observations in both periods; changes under 3% are Stable.
- **Freshness:** currently an explicitly reported, uncalibrated explanatory factor; it does not change the estimate until reliable verified training data supports that adjustment.
- **Training data requirements:** at least 50 non-demo captured/paid Razorpay transactions with a transaction reference, valid paid amount, quantity, listing species, and sale timestamp. Accurate location, grade, size, and season fields improve segment calibration. Data must represent real transactions rather than demo listings or asking prices.
- **Evaluation results:** the automated suite tests input validation, exclusion of malformed/demo data, preliminary fallback, guarded location/season adjustment, and synthetic regression fitting/selection. The inspected local database contains 20 orders and **0 eligible verified sale observations**, so it cannot produce a real-data model evaluation. The tests do **not** establish real-market accuracy. No real-data MAE/RMSE/sMAPE is reported here; the administrator evaluation endpoint reports these only after sufficient verified sales are present.

## Screens and components

### Web

- `ReputationPanel.jsx`: fisherman trust score, level/verification badge, activity metrics, weighted breakdown, improvement suggestions, and recent reviews.
- `BuyerHistory.jsx`: verified completed-order review form, complaint form, and submitted review history.
- `PricePredictionTool.jsx`: prediction form, reliability, range/total/trend, historical sales chart where available, factors, and estimate disclaimer.
- `FishermanDashboard.jsx`: recommendation and deviation warning during listing creation and fixed-price listing editing; edit warnings do not alter the chosen price.
- `UserApp.jsx`: trust and price estimate on marketplace cards/details and auction details.
- `AdminTrustPricing.jsx`: verification, score explanations, review moderation, complaints, price analytics, and model evaluation.

### Expo

- `Reputation.js` and fisherman reputation screen: score, level, verification, breakdown, improvements, and approved reviews.
- Buyer history: eligible review submission, complaint reporting, and submitted review list.
- Price prediction screen and summary component: species/quantity/quality/freshness/size/location/season inputs and estimate display.
- Buyer listing and auction interfaces: fisherman trust data and indicative price range.
- Fisherman listing form and fixed-price listing editor: live recommendation and deviation warning without changing the chosen price.
- Admin trust/pricing screen: reputation, moderation, complaints, verification, and model analytics.

## Verification performed

- Backend: `npm.cmd test --prefix server` — **46 passed, 0 failed**.
- Web: `npm.cmd run build --prefix client` — succeeded after the seller edit UI change.
- Mobile: `npx.cmd expo export --platform web --output-dir "$env:TEMP\\tidemarket-mobile-export-check"` — succeeded. `npm.cmd run lint --prefix mobile -- --ignore-pattern src/components/common.js` — passed. Full `npm.cmd run lint --prefix mobile` still reports one pre-existing `react-hooks/set-state-in-effect` error in `mobile/src/components/common.js`; the same rule also found and was corrected in the seller estimate workflow.
- Firebase credentials are not supplied to this task’s test setup, so live Firebase persistence/deployment was not exercised; API tests use the project’s local JSON adapter.
- Existing backend test suite also covers auction bidding/automatic bidding, payment state, auth/roles, Firebase default-deny rules, and marketplace API access.

## Limitations and future improvements

- The initial price guide is a transparent estimate, not live market data or a guaranteed transaction price. No real-market validation metrics are available until the application has enough verified sale history.
- The candidate regression is a one-feature calibration, not a feature-rich model. With a larger, representative dataset, compare richer regressors and use time-aware cross-validation, segment-specific error reporting, drift monitoring, and retraining approval.
- Location/season segments have minimum sample gates; freshness is not yet calibrated. Historical chart/trend output is intentionally absent when the evidence threshold is not met.
- Reputation is based on available recorded workflow evidence. Buyers should continue to use marketplace dispute and payment processes; an automated score is not a guarantee of transaction quality.
- The mobile app’s native payment checkout remains outside this feature and was not changed.
