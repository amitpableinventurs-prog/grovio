# Grovio Vendor Panel

A React, TypeScript, Vite and Ant Design web app for vendors, meaning the store managers who run one Grovio store. It uses the backend's `/api/v1/vendor/*` endpoints. Everything a vendor sees and changes is limited to their own store.

## Setup

1. Start the backend (see `../backend/README.md`).
2. Copy `.env.example` to `.env`. `VITE_API_BASE_URL` should point at the backend (default `http://localhost:5000/api/v1`).
3. Install dependencies and start the dev server:
   ```
   npm install
   npm run dev
   ```
   The app opens on `http://localhost:5190`. The admin panel uses 5173 and the customer web app uses 5174.

New vendors register at `http://localhost:5000/vendor-signup/`, which is also linked from the login page. Then they log in here with that email and password. A new store starts **inactive**, hidden from customers, until a Grovio admin activates it. The panel shows a banner until then. Admin accounts can't log in here. They use the admin panel.

## Screens

- **Dashboard**: revenue, orders, top products and stock alerts for the store.
- **Orders**: orders the store is the hub of or supplies items to, updated live over Socket.IO. A vendor can cancel an order or mark a failed delivery as returned. Picker/delivery assignment and refunds stay with the admin.
- **Products**: add, edit, activate/deactivate and delete the store's products. Categories come from the admin.
- **Inventory**: stock levels and low-stock filter, plus CSV export/import.
- **My Store**: store details, read-only because the admin manages them, and the Hub Center screens paired with the store.

## Structure

The app has the same structure as `admin-panel/`. `api/` holds one thin file per backend resource around `api/client.ts`, which attaches the token and refreshes it on a 401. `store/authStore.ts` keeps the session and the vendor's store in `localStorage`. `layouts/VendorLayout.tsx` is the sidebar shell, and `pages/` has one file per screen.
