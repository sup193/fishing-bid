# TideMarket Mobile

The Expo app uses Expo Router for role-based navigation and Expo SecureStore for the signed-in session. Buyer, fisherman, and admin accounts open their own mobile workspace.

## Mobile workspaces

- **Buyer:** browse fixed-price and auction listings, compare auction/listing/verified-sales price trends, view location-scoped demand insights and available matching catches, place manual or automatic bids with a private maximum, follow live bid history and countdowns, receive auction notifications, see recommendations, review bids and orders, and view payment transactions.
- **Fisherman:** post fixed-price or auction listings, see price estimates and verified demand guidance without automatic price or quantity changes, review advisory catch recommendations, stop auctions, review buyer orders, advance paid orders through processing/delivery/completion, view verified sales, monitor bids, and review transactions.
- **Admin:** view marketplace totals and recent orders, filter aggregated demand analytics by date/species/category/location, review rolling forecast performance, moderate listings, manage fisherman accounts, review buyer registration requests, monitor bids, and review transactions.

Demand forecasts use a transparent weighted moving average over verified, non-demo Razorpay-paid order quantities. At least three distinct sale days are required for an individual forecast; otherwise the app shows that there is insufficient data. Listings and bids are displayed only as activity context, not as realized sales. Forecasts and catch recommendations are advisory and do not guarantee future sales.

Razorpay checkout is not yet available inside the native app. Buyers can use the website to complete a payment; the app does not create or mark a payment as paid without a verified checkout.

## Run locally

1. Start the API from the repository root with `npm run dev --prefix server`.
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to an address reachable from the device.
3. From this folder, run `npm start` and open the project in Expo Go.

For an Android emulator, use `http://10.0.2.2:5000/api`. For an iOS simulator, `http://localhost:5000/api` works. For a physical phone, use your computer's LAN IP (for example, `http://192.168.1.10:5000/api`) and make sure the phone and computer are on the same network and the computer firewall allows port 5000. Use HTTPS for a deployed API.

Run `npm run lint` in this folder to check the mobile app. The mobile app uses the same buyer, fisherman, and admin accounts as the website.
