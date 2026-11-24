# Express API endpoint coverage

The complete route inventory is maintained in [server/test/api-endpoint-inventory.json](./server/test/api-endpoint-inventory.json). It includes method, mounted path, access class, and the automated authorization probe applied to each route.

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
- `listingApi.test.js`, `auctionApi.test.js`, `auctionBidding.test.js`
- `paymentApi.test.js`, `reputationApi.test.js`, `demandApi.test.js`
- `databaseCrud.test.js`, `databaseConfig.test.js`, `securityRules.test.js`

This is not a claim that every public endpoint has every valid, malformed, database-failure, and duplicate-request combination tested. The inventory labels public endpoints as `endpoint-specific`; their detailed contract coverage is uneven and should be expanded as endpoint changes are made. The automated authorization matrix is exhaustive for the discovered protected surface.
