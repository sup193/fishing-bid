# TideMarket Mobile

The Expo app uses Expo Router for role-based navigation and Expo SecureStore for the signed-in session. Buyer, fisherman, and admin accounts open their own mobile workspace.

## Mobile workspaces

- **Buyer:** browse fixed-price and auction listings, compare auction/listing/verified-sales price trends, place auction bids, see recommendations, review bids and orders, and view payment transactions.
- **Fisherman:** post fixed-price or auction listings, stop auctions, review buyer orders, advance paid orders through processing/delivery/completion, view verified sales, monitor bids, and review transactions.
- **Admin:** view marketplace totals and recent orders, moderate listings, manage fisherman accounts, review buyer registration requests, monitor bids, and review transactions.

Razorpay checkout is not yet available inside the native app. Buyers can use the website to complete a payment; the app does not create or mark a payment as paid without a verified checkout.

## Run locally

1. Start the API from the repository root with `npm run dev --prefix server`.
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to an address reachable from the device.
3. From this folder, run `npm start` and open the project in Expo Go.

For an Android emulator, use `http://10.0.2.2:5000/api`. For an iOS simulator, `http://localhost:5000/api` works. For a physical phone, use your computer's LAN IP (for example, `http://192.168.1.10:5000/api`) and make sure the phone and computer are on the same network and the computer firewall allows port 5000. Use HTTPS for a deployed API.

Run `npm run lint` in this folder to check the mobile app. The mobile app uses the same buyer, fisherman, and admin accounts as the website.
