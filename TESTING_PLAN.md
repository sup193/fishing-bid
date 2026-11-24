# Fishing Bid automated testing plan

## Plan

1. Inventory package scripts, existing backend and Playwright coverage, Express routes, database adapters, Expo route files, and GitHub Actions.
2. Compare requested workflows with existing coverage; avoid duplicating tests or using production services.
3. Add runtime-discovered authorization checks for every protected API route, plus buyer-denial checks for every admin route.
4. Generate a complete Express endpoint inventory and make tests/CI fail if it becomes stale.
5. Add pull-request, main-branch, and manual GitHub Actions checks for backend tests, API inventory, API performance smoke, frontend lint/build, mobile lint, and Playwright, retaining failure traces.
6. Add regression tests for confirmed security findings, run the full local suites, and document service/device limitations.

The static security review found that login attempts were not throttled. Per-account and per-IP limits were added before password hashing, with regression cases for limits, successful-login reset, malformed input, and concurrent attempts.

## Safety boundaries

- Backend integration tests use temporary local-adapter databases; they do not connect to production Supabase.
- Email and Razorpay requests are mocked in tests. UPI tests do not transfer funds.
- Playwright uses isolated local test servers on ports other than the existing API port 5000.
- Expo Playwright runs browser emulation; it is not native Android/iOS device testing.
- Live Supabase schema constraints require a dedicated isolated PostgreSQL/Supabase test project and are not claimed as verified by local-adapter tests.
