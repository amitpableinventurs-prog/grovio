# Grovio Admin Panel

React + TypeScript + Vite + Ant Design web app for Grovio's admin/super-admin users. Consumes the `backend` project's `/api/v1/admin/*` and `/api/v1/auth/*` endpoints.

## Setup

1. Make sure the backend is running (see `../backend/README.md`) and seeded (`npm run seed` in `backend/`).
2. Copy `.env.example` to `.env` — `VITE_API_BASE_URL` should point at the backend (default `http://localhost:5000/api/v1`).
3. Install dependencies:
   ```
   npm install
   ```
4. Run the dev server:
   ```
   npm run dev
   ```
   Opens on `http://localhost:5173`.

Log in with the backend's seeded super-admin: `admin@grovio.com` / `Admin@12345`.

## Architecture

- **api/** — one file per backend resource, thin wrappers around a shared Axios instance (`api/client.ts`) that attaches the access token and transparently refreshes it on a 401 (rotates the refresh token, matching the backend's rotation behavior).
- **store/authStore.ts** — Zustand store for the session (access/refresh tokens + user), persisted to `localStorage`.
- **routes/ProtectedRoute.tsx** — redirects to `/login` if not authenticated or not an admin; renders a 403 page if the user lacks a required permission.
- **layouts/AdminLayout.tsx** — sidebar + header shell. The sidebar's nav items are filtered by the logged-in admin's `permissions` (mirrors the backend's RBAC keys in `utils/permissions.ts`) — a staff admin only sees the sections they're allowed to manage, and hitting a disallowed route directly renders a 403 rather than the page.
- **pages/** — one page per admin module (Dashboard, Vendors, Stores, Customers, Pickers, Delivery Partners, Categories, Products, Orders, Inventory, Coupons, Banners, Payments & Refunds, Settlements, Reports, Support Tickets, Settings, Admins & Roles, Activity Logs), each using TanStack Query for data fetching/caching and Ant Design's `Table`/`Form`/`Modal`/`Drawer` for the actual CRUD UI.

## Verified

Logged in as both the seeded super-admin and a limited staff-admin (created via the Admins & Roles page) and drove the app with a headless browser: dashboard stats render correctly, table pages (Vendors, Coupons, Orders) load real data with no console errors, and RBAC works both ways — the sidebar hides sections the staff admin isn't permitted to see, and navigating directly to a disallowed URL renders a 403 instead of the page.

## Notes / Next Steps

- Google/Apple login aren't wired up on the backend yet (`501`) — no UI needed for them until they are.
- The production bundle is a single ~1.5MB chunk (Ant Design + all pages). Fine for an internal admin tool; if it matters later, route-level `React.lazy()` code-splitting per page would be the next step.
- Vendor "Store" creation/multi-store management is admin-side read/edit only here (zones, timings, status) — vendors manage their own stores from their own panel (out of scope for this admin app).
