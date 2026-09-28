# Grovio Backend

Node.js + Express + MongoDB (Mongoose) backend serving 5 roles: **Admin**, **Vendor**, **Customer**, **Picker**, **Delivery**.

## API Docs (Swagger)

Interactive, browsable docs for all ~135 endpoints: **http://localhost:5000/api-docs**

- Click **Authorize** (top right) and paste an `accessToken` from a `/auth/login` or `/auth/verify-otp` response to unlock the protected endpoints, then use **Try it out** on any operation to fire a real request at the running server and see the real response.
- Raw OpenAPI 3.0 spec (JSON): **http://localhost:5000/api-docs.json** — hand this file to the Flutter developer directly, or feed it to a codegen tool (e.g. `openapi-generator`, `dio`'s `swagger_dart_code_generator`) to auto-generate Dart API client + model classes instead of hand-writing them.
- Spec source lives in `src/docs/` (`schemas.js` = response model shapes, `paths/*.paths.js` = one file per role matching the route files, `openapi.js` = assembles it all). Update these alongside any route change so the docs never drift from the code.

## Sharing with a remote developer (Postman + public URL)

- **Postman collection**: `Grovio.postman_collection.json` (160 requests, one folder per module — generated straight from the OpenAPI spec, so it never drifts). Import it into Postman, then import `Grovio.postman_environment.json` too and select it — it carries `{{baseUrl}}` and `{{accessToken}}` variables the whole collection uses. Log in with any `/auth/...` request, copy the `accessToken` from the response into the environment's `accessToken` value, and every other request picks it up automatically (collection-level Bearer auth).
- **Local network URL** (same WiFi/office network as the developer): `http://192.168.1.26:5000` — Swagger at `http://192.168.1.26:5000/api-docs`, API base `http://192.168.1.26:5000/api/v1`. Use `Grovio.postman_environment_local.json` for this. This IP can change if you reconnect to WiFi or switch networks — re-check with `ipconfig` (look for the Wi-Fi adapter's IPv4 address) if it stops working.
- **Public URL for a remote dev**: this backend runs on `localhost`, which only your machine can reach. To hand a working link to someone remote without deploying anywhere, run a Cloudflare quick tunnel (no account needed):
  ```
  cloudflared tunnel --url http://localhost:5000
  ```
  It prints a `https://<random-words>.trycloudflare.com` URL — update the `baseUrl` in `Grovio.postman_environment.json` (or the Swagger UI's server dropdown) to `https://<that-url>/api/v1`, and Swagger docs are reachable at `https://<that-url>/api-docs`. **These free quick tunnels can silently die** (no uptime guarantee) and — unlike a real ngrok/Cloudflare named tunnel — can't reconnect on the same URL once they do; if links stop working, just kill the old `cloudflared` process and re-run the command above for a fresh URL, then update the environment file. Fine for handing a working demo to a developer, not for production. For anything longer-lived, deploy the backend properly (Railway/Render/a VPS) instead.

## Setup

1. Make sure MongoDB is running locally (default: `mongodb://127.0.0.1:27017`). The `grovio` database is created automatically on first write.
2. Copy `.env.example` to `.env` and fill in values (Mongo URI, JWT secret, Razorpay test keys).
3. Install dependencies:
   ```
   npm install
   ```
4. Seed the default super-admin, base categories, and settings:
   ```
   npm run seed
   ```
   Optional sample data: `npm run seed:gigs` (hourly gigs for today + 6 days, so the app's Gigs screen isn't empty — `node src/seeders/gigs.seed.js 14` for 14 days) and `npm run seed:announcements`.
5. Run the server:
   ```
   npm run dev
   ```
   Server starts on `http://localhost:5000`.

Default admin login (from `.env`): `admin@grovio.com` / `Admin@12345` (**change immediately**). The seeded admin has `permissions: ['*']` (full super-admin access).

## Business Model: Vendors run Stores

A **Vendor** is the business entity (owner account, documents, overall commission rate, approval status). A vendor can operate **multiple Stores** — each with its own address/location, timings, open/closed toggle, and zone. Products, inventory, pickers, and orders are all scoped to a specific **Store**; financial records (`Order.vendor`) also carry the owning vendor so commission/settlement reporting doesn't need to join through stores.

## Auth

- **Admin & Vendor**: `POST /api/v1/auth/login` (email + password). Vendors self-register via `POST /api/v1/auth/register-vendor` (creates the Vendor business + their first Store) and need admin approval before they can log in.
- **Customer / Picker / Delivery**: `POST /api/v1/auth/send-otp` / `resend-otp` → `POST /api/v1/auth/verify-otp`. Send `{ phone }` with the 10-digit number only (e.g. `"9876543210"`). `+91` is assumed; `countryCode` is optional and only needed for a non-Indian number. `verify-otp` takes `otp` (an alias `code` also works) and an optional `role` (defaults to `customer` — the Customer app never sends it; Picker/Delivery pass their own role explicitly on first signup only). The response's **`isNewUser`** flag is the single source of truth for whether the client should show a "create your profile" screen before Home. In dev, the OTP is logged to the console and returned in the response as `debugOtp` (`OTP_DEBUG_MODE=true`); set `OTP_FIXED_CODE` (e.g. `1234`) to always issue that exact code instead of a random one.
  - **Resend cooldown**: server-enforced, not just a UI timer — repeat `send-otp`/`resend-otp` calls within `OTP_RESEND_COOLDOWN_SECONDS` (default 30) get `429` with `{ retryAfter }`.
  - **Picker app** uses the dedicated `POST /auth/picker/send-otp` / `resend-otp` / `verify-otp` with the same `{ phone }` body (no `role`). Before an OTP is sent or consumed, they reject a number registered under another role (409) and a disabled picker (403). On first signup they create a `pending` PickerProfile. They return `pickerProfile` plus `onboarding: { status, profileComplete, kycComplete, nextStep }`, where `nextStep` is `profile` (POST /auth/picker/register) → `kyc` (PATCH /picker/kyc-upload) → `pending_approval` → `home` (or `blocked`). `GET /auth/picker/me` returns the same for splash-screen routing. The Register screen submits `POST /auth/picker/register { name, email, gender, dateOfBirth: "DD/MM/YYYY" }`. The mobile number isn't in the body; it's the OTP-verified `user.phone`. The picker must be 18+, a duplicate email returns 409, and field errors come back as `422 errors: [{ field, message }]`. Sign out with `POST /auth/picker/logout { refreshToken }` (this device) or `POST /auth/picker/logout-all`. Both revoke the refresh token(s), set the picker offline and unavailable so no new pick jobs are assigned, and clear the push token.
  - **Wrong-OTP lockout**: after `OTP_MAX_VERIFY_ATTEMPTS` (default 5) incorrect attempts on the same OTP, verify-otp returns `400` with `errors: [{ reason: 'max_attempts' }]` and the client must request a fresh OTP. Other failure reasons are `invalid | expired | not_found`, each with its own message, so the UI can show a specific inline error rather than one generic one.
- **Profile**: `PUT /me` accepts `{ name, email, gender, profileImage }` — `gender` is `male | female | other`.
- **Tokens**: login/verify-otp return `{ accessToken, refreshToken }`. Access tokens are short-lived (`JWT_EXPIRES_IN`, default 1d); refresh tokens are long-lived (`REFRESH_TOKEN_EXPIRES_DAYS`, default 30) and stored **hashed** in the `RefreshToken` collection. `POST /auth/refresh` rotates them (old one is revoked, a new pair issued). `POST /auth/logout` revokes one session; `POST /auth/logout-all` revokes every session for that user.
- Google/Apple login (`POST /auth/google`, `/auth/apple`) are wired as routes but return `501` — they need OAuth app credentials from the client team before the token-verification step can be implemented.
- All protected routes require `Authorization: Bearer <accessToken>`.
- `GET/PUT /me` (also aliased at the top level, not just `/auth/me`) reads/updates the current user's profile.

## Admin RBAC + Audit Log

- `User.permissions: string[]` — the seeded admin has `['*']` (super-admin). Additional staff admins are created via `POST /admin/admins` with an explicit permission subset (see `src/utils/permissions.js` for the full list: `manage_vendors`, `manage_stores`, `manage_catalog`, `manage_inventory`, `manage_orders`, `manage_pickers`, `manage_delivery`, `manage_promotions`, `manage_payments`, `manage_settlements`, `manage_settings`, `manage_admins`, `view_reports`).
- Every admin route (except the shared dashboard) is guarded by `requirePermission(...)` (`src/middleware/permission.middleware.js`).
- Sensitive admin actions (approvals, status changes, settlement generate/pay, refunds, permission changes) are recorded in `AdminActivityLog`, viewable via `GET /admin/activity-logs`.

## Realtime

Socket.IO on the same port. Connect with `auth: { token: <accessToken> }`; the handshake runs the same checks as HTTP auth (valid JWT, user exists and is active).

On connect every socket joins `user:<id>`. Admins also join `orders:all` (full `manage_orders` / `*`) or `store:<assignedStore>` (store managers).

**Live order feed.** Every `Order` save is pushed automatically (Mongoose hook in `order.model.js` → `src/sockets/orderEvents.js`, coalesced per order over ~50ms). It goes to the customer, the assigned delivery partner, the assigned pickers, the hub/contributing stores' managers, and full-access admins:
- `order:created` / `order:updated`, with payload `{ orderId, orderNumber, orderStatus, paymentStatus, paymentMethod, grandTotal, customer, store, delivery, pickTasks[{ picker, store, status }], updatedAt }`. This is a summary; refetch the order over HTTP for full detail.
- Bulk `Order.updateOne` / `updateMany` calls bypass the hook. If you add one, call `publishOrderChange()` yourself.

Per-order room: `socket.emit('order:subscribe', orderId, ack)` joins it. Access is checked against the same visibility rules as the HTTP order endpoints, and the ack is `{ ok: true }` or `{ ok: false, message }`. `order:unsubscribe` leaves it. That room receives `order:status`, `delivery:location` and `picker:location`. `notification` goes to `user:<id>`.

The admin panel and customer web both use this (`src/realtime/`): order queries refresh live, and admins get a new-order toast and a Live indicator in the header.

Live tracking adds `delivery:location { orderId, lat, lng, eta }` (customer + order room) and `rider:location` (admins). See Live Tracking below.

Hub screens (below) connect with `auth: { hubDisplayKey }` instead of a token. They receive `hub:order` `{ orderId, orderNumber, orderStatus }` for orders whose hub is their store (never the full summary), and `hub:qr` when their check-in QR has been used.

## Hub Center Screen + Delivery Boy Check-in

A TV/tablet at each Hub Center opens **`/hub-display`** (served by this backend, like `/partner-login`). It shows the hub's *Ready for pickup* and *Being packed* orders live, plus a **single-use check-in QR**: it has no timer and changes as soon as a delivery partner checks in with it. A **buzzer** sounds (and the card pulses) when an order becomes ready, i.e. its last picker presses *Ready for Pickup*. Browsers only play sound after one tap on the page, so the screen asks for a tap until then (the header button turns the buzzer off/on). No customer name, phone, address or amounts are shown.

**Pairing a screen.** Admin panel → Stores → **Hub screens** → Add screen. This returns a one-time link `<PUBLIC_BASE_URL>/hub-display/#key=<deviceKey>`; open it on the screen (the key is kept in the browser and removed from the address bar). Only the key's SHA-256 hash is stored (`HubDisplay` model). **Revoke** stops the screen immediately, including its live connection. Store managers can manage their own store's screens.

**Delivery Boy flow at the hub**
1. Scan the screen's QR in the Delivery app → `POST /delivery/hub/checkin { code }` (the scanned URL or just its `t` token). The token is random, maps server-side to that screen's store, and is used up by this check-in (the screen shows a new QR at once), so a photo of it stops working. If two riders scan the same QR at once, the second is asked to scan the new one. The call is made with the rider's own access token, so role, approval and hub are all checked on the server. The check-in lasts `HUB_CHECKIN_MINUTES` (30) and marks arrival on the rider's assigned orders there.
2. `GET /delivery/hub/orders` → `mine` (assigned to me / picked up at this hub) and `available` (packed, no rider yet).
3. Pick an order: `POST /delivery/hub/orders/:id/claim` assigns and accepts it in one step (`packed → assigned`). If two riders claim at once, one gets it and the other gets 409. Auto-assigned orders appear in `mine` and don't need claiming.
4. Package scan `POST /delivery/jobs/:id/scan` **or** pickup OTP `POST /delivery/jobs/:id/otp/verify` → `picked_up` (unchanged).
5. `POST /delivery/jobs/:id/out-for-delivery`. The order drops off the hub screen.

Screen API (header `X-Hub-Display-Key`): `GET /hub-display/board`, `GET /hub-display/checkin-qr` (SVG). Env: `PUBLIC_BASE_URL` (set it in production; used in pairing links and the QR), `HUB_CHECKIN_MINUTES`.

## Live Tracking

`src/services/tracking.service.js`. The Delivery app sends its GPS position every few seconds while on a job, either with `POST /delivery/location { lat, lng }` or the `delivery:location` socket event (same handling). The server only uses positions from riders assigned to the order.

- **Live position + ETA.** Each ping is pushed as `delivery:location { orderId, lat, lng, eta }` to the customer and to anyone watching the order, and as `rider:location` to admins (the **Live Map** page). `GET /customer/orders/:id/tracking` returns the hub, drop, rider and ETA; the customer's order page shows them on a map.
- **ETA** is straight-line distance × 1.3 at the average speed setting, plus picking time and handover before pickup. No routing API is used. It is marked `approximate` when a location is missing.
- **Geofences.** Within 100 m of the hub, arrival at pickup is recorded automatically. Within 1 km of the customer, they get an "almost there" alert, once. Within 100 m of the customer, arrival at the drop is recorded. The last two can also trigger IVR calls.
- **Delivery area.** `Store.serviceRadiusKm` (Stores page), or the default radius setting. Checkout rejects an address farther away. `POST /customer/checkout/summary { addressId }` returns `serviceArea`. Addresses and stores without coordinates can't be checked and are allowed. The customer address form has a *Use my current location* button.
- **Route optimisation.** `GET /delivery/route` orders a rider's stops so every hub pickup comes before its drops (nearest-neighbour, then 2-opt). It returns leg distances, arrival times and a Google Maps directions link.
- Settings (Admin > Settings > Tracking & Delivery Area): average speed, picking time, default radius, geofence distances. Map tiles are OpenStreetMap (no key). For heavy production traffic, use a paid tile provider.

## IVR (Exotel)

`src/services/ivr.service.js`. Every call is logged in `IvrCall` (Admin > **Call Logs (IVR)**). With provider **None**, outbound calls are only recorded as `simulated`.

| Feature | Trigger |
|---|---|
| Auto call notifications | Order events chosen in settings (default: out for delivery, delivery failed, rider arrived). One call per order per event. |
| COD order confirmation | COD orders ≥ the configured amount (blank = off). 1 = confirm, 2 = cancel (only while still cancellable). The result shows on Live Orders and the order drawer. |
| Delivery alerts | `rider_nearby` / `rider_arrived` from the tracking geofences. |
| Missed call support | A missed call to your ExoPhone → SMS with the latest order status and, optionally, a call back that reads it out. |
| Customer care IVR | Inbound menu: 1 = latest order status, 2 = connect to support, 3 = request a call back (creates a support ticket). |
| Manual | Order drawer → *Call with status* / *Confirmation call* (`POST /admin/orders/:id/ivr-call`). |

**Setup.**
1. In Admin > Settings, set *Public server URL* (Exotel must reach it), then under IVR choose Exotel and enter the Account SID, API key/token, API host and ExoPhone.
2. The IVR card lists the webhook URLs. They contain a secret token, because Exotel doesn't sign its requests.
3. Build these flows in the Exotel App Bazaar:
   - **Message flow**: Greeting (dynamic URL = *prompt*) → Hangup. Put its App ID in *Message flow App ID*.
   - **Confirmation flow**: Greeting (*prompt*) → Gather (1 digit) → Passthru (*input*) → Greeting (*prompt?stage=result*) → Hangup. Put its App ID in *Confirmation flow App ID*.
   - **Missed-call number**: Passthru (*missed-call*) → Hangup.
   - **Customer care number**: Greeting (*care/prompt*) → Gather → Passthru (*care/input*). On success: Greeting (*care/result*) → Hangup. On failure (302): Connect to your support number.
4. Outbound calls use Exotel `Calls/connect` with `StatusCallback` = the *status* URL. The call's id travels in `CustomField`.

Calls are placed in the background and never block an order action. A failed call is logged with its error.

## Delivery Partner Gigs, Offers & Earnings

These APIs back the delivery app's Feed, Gigs, Offers, Earnings, Session History and Trip History screens. All the endpoints are listed in Swagger under **Delivery - Gigs, Offers & Earnings** and **Admin - Delivery Programs**. Days, weeks (Mon–Sun) and gig hours are in IST (`APP_UTC_OFFSET_MINUTES`, default 330).

- **Login sessions** (`RiderSession`). A session starts when `PATCH /delivery/availability` goes online and ends when it goes offline. They drive:
  - login hours on the Earnings screen
  - Session History (`GET /delivery/sessions`)
  - gig completion
  - offers' compulsory login
- **Gigs** (`GigSlot`, `GigBooking`). Admins create shifts with `POST /admin/gigs/bulk`: each slot on each date, with pay/hour, capacity and minimum login. Partners manage them from the app:
  - list: `GET /delivery/gigs`, grouped Lunch/Evening/…
  - book: `POST /delivery/gigs/book`
  - cancel before start: `POST /delivery/gigs/:id/cancel`
  - live progress: `GET /delivery/gigs/current`
  - history: `GET /delivery/gigs/history`

  When a gig ends it becomes **completed** if the partner was online at least `minLoginMinutes` inside it. Otherwise it's **incomplete**. An incomplete **free** gig is automatically **exempted**, and admins can exempt any gig with `PATCH /admin/gig-bookings/:id/exempt`. Exempted gigs don't count against offers.
- **Offers** (`IncentiveOffer`, `OfferPayout`). Tiers are paid for gigs + orders, or for order earnings. The highest tier reached is paid, not the sum.
  - **"Don't do" conditions:** max order denials, cancellations and incomplete gigs. Handing an order back with `POST /delivery/jobs/:id/reject` counts as a **denial** before accepting it and a **cancellation** after.
  - **Compulsory login windows.**
  - **Progress** is computed live (`GET /delivery/offers`, `/offers/:id`).
  - **Payout:** when an offer ends, a background job (every 5 min, `RIDER_JOBS_DISABLED=true` to switch off) or `POST /admin/offers/:id/settle` pays each partner as an `incentive` wallet credit, once.
- **Earnings.** `GET /delivery/earnings/summary?period=day|week|month` totals the partner's wallet credits by `category`:
  - `order_earning`: per delivered order
  - `incentive`: offer payouts
  - `other_earning`: `POST /admin/delivery-partners/:id/earnings`

  It also returns orders, login hours, earnings/hour and the chart.
- **Trips.** `GET /delivery/trips` returns delivered, failed and returned jobs with earning, cash collected and distance. The distance is hub→drop straight-line × 1.3, stored at delivery.
- **Home map.** `GET /delivery/map?lat=&lng=` tells the app where the rider should head now:
  - **Online, no order:** the hub, with "Reach the store to pick orders", then "Scan QR to get orders" at the hub.
  - **Order to collect:** the pickup.
  - **Order picked up:** the customer's location.
  - **After delivering:** back to the hub.

  Each response carries the destination, Google Maps navigation links (two-wheeler) and the buttons to show. The route and "13 mins | 4.3 km away" come from the Google Routes API when a Google Maps key is set in Settings (enable the *Routes API* on it); otherwise straight-line × 1.3 is used and there's no polyline. Routes are cached for a minute.
- **Feed.** `GET /delivery/dashboard` returns the online state, gig in progress, today's progress, live offers, the store card (`GET /delivery/home-store`, "Reach the store to pick orders") and pending popups ("Failed to transfer amount") in one call.
- **Earnings total** is order earning + incentive + other earnings **minus deductions**.
- **Trip details.** `GET /delivery/trips/:id` returns the pay lines (KM pay, bonuses, waiting / cancellation pay + extra pay an admin tied to the order with `POST /admin/delivery-partners/:id/earnings { orderId }`), customer name, assigned / picked / delivered times and distance.
- **Offer condition sheets.** `GET /delivery/offers/:id/conditions/orderDenials|cancellations|incompleteGigs` lists each denied or cancelled order with the customer's name. A lost offer carries `missed` ("You have missed ₹339 incentive — More than 1 order denial").

### Delivery partner pay: KM earning + incentives (GoGrovio policy)

`src/services/riderPay.service.js`. Every number is in one rate card (`GET/PUT /admin/rider-pay/policy`, Admin > Settings > *Delivery Partner Rate Card*), with the proposed GoGrovio rates as defaults.

    Total = KM base + daily incentive + weekly incentive + peak + rain + heavy load
            + waiting / cancellation pay + eligible minimum-guarantee top-up

- **Trips.** Every order assigned to a partner joins their open **trip** at that hub. The trip stops taking orders once the first one goes out for delivery. It's **paid once all its orders are finished**, but **each order is paid for its own distance** (a MULTI ORDER trip is still one card in Trip History).
- **KM base** by the hub → drop **mapped** distance (Google Routes when a Maps key is set, else straight line × 1.3): 0–1 km ₹12, 1–2 ₹15, 2–3 ₹22, 3–4 ₹30, 4–5 ₹38, 5–6 ₹46, 6–7 ₹54, 7–8 ₹62, 8–9 ₹70, 9–10 ₹78, then +₹8 per started km beyond 10. The order's value never changes it.
- **Per-delivery bonuses:**
  - **Peak:** +₹5 in the peak windows (07–10, 18–22), or +₹10 while the hub is on *high surge*.
  - **Rain:** +₹5 normal / ₹10 heavy / ₹15 severe, by the hub's rain level (`PUT /admin/stores/:id/rider-conditions`). Only switch on severe where riding is safely permitted.
  - **Heavy load:** 10–20 kg +₹5, 20–30 kg +₹10, 30 kg+ +₹15. Uses the order weight from `Product.weightKg` (or the variant's) × qty.
  - **Waiting pay:** per minute beyond the free minutes, at the hub (once per trip) and at the door. **Off until `waiting.perMinute` is set.**
  - **Cancellation pay:** when an order is cancelled (by the customer or care, not handed back) after the partner reached the hub or picked it up. **Off until set.** Failed / returned orders still pay ₹0.
- **Before accepting**, each assigned order carries `riderPayQuote` (mapped km, KM slab and pay, bonuses, estimated total). Final pay is never below the quote, even if the rain stops or the rates change. **After delivery**, `riderPay` on the order and `GET /delivery/trips/:id` show the actual breakdown.
- **Daily slab / tier:** 5 deliveries ₹20, 10 ₹50 (Bronze), 15 ₹100 (Silver), 20 ₹175 (Gold), 25 ₹275 (Platinum), 30 ₹400 / 35 ₹550 / 40 ₹700 (Diamond). The tiers are the daily slabs' names; they're not paid twice.
- **Weekly slab** (Mon–Sun): 60 ₹150, 90 ₹300, 120 ₹500, 150 ₹750, 180 ₹1,000, 210+ ₹1,300.
- **Minimum guarantee** (**off by default**; `guarantee.enabled`): ₹300/day when online ≥ 8h (optionally with a completed gig), ≥ 8 deliveries and eligible. It pays the top-up to the guarantee when the calculated day earning is lower.
- **Eligibility** for the daily / weekly / guarantee payouts:
  - Every delivery is proven by the customer's PIN.
  - The cancellation rate (hand-backs after accepting ÷ (delivered + those)) must be ≤ 10%, checked from 5 orders.
  - Not withheld by an admin. GPS or payment manipulation and verified complaints aren't detected automatically: admins withhold the day / week (`POST /admin/delivery-partners/:id/pay-periods/:kind/:key/withhold`) and later `/release` it.
- **Settlement:** days and weeks are settled `settleDelayHours` (12h) after they end by the rider jobs loop (or `POST /admin/rider-pay/settle`), as a `RiderPayPeriod`. Each one holds its figures, eligibility, payout status and audit log.
- **Pocket lines:** Trip Earning (KM); Peak / Rain incentive, Heavy load bonus, Daily incentive · Gold, Weekly incentive (incentive); Waiting / Cancellation pay, Minimum guarantee top-up (other earning).
- **Partner app:** `GET /delivery/earnings/incentives` shows the day's slab, tier and deliveries to the next slab, the week's progress, the guarantee and the rate card.
- **Admin:** `GET /admin/rider-pay/preview?km=&kg=&time=&storeId=` previews one order's pay. `GET /admin/delivery-partners/:id/pay-periods` shows a partner's periods. `PUT /admin/delivery-partners/:id/pay` sets a partner's own rate card sections.
- **Launch testing:** run the rate card for 2–4 weeks, then tune it against real order density, route distance, active hours and the contribution report (`GET /admin/reports/order-contribution`).

### Account on hold, cold bags, UPI at the door

- **Account on hold** (`services/accountHold.service.js`). The system or an admin (`POST /admin/delivery-partners/:id/hold`) puts the account on hold.
  - **While on hold** the partner is offline and gets `423` on going online, hub check-in and claiming orders.
  - **Release:** it lifts itself at `releaseAt`, or an admin unlocks it with `/unhold`. The app reads `GET /delivery/account-status`.
  - **Selfie checks:** the partner uploads `POST /delivery/selfie-checks`, an admin reviews them with `PATCH /admin/selfie-checks/:id`, and a mismatch holds the account "Face not matching" for `riderFaceMismatchHoldHours` (24). Automatic face matching needs a face-recognition provider, which isn't connected.
- **Cold bags** (`services/coldBag.service.js`). A product marked *Frozen — needs a cold bag* makes its orders `needsColdBag`.
  - **Pickup:** the handover OTP / QR is refused until the partner scans a bag of that store (`POST /delivery/jobs/:id/cold-bag`).
  - **Return:** after delivering they scan it back in at a store (`POST /delivery/cold-bags/return`).
  - **Admin:** creates bags with printable QR labels (`POST /admin/cold-bags`), sees overdue ones (`coldBagReturnHours`, default 4), and can mark a bag lost with a deduction.
- **UPI at the door** (`services/collect.service.js`). For COD, `GET /delivery/jobs/:id/collect` returns a "Collect ₹X via UPI" QR, and the payment goes straight to the company.
  - **Razorpay single-use UPI QR:** payment is verified, and completing with `collectionMethod=upi` requires it paid. Your Razorpay account needs the QR Codes feature enabled.
  - **Fallback:** a UPI QR to `upiVpa`, which can't be verified.

### Picker product-based pay (GoGrovio policy)

`src/services/pickerPay.service.js`. All the numbers are in one policy (`GET/PUT /admin/picker-pay/policy`), with the proposed GoGrovio rates as defaults.

- **Per order**, when a picker presses *Ready for pickup*, they're paid for their portion. It's credited as "Picking pay".
  - **Item pay** by product type: normal ₹0.60, small ₹0.50, fruits & veg ₹0.80, dairy ₹0.80, frozen ₹1, fragile ₹1, heavy 5–10 kg ₹1.50, heavy 10 kg+ ₹2, special ₹2.
  - **Peak:** +₹0.50/item in peak windows.
  - **Order bonus** by item count: ₹1–₹7.
  - **Speed bonus** against the target time (base + seconds per item, measured from *Start*): ₹1 within target, ₹2 at 10% faster, ₹3 at 20% faster.
  - **Packing:** ₹1 normal, ₹2 fragile, ₹3 large, ₹5 special.
  - **Not paid:** stock-outs.
- **Product type:** set `pickType` on the product (plus `costPrice` for the report). Otherwise it's worked out from the category (fruits/vegetables, dairy) or the cold bag flag (frozen), else normal.
- **Per day**, settled once the day is over plus `settleDelayHours` (12h, time for error reports):
  - **Productivity bonus:** 50 items ₹10 … 600+ ₹500.
  - **Quality bonus:** 97% ₹20, 99% ₹40, 99.5% ₹60 accuracy, from 50 items.
  - **Sunday/holiday:** ₹100/day or ₹0.50/item, not both.
  - **Minimum guarantee:** ₹300 in the first 7 days (training), ₹350 after. It applies when the picker was online ≥ 8h, reached the item minimum and ≥ 97% accuracy, and isn't blocked. The higher of calculated and guarantee is paid.
- **Per week:** ₹150 attendance bonus for 6 days with ≥ 4h online (Mon–Sun).
- **Login hours:** pickers' online/offline toggle now records sessions, used for shift, attendance and the guarantee.
- **Errors:**
  - **Report:** `POST /admin/picker-errors`.
  - **Confirm or waive:** `PATCH /admin/picker-errors/:id`. Confirming deducts the fine (wrong/missing ₹10, wrong quantity ₹5–10, damaged ₹10–30) and takes back that order's speed bonus. No blanket deductions.
- **Rates per person:** these defaults are only a starting point, and everyone can be paid differently. The picker policy layers default → store (`PUT /admin/stores/:id/picker-pay-policy`) → picker (`PUT /admin/pickers/:id/pay-policy`). Each level holds only what it changes, and every payment records which level's rates were used. Delivery partners can have their own rate card sections the same way (`PUT /admin/delivery-partners/:id/pay`).
- **Picker app:** `/picker/earnings/today|orders|summary`, `/picker/errors`, `/picker/pocket`.
- **Company contribution per order:** `GET /admin/reports/order-contribution`, with assumptions in `/admin/order-economics`.

### Notices (Updates tab)

`src/services/announcement.service.js`. These are company notices to delivery partners, pickers or customers ("महत्वपूर्ण सूचना").

- **Admins** write them with `POST /admin/announcements`. The body is plain text: `**bold**`, `* ` / `• ` bullets, and a line that's all bold becomes a heading.
- **Who sees a notice:** it targets roles, stores or specific people. It can be pinned, and scheduled with `publishAt` / `expiresAt`.
- **Confirming:** a notice can require an "Okay, I understand" confirmation.
- **Publishing** pushes a notification to its audience. For a scheduled notice, the background job sends it when the time comes.
- **Apps** read `GET /common/announcements` (list), `/unread-count` (badge, also in the delivery dashboard) and `/:id` (details, with `blocks` ready to render, marks it read), and confirm with `POST /common/announcements/:id/ack`.
- **Stats:** `GET /admin/announcements/:id/stats` shows who hasn't read or confirmed.
- **Samples:** `npm run seed:announcements` adds four sample notices (EPH, COD process, fast delivery, MDND).

### Pocket, payouts and deposits

`src/services/pocket.service.js`. The pocket is the partner's wallet used as a running account, and **it can go negative**.

| Entry | Sign | From |
|---|---|---|
| Trip Earning, Incentive, Other earning | + | delivery, offer payout, admin |
| Cash collected | − | a COD order paid in cash (the partner now holds the platform's cash) |
| Cash Deposit | + | Razorpay (`POST /delivery/pocket/deposit` + `/verify`) or at the hub (`POST /admin/delivery-partners/:id/cash-deposits`) |
| Pocket Withdrawal | − | `POST /delivery/pocket/withdraw` (min `riderMinWithdrawal`, default ₹100; one at a time) |
| Weekly payout | − | every Monday from `riderWeeklyPayoutHour` (default 7), for approved partners with bank details and a positive balance, once a week (`riderWeeklyPayoutEnabled=false` to stop; `POST /admin/pocket-transfers/weekly-payouts` to run now) |
| Deduction | − | `POST /admin/delivery-partners/:id/deductions` ("Temp Manual Pay — Cold Bag Fraud 27th Jan") |

- **Statements.** `GET /delivery/pocket/statement?week=this|last|YYYY-MM-DD&filter=` and `GET /delivery/pocket/deductions?week=`.
- **Bank transfers are processed by an admin.** No payout provider is connected yet, so an admin moves each withdrawal or payout with `PATCH /admin/pocket-transfers/:id` through `in_process` → `completed` (with the IMPS/UTR reference) or `failed`.
  - **Failed:** the amount goes back into the pocket and the partner gets the popup.
  - **Rider view:** `GET /delivery/pocket/transfers/:id` shows the Initiated / In Process / Completed timeline and the masked bank account.

### Support tickets

`controllers/common/support.controller.js`. Tickets are conversations and work for every app.

- **Create:** pick an issue from `GET /common/support/categories` (e.g. *Past order related issues → Long Distance Return Pay*), optionally for an `orderId`, `transferId` or `offerId`.
- **Converse:** reply with `POST /common/support/:id/messages`. Support answers with the existing `PATCH /admin/support-tickets/:id { adminReply, status }`.
- **After closing:** the user can rate (`/rate`, up/down) or reopen (`/reopen`).

## Masked Calls (in-app VoIP, Twilio)

`src/services/voip.service.js`. The customer and their delivery partner call each other app to app over Twilio Voice, instead of from the phone's dialler. **Neither side ever receives the other's phone number.** The apps only know an opaque Twilio identity (`u_<userId>`). The callee sees the caller's first name, their role and the order number. Every call is logged in `VoipCall` (Admin > **Masked Calls**). With provider **None**, calls are only recorded as `simulated`.

- **Who can call.** Only the order's customer and its assigned rider, and only while the order is `assigned`, `picked_up` or `out_for_delivery`. This is checked when the call is started and again when Twilio connects it, so a reassigned or delivered order can't be called.
- **No numbers in the API.** `GET /customer/orders/:id/tracking` returns the rider's name only, and `GET /delivery/jobs` returns the customer's name only.

**Flow.**
1. The app gets a token from `GET /voip/token?platform=web|android|ios` and registers a Twilio Voice SDK `Device`. It refreshes the token on `tokenWillExpire`.
2. The caller taps Call. The customer app calls `POST /customer/orders/:id/call` and the rider app calls `POST /delivery/jobs/:id/call`. Either returns `{ callId, callee, params }`.
3. Within 2 minutes the app runs `device.connect({ params })`. Twilio asks `/voip/twilio/voice` for TwiML, and we answer with `<Dial><Client>` to the other party.
4. The callee's `incoming` call carries `customParameters`: `callId`, `orderNumber`, `callerRole` and `callerName`.

**Setup.**
1. In the Twilio Console, create an **API key** (Standard) and a **TwiML App**:
   - Voice Request URL: `POST {public URL}/api/v1/voip/twilio/voice`
   - Status Callback URL: `{public URL}/api/v1/voip/twilio/status`
2. Admin > Settings > **In-app Calls**: choose Twilio and enter the Account SID, Auth Token (used to verify webhook signatures), API key SID/secret and TwiML App SID. *Public server URL* must be set, because signatures are checked against it.
3. **Mobile apps** (Twilio Voice Android/iOS SDK): create FCM/APNs **push credentials** in Twilio and enter their SIDs, so incoming calls ring while the app is in the background. On iOS, report calls through CallKit.

The customer website (`customer-web`) registers the Device while it's open, shows the Call button on the tracking card and an incoming-call panel.

## Payment Gateways (Razorpay, PhonePe, PayU)

Checkout offers COD, Wallet, Razorpay, PhonePe and PayU. Each can be switched on or off in Admin > Settings > Checkout Payment Options, and PhonePe/PayU only appear once their keys are set. `POST /customer/checkout/summary` returns `paymentOptions`, and `POST /customer/orders` rejects a method that is switched off. An unpaid online order can't be accepted on Live Orders.

- **PhonePe** (PG Standard Checkout v2, OAuth client credentials): place the order with `paymentMethod: 'PHONEPE'`, then call `POST /payments/phonepe/create`. It returns `redirectUrl`; the customer pays on PhonePe and comes back to `<customerWebUrl>/payment/return`. That page calls `POST /payments/phonepe/verify`, which asks PhonePe for the status (the redirect alone is not trusted). The webhook `POST /payments/phonepe/webhook` checks `Authorization` = SHA256(username:password).
- **PayU**: `POST /payments/payu/create` returns the form fields with the request hash. The browser posts them to PayU. PayU posts the result to `/payments/payu/callback`, where the reverse hash and amount are checked, and the customer is redirected to `/payment/return`. `/payments/payu/webhook` handles the server-to-server copy.
- A paid/failed result from any source (redirect, webhook, status check) is applied once. An amount mismatch is marked failed. Refunds on cancellation or return go to the Grovio wallet, the same as Razorpay.
- Settings: *Customer website URL* (return page) and *Public server URL* (PayU callback), plus keys. Sandbox/test modes are the default.

## Endpoint Reference (all under `/api/v1`)

### /auth
| Method | Path | Who |
|---|---|---|
| POST | /auth/register-vendor | Public |
| POST | /auth/login | Public |
| POST | /auth/send-otp, /auth/resend-otp | Public |
| POST | /auth/verify-otp | Public |
| POST | /auth/picker/send-otp, /auth/picker/resend-otp | Public (Picker app) |
| POST | /auth/picker/verify-otp | Public (Picker app) |
| GET | /auth/picker/me | picker |
| POST | /auth/picker/register | picker |
| POST | /auth/picker/logout, /auth/picker/logout-all | picker |
| POST | /auth/refresh | Public (valid refresh token) |
| POST | /auth/google, /auth/apple | Public (returns 501 — not configured) |
| GET/PUT | /me (also /auth/me) | Any authenticated user |
| POST | /auth/logout, /auth/logout-all | Any authenticated user |

### /admin (permission-gated; see RBAC section)
- `GET /admin/dashboard` — GMV, AOV, orders, cancellations, active stores/pickers/delivery partners
- `GET /admin/vendors|customers|pickers|delivery-partners`, `GET /admin/users/:id`
- `PATCH /admin/vendors/:id/status`, `/admin/pickers/:id/status`, `/admin/delivery-partners/:id/status` — `{ status }`
- `PATCH /admin/pickers/:id/assign-store` — `{ storeId }`
- `PATCH /admin/users/:id/active` — `{ isActive }`
- `GET /admin/stores`, `GET /admin/stores/:id`, `PATCH /admin/stores/:id` — zones/timings/status
- `GET/POST /admin/stores/:id/hub-displays` — list / add a hub screen (`{ name }` → `{ display, pairingUrl }`), `DELETE /admin/hub-displays/:id` — revoke
- `POST/GET/PATCH/DELETE /admin/categories`
- `GET /admin/products`, `POST /admin/products`, `PATCH /admin/products/:id` (full edit), `PATCH /admin/products/:id/status` (quick toggle), `DELETE /admin/products/:id` — admin can create/edit/delete a product under **any** store (support/onboarding use case; vendors otherwise manage their own via `/vendor/products`)
- `GET /admin/orders`, `GET /admin/orders/:id`, `PATCH /admin/orders/:id/assign-picker|assign-delivery`
- `GET /admin/tracking/riders` (live map), `GET /admin/orders/:id/tracking`, `POST /admin/orders/:id/ivr-call`, `GET /admin/ivr/calls`, `GET /admin/ivr/config`, `GET /admin/voip/calls`, `GET /admin/voip/config`
- `POST /admin/orders/:id/refund` — `{ amount, reason }` (manual/partial refund to customer wallet)
- `POST/GET/PATCH/DELETE /admin/coupons`
- `POST/GET/PATCH/DELETE /admin/banners`
- `GET/PUT /admin/settings`
- `GET /admin/reports/sales|vendor-commission|products|customers|delivery-partners`
- `GET /admin/support-tickets`, `PATCH /admin/support-tickets/:id`
- `GET /admin/inventory` — `?storeId=&lowStock=true&threshold=5`
- `GET /admin/payments` — `?status=&method=`
- `GET /admin/payments/cod-reconciliation` — `?from=&to=`
- `GET /admin/refunds`
- `POST /admin/settlements/generate` — `{ vendorId, from, to }`
- `GET /admin/settlements`, `PATCH /admin/settlements/:id/pay`
- `POST /admin/admins`, `GET /admin/admins`, `PATCH /admin/admins/:id/permissions`
- `GET /admin/activity-logs`

### /vendor (vendor role)
- `GET /vendor/dashboard` — KPIs across all of this vendor's stores
- `GET/PUT /vendor/business` — Vendor business profile (name, documents)
- `POST/GET /vendor/stores`, `GET/PUT /vendor/stores/:id`, `PATCH /vendor/stores/:id/status` — `{ isOpen }`
- `GET /vendor/earnings`
- `POST/GET /vendor/products` (create needs `storeId`), `PATCH /vendor/products/:id`, `PATCH /vendor/products/:id/stock`, `PATCH /vendor/products/:id/price`, `DELETE /vendor/products/:id`
- `POST /vendor/products/:id/variants`, `PATCH/DELETE .../variants/:variantId`
- `GET /vendor/orders`, `GET /vendor/orders/:id`, `PATCH /vendor/orders/:id/accept|reject`
- `GET /vendor/reviews`
- `POST/GET/PATCH/DELETE /vendor/offers` (vendor-scoped coupons, valid across all of that vendor's stores)
- `GET /vendor/reports/sales` — `?from=&to=&storeId=`
- `GET /vendor/settlements` — read-only payout history

### /customer (customer role)
- `GET /customer/home` — banners + categories + featured products + platform offers in one call
- `GET /customer/categories`
- `GET /customer/stores` — `?lat=&lng=&radiusKm=&search=` (distance-sorted when lat/lng given), `GET /customer/stores/:id`
- `GET /customer/products`, `GET /customer/products/:id`
- `GET/POST /customer/cart`, `PATCH/DELETE /customer/cart/items/:id`, `DELETE /customer/cart`
- `POST /customer/cart/apply-coupon`, `DELETE /customer/cart/coupon`
- `GET/POST/PUT/DELETE /customer/addresses`
- `POST /customer/checkout/summary` — recalculates totals server-side without placing the order
- `POST /customer/orders`, `GET /customer/orders`, `GET /customer/orders/:id`
- `GET /customer/orders/:id/tracking` — lightweight status timeline
- `GET /customer/orders/:id/delivery-pin` — share with the delivery partner to confirm delivery
- `POST /customer/orders/:id/cancel`
- `POST /customer/orders/:orderId/rating` — `{ rating, comment, productId, deliveryPartnerRating }`
- `GET /customer/wallet`, `GET /customer/wallet/transactions`
- `GET /customer/coupons` — `?storeId=`
- `POST /customer/support/tickets`

### /picker (picker role)
- `GET /picker/profile`, `PATCH /picker/kyc-upload` (multipart KYC upload), `PATCH /picker/availability`
- `GET /picker/jobs`, `GET /picker/jobs/:id`
- `POST /picker/jobs/:id/start`
- `PATCH /picker/jobs/:id/items/:itemId` — `{ pickedQty, isAvailable, substituteProductId, substituteNote }`
- `POST /picker/jobs/:id/substitutions` — `{ itemId, substituteProductId, substituteNote }`
- `POST /picker/jobs/:id/complete` (packs the order, best-effort auto-assigns delivery)
- `POST /picker/jobs/:id/handover` — confirms physical hand-off to the delivery partner
- `GET /picker/history`, `GET /picker/performance`

### /delivery (delivery role)
- `PATCH /delivery/availability`, `POST /delivery/location` (drives live tracking, ETA and geofences), `GET /delivery/route` (optimised stops), `GET/PATCH /delivery/profile`
- `GET /delivery/jobs`, `GET /delivery/jobs/:id`
- `POST /delivery/jobs/:id/accept|reject`
- `POST /delivery/jobs/:id/arrived-pickup`, `POST /delivery/jobs/:id/picked-up` (→ out_for_delivery)
- `POST /delivery/jobs/:id/arrived-drop`
- `POST /delivery/jobs/:id/complete` — `{ pin }` (must match the customer's delivery PIN)
- `POST /delivery/jobs/:id/failed` — `{ reason }`
- `POST /delivery/hub/checkin` — `{ code }` from the hub screen QR; `GET /delivery/hub/orders`; `POST /delivery/hub/orders/:id/claim`; `POST /delivery/hub/checkout`
- `GET /delivery/history`, `GET /delivery/earnings`

### /common (any authenticated user, banners are public)
- `GET /common/banners`
- `POST /common/upload`, `POST /common/fcm-token`
- `GET /common/notifications`, `PATCH /common/notifications/:id/read`, `PATCH /common/notifications/read-all`
- `POST /common/support`, `GET /common/support`

### /payments
- `POST /payments/razorpay/create` — `{ orderId }` (customer)
- `POST /payments/razorpay/verify` — `{ orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }` (customer)
- `POST /payments/razorpay/webhook` — Razorpay server-to-server callback

## Fraud-prevention & Payout Flow

- **Delivery PIN**: as soon as a delivery partner is assigned, a 4-digit PIN is generated (`Order.deliveryPin`, hidden via `select: false` **and** a schema-level `toJSON`/`toObject` transform, since `select: false` alone doesn't hide a value set on an in-memory document) and sent to the customer via notification. `POST /delivery/jobs/:id/complete` requires the correct PIN.
- **Substitutions**: `POST /picker/jobs/:id/substitutions` (or the generic item-update route) records a proposed swap; the customer is notified and can see it on the order.
- **Handover confirmation**: `POST /picker/jobs/:id/handover` is a picker-side confirmation that the package physically left the store, independent of the delivery partner's own pickup confirmation.
- **Vendor payouts**: when an order is marked `delivered`, the vendor's wallet is credited with `itemTotal - commission`. Admin calls `POST /admin/settlements/generate` to bundle a vendor's unsettled delivered orders into a `Settlement`, then `PATCH /admin/settlements/:id/pay` once the bank transfer is done — this debits the vendor's wallet by the payout amount.
- **Refunds**: customer self-cancel refunds (to wallet) and admin-issued manual refunds (`POST /admin/orders/:id/refund`) both create a `Refund` record for audit/reporting.

## Data Model Notes (MongoDB)

- All relations use Mongoose `ObjectId` refs + `.populate()`.
- **Vendor** (business) and **Store** (physical outlet) are separate collections — one vendor, many stores. `Order.vendor` is denormalized from `store.vendor` at order-creation time so financial records stay stable even if a store is later reassigned.
- An order's line items (`items`) and status timeline (`statusLogs`) are embedded arrays on the `Order` document rather than separate collections.
- The customer's cart is a single `Cart` document per user (embedded `items[]` + `couponCode`), not one row per item — this is what makes `/cart/apply-coupon` and `/cart/coupon` clean to implement.
- Order placement writes sequentially rather than in a DB transaction, since a standalone (non-replica-set) MongoDB instance doesn't support multi-document transactions.
- Stock is decremented directly at order placement (no separate "reserved vs. available" split) — simpler, and equivalent in effect for this scale.
- Refresh tokens are stored **hashed** (`RefreshToken.tokenHash`), never in plaintext.

## Order Lifecycle

`placed → accepted/rejected → picking → packed → assigned → out_for_delivery → delivered`
Side branches: `out_for_delivery → delivery_failed → (out_for_delivery | returned | cancelled)`, and `cancelled`/`returned` from most earlier states. Every transition is logged (pushed into `Order.statusLogs`) and pushed over Socket.IO.

**Accepting orders.** A new order waits at `placed` until someone accepts it on the admin panel's **Live Orders** board (`PATCH /admin/orders/:id/accept`), which then splits it to pickers. The board updates live over Socket.IO, plays a chime, and flags orders that have waited over 3 or 8 minutes.
- Online (Razorpay) orders can't be accepted until they're paid.
- Rejecting a paid order (`PATCH /admin/orders/:id/reject`) refunds it to the customer's wallet.
- Turning on **auto-accept** (`PUT /admin/order-settings { autoAcceptOrders: true }`, the switch on the board) accepts orders the moment they're placed instead.

**Charges.** Delivery, handling, packing and a surcharge are set on the admin **Charges** page (`GET/PUT /admin/charges`, stored as the `orderCharges` setting; see `src/services/charges.service.js`).
- They're applied **once per order**. Each is a fixed ₹ amount or a % of the item total, with an on/off toggle.
- Delivery can be free above an item total. The surcharge carries a customer-facing label (e.g. "Rain surcharge").
- Each order snapshots its charges (`deliveryFee`, `handlingCharge`, `packingCharge`, `surcharge`, `surchargeLabel`) plus `deliveryPartnerEarning`, the delivery charge before any free-delivery waiver. That is what the rider is paid, so free-delivery orders still pay the rider.
- `POST /customer/checkout/summary` returns every charge plus `freeDeliveryAbove` / `freeDeliveryApplied`.

## Notes / Next Steps

- OTP delivery is stubbed (`src/services/otp.service.js`) — plug in MSG91/Twilio for production.
- Push notifications (FCM) are stored in-app and the socket layer notifies connected clients; wire `notification.service.js` to actually send FCM pushes. Multi-device tokens can be tracked via the `UserDevice` collection (model exists; wire up `/common/fcm-token` to write to it per-device once the client sends a `deviceId`).
- Razorpay needs real test/live keys in `.env` to work end-to-end.
- Google/Apple login need OAuth credentials before `/auth/google` and `/auth/apple` can do real token verification.
- Redis/BullMQ background jobs and an event-driven architecture were deliberately skipped for now (no Redis running in this environment) — the service-function-call approach is sufficient at this scale. Revisit if/when you need async job processing (e.g. bulk notification fan-out, scheduled settlement generation).
