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
- **Customer / Picker / Delivery**: `POST /api/v1/auth/send-otp` / `resend-otp` → `POST /api/v1/auth/verify-otp`. Send `{ mobile }`, the 10-digit number only (e.g. `"9876543210"`). `+91` is assumed; `countryCode` is optional and only needed for a non-Indian number. A combined `phone` field is not accepted. `verify-otp` takes `otp` (an alias `code` also works) and an optional `role` (defaults to `customer` — the Customer app never sends it; Picker/Delivery pass their own role explicitly on first signup only). The response's **`isNewUser`** flag is the single source of truth for whether the client should show a "create your profile" screen before Home. In dev, the OTP is logged to the console and returned in the response as `debugOtp` (`OTP_DEBUG_MODE=true`); set `OTP_FIXED_CODE` (e.g. `1234`) to always issue that exact code instead of a random one.
  - **Resend cooldown**: server-enforced, not just a UI timer — repeat `send-otp`/`resend-otp` calls within `OTP_RESEND_COOLDOWN_SECONDS` (default 30) get `429` with `{ retryAfter }`.
  - **Picker app** uses the dedicated `POST /auth/picker/send-otp` / `resend-otp` / `verify-otp` with the same `{ mobile }` body (no `role`). Before an OTP is sent or consumed, they reject a number registered under another role (409) and a disabled picker (403). On first signup they create a `pending` PickerProfile. They return `pickerProfile` plus `onboarding: { status, profileComplete, kycComplete, nextStep }`, where `nextStep` is `profile` (POST /auth/picker/register) → `kyc` (PATCH /picker/kyc-upload) → `pending_approval` → `home` (or `blocked`). `GET /auth/picker/me` returns the same for splash-screen routing. The Register screen submits `POST /auth/picker/register { name, email, gender, dateOfBirth: "DD/MM/YYYY" }`. The mobile number isn't in the body; it's the OTP-verified `user.phone`. The picker must be 18+, a duplicate email returns 409, and field errors come back as `422 errors: [{ field, message }]`. Sign out with `POST /auth/picker/logout { refreshToken }` (this device) or `POST /auth/picker/logout-all`. Both revoke the refresh token(s), set the picker offline and unavailable so no new pick jobs are assigned, and clear the push token.
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
- `POST/GET/PATCH/DELETE /admin/categories`
- `GET /admin/products`, `POST /admin/products`, `PATCH /admin/products/:id` (full edit), `PATCH /admin/products/:id/status` (quick toggle), `DELETE /admin/products/:id` — admin can create/edit/delete a product under **any** store (support/onboarding use case; vendors otherwise manage their own via `/vendor/products`)
- `GET /admin/orders`, `GET /admin/orders/:id`, `PATCH /admin/orders/:id/assign-picker|assign-delivery`
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
- `PATCH /delivery/availability`, `POST /delivery/location`, `GET/PATCH /delivery/profile`
- `GET /delivery/jobs`, `GET /delivery/jobs/:id`
- `POST /delivery/jobs/:id/accept|reject`
- `POST /delivery/jobs/:id/arrived-pickup`, `POST /delivery/jobs/:id/picked-up` (→ out_for_delivery)
- `POST /delivery/jobs/:id/arrived-drop`
- `POST /delivery/jobs/:id/complete` — `{ pin }` (must match the customer's delivery PIN)
- `POST /delivery/jobs/:id/failed` — `{ reason }`
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

## Notes / Next Steps

- OTP delivery is stubbed (`src/services/otp.service.js`) — plug in MSG91/Twilio for production.
- Push notifications (FCM) are stored in-app and the socket layer notifies connected clients; wire `notification.service.js` to actually send FCM pushes. Multi-device tokens can be tracked via the `UserDevice` collection (model exists; wire up `/common/fcm-token` to write to it per-device once the client sends a `deviceId`).
- Razorpay needs real test/live keys in `.env` to work end-to-end.
- Google/Apple login need OAuth credentials before `/auth/google` and `/auth/apple` can do real token verification.
- Redis/BullMQ background jobs and an event-driven architecture were deliberately skipped for now (no Redis running in this environment) — the service-function-call approach is sufficient at this scale. Revisit if/when you need async job processing (e.g. bulk notification fan-out, scheduled settlement generation).
