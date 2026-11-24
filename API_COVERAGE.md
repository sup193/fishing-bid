# Express API endpoint coverage

The complete route inventory is maintained in [server/test/api-endpoint-inventory.json](./server/test/api-endpoint-inventory.json). It includes method, mounted path, access class, and the automated authorization probe applied to each route.

The current inventory contains **85 endpoints**: 17 public, 43 authenticated user routes, and 25 admin routes. The authorization smoke tests exercise all 68 protected routes anonymously and verify all 25 admin routes reject a buyer.

Regenerate after adding or changing Express routes:

```powershell
npm run report:api --prefix server
```

Check that the committed inventory is current:

```powershell
npm run report:api --prefix server -- --check
```

`server/test/apiAuthorizationSurface.test.js` discovers routes from the mounted Express routers and verifies:

- Every protected user/admin endpoint rejects anonymous requests with HTTP 401.
- Every admin endpoint rejects an authenticated buyer with HTTP 403.
- The runtime route table exactly matches the tracked inventory.

Endpoint-specific request validation, ownership, success, duplicate, payment, and auction behavior are covered by the existing focused API suites, including:

- `emailOtp.test.js`, `passwordReset.test.js`
- `loginRateLimit.test.js`
- `listingApi.test.js`, `auctionApi.test.js`, `auctionBidding.test.js`
- `paymentApi.test.js`, `reputationApi.test.js`, `demandApi.test.js`
- `databaseCrud.test.js`, `databaseConfig.test.js`, `securityRules.test.js`

This is not a claim that every public endpoint has every valid, malformed, database-failure, and duplicate-request combination tested. The inventory labels public endpoints as `endpoint-specific`; their detailed contract coverage is uneven and should be expanded as endpoint changes are made. The automated authorization matrix is exhaustive for the discovered protected surface.

`npm run test:performance --prefix server` runs a controlled local-adapter smoke measurement with 80 concurrent marketplace/auction reads and 10 concurrent automatic bids. It prints p50/p95 client-observed latencies. These figures characterize only the temporary local test fixture; they are not production or Supabase performance claims.

Latest local observations: API reads under the 80-request burst measured p50 1,855 ms / p95 2,399 ms; the 10 automatic bids measured p50 234 ms / p95 235 ms. The local guest landing page measured 316 ms to DOMContentLoaded and 3,460 ms to the load event. These are one-run diagnostics without an SLO threshold. The listings route performs additional auction/bid reads while shaping listing details, which is a likely hotspot to profile against a larger dataset and real PostgreSQL before tuning.
