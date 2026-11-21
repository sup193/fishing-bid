# AI Demand Forecasting Report

## Summary

Fishing Bid now has role-protected demand insights for buyers, fishermen, and administrators. Forecasts are calculated on the server from the existing marketplace database. The implementation uses a transparent weighted-moving-average baseline; it does not claim deep learning, fabricated sales history, or verified forecast accuracy.

Only verified, non-demo Razorpay-paid orders contribute quantitative demand. Listings and auction bids are reported separately as market activity. Buyer IDs and order-level customer details are not returned.

## Architecture and workflow

1. Express loads existing orders, listings, auctions, and bids through the Firebase Admin-backed database abstraction.
2. `demandForecast.js` joins verified orders to their existing listing and validates species, quantity, amount, and timestamps.
3. Aggregation groups quantities by UTC sale date, fish type, and normalized landing-area label.
4. The service builds daily, weekly, and monthly history, forecasts three horizons, demand categories, trend direction, confidence, and optional inventory-capped fisherman recommendations.
5. Role-protected routes return the aggregate to the web and Expo clients. No forecast history is duplicated or persisted.
6. Administrators can run a rolling one-day-ahead backtest over the prior year; each evaluated point uses only the preceding 28 days.

## Forecasting method

The current model is `verified-sales-wma-v1`, a weighted moving average over daily order quantities. For observations ordered oldest to newest, the weights are 1 through *N*:

`weighted daily rate = sum(daily quantity × observation weight) / sum(observation weights)`

The daily series includes zero-sale days.

| Forecast horizon | Lookback | Predicted quantity |
|---|---:|---|
| Next 24 hours | 7 days | Weighted daily rate × 1 |
| Next 7 days | 28 days | Weighted daily rate × 7 |
| Next 30 days | 90 days | Weighted daily rate × 30 |

A horizon requires at least three distinct sale days in its lookback. Otherwise its predicted quantity, index, and confidence are reported as unavailable. Confidence is low for 3–9 sale days, medium for 10–29, and high for 30 or more; these are data-volume indicators, not statistical probability intervals.

Demand index compares the weighted rate to the simple daily average for the same lookback. Categories are High at 120 or more, Low at 80 or less, and Medium otherwise. Historical trend compares the latest seven days with the prior seven; changes above 10% are Increasing, below -10% are Decreasing, and other changes are Stable. A strongest weekday is shown only when at least 56 days and eight sale days are available.

The backtest predicts each eligible day from the previous 28 days and reports MAE and sMAPE, plus MAPE over non-zero actual observations. Metrics are withheld until at least seven held-out observations exist. No model-performance or accuracy claim is made for live marketplace data unless those metrics are available.

## Data and database structure

No new Firebase node is required. The implementation reuses:

- `orders`: paid-order timestamps, quantities, payment state, transaction reference, and listing reference.
- `listings`: fish type, landing area, status, and seller-owned available inventory.
- `auctions` and `bids`: non-sales activity context only.

An order is eligible only when it passes the existing `isVerifiedPaidOrder` check (paid Razorpay payment, transaction reference present, and not marked as demo), references an existing listing, and has valid positive quantity, amount, and a non-future timestamp. The service excludes customer identifiers from its output.

Location comparisons normalize case and whitespace and use the listing's landing-area label. They are not geospatial distance calculations. The current buyer route applies the buyer's saved location when present. The fisherman route applies the fisherman's saved location and limits quantity recommendations to the fisherman's own active inventory. Admin aggregates contain area totals, never customer-level data.

`database.rules.json` remains default-deny for direct client reads and writes. The Express service uses the privileged Firebase Admin SDK after authentication and role checks. No Firebase security-rule change or migration is required.

## API

All endpoints require authentication. Optional filters are `from`, `to` (`YYYY-MM-DD`), `fishType`, `category`, and `location`; ranges cannot exceed 366 days and future end dates are rejected.

