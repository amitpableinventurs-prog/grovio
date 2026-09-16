# Grovio

Multi-vendor grocery/quick-commerce platform — Admin, Vendor, Customer, Picker, and Delivery.

## Structure

- **`backend/`** — Node.js + Express + MongoDB REST API serving all 5 roles. See `backend/README.md` for setup, the full endpoint reference, auth flows, and how to run Swagger docs / share a Postman collection.
- **`admin-panel/`** — React + TypeScript + Ant Design web app for Admin/Staff-Admin users, consuming the backend's `/api/v1/admin/*` endpoints. See `admin-panel/README.md` for setup.

Vendor, Customer, Picker, and Delivery apps are built separately (Flutter) against the same backend.

## Quick Start

```bash
# 1. Backend
cd backend
cp .env.example .env   # fill in Mongo URI, JWT secret, etc.
npm install
npm run seed            # creates the default super-admin
npm run dev              # http://localhost:5000, docs at /api-docs

# 2. Admin panel (in a second terminal)
cd admin-panel
cp .env.example .env
npm install
npm run dev              # http://localhost:5173
```

Default admin login (from `backend/.env.example`): `admin@grovio.com` / `Admin@12345`.