| Method and path | Role | Response |
|---|---|---|
| `GET /api/demand/forecast` | Buyer, fisherman | Filterable aggregate forecast |
| `GET /api/demand/trending` | Buyer | Compact trending, direction, and location summary |
| `GET /api/demand/buyer` | Buyer | Buyer insights scoped to saved location when available |
| `GET /api/demand/fisherman` | Fisherman | Forecasts and available-catch-capped recommendations |
| `GET /api/admin/demand/analytics` | Admin | Filterable totals, species, history, activity, and locations |
| `GET /api/admin/demand/performance` | Admin | Walk-forward error metrics and data sufficiency status |

Invalid filters return HTTP 400. Role mismatches are rejected by the existing authorization middleware. Results include model version, calculation time, data availability, and a forecast disclaimer.

## User interfaces

### Web

- Fisherman dashboard: demand insights, 24-hour/7-day/30-day outlook, trend, confidence, historical daily/weekly/monthly chart, location aggregates, and inventory-capped advisory quantities.
- Listing creation: current verified demand signal is displayed alongside the existing price estimate. Demand does not modify the seller's chosen price or quantity.
- Buyer dashboard: location-scoped trending varieties and available matching listings, with navigation to filtered marketplace listings.
- Admin dashboard: date, species, category, and location filters; total and species demand; area aggregates; historical chart; and backtest metrics.

### Expo

- Added Demand tabs for buyer, fisherman, and admin roles.
- Fishermen see demand trends, recommended varieties, and advisory catch suggestions.
- Buyers can inspect location-level insights and navigate to matching market listings.
- Administrators can filter demand analytics and see performance metrics.
- The mobile listing form displays a demand note next to the existing price recommendation.

All screens display loading, API error, and insufficient-data states. No charts or sample demand values are hardcoded.

## Evaluation and testing

The automated tests use controlled fixtures to verify data eligibility, location/species/category/date filters, privacy, all forecast horizons, insufficient history, seller inventory caps, and one-day-ahead evaluation. Fixture-based backtest results validate the implementation only; they are not evidence of live-market accuracy.

The API tests cover unauthenticated access, buyer/fisherman/admin role boundaries, invalid species handling, low-data status, verified-sale quantities, and the absence of customer IDs.

The current project dataset does not provide enough verified history to make a live accuracy claim. When insufficient history is present, the product reports that state rather than substituting listing prices, bids, fabricated sales, or sample predictions.

Final validation performed for this implementation:

- Backend: 56 tests passed, including the demand service and demand API suites.
- Playwright: 10 web and Expo-web end-to-end tests passed, including buyer and fisherman demand low-data screens.
- Web: production Vite build passed.
- Mobile: Expo web export passed; ESLint on all changed mobile files passed.
- Full mobile ESLint still reports one existing issue in `mobile/src/components/common.js:188` (`react-hooks/set-state-in-effect`); the demand implementation adds no additional lint findings.
- `git diff --check` passed.

## Limitations and future work

- The baseline does not model annual seasonality, holidays, festivals, weather, or supply shocks. These effects are not inferred without reliable historical data.
- The weekday pattern is descriptive only and does not change the forecast.
- Location grouping is based on user-entered landing-area text; spelling variants may split aggregates.
- The database abstraction currently reads whole collections and filters in application code. Large production datasets may require indexed time/species/location queries or scheduled aggregate materialization.
- Confidence labels reflect the number of observed sale days, not calibrated probability intervals.
- A trained regression or seasonal model should be introduced only after enough representative data is available and a chronological holdout demonstrates improvement over this baseline.
- Fisherman quantity suggestions divide forecast demand by active listing count and cap at recorded inventory; they are advisory, do not account for unrecorded catch or supply-chain constraints, and do not guarantee sales.

## Commands

From the repository root:

```powershell
npm run dev
npm test --prefix server
npm run build --prefix client
npm run test:e2e --prefix client
```

From `mobile/`:

```powershell
npm run lint
npx expo export --platform web
```

