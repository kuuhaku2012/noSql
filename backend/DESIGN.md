# Maison Belle Backend Design

## Scope

This design implements the backend for the existing Maison Belle static storefront. It is based on `Nhom7_HoanThien.docx` and `Diagram (1).pdf`, which describe ten business workflows, thirty logical entities, MongoDB-oriented modeling, and four user groups. The backend is limited to the `backend/` directory plus the root `API_CONTRACT.md`; existing HTML, CSS, and JavaScript files remain unchanged.

The source diagram is treated as a logical model, not as a SQL schema. MongoDB collections use references for independently managed or unbounded data and embedded snapshots for data that must be read with its parent or preserve transaction history.

## Goals and non-goals

Goals:

- Serve the existing static frontend from the same Express origin as `/api`.
- Support the ten workflows: product search and consultation, cart and orders, payment and invoice simulation, customer membership, vouchers and promotions, inventory and receipts, returns, delivery, product management, and reports.
- Enforce input validation, role-based access, consistent error responses, stock safety, voucher rules, and audit history.
- Provide demo seed data, index creation, an environment example, a contract, and runnable tests.

Non-goals:

- No real payment gateway, bank integration, tax accounting, or carrier API.
- No changes to frontend source files.
- No seed or test command targets a production database by default.

## Runtime architecture

- Node.js LTS with Express.
- MongoDB through the official native driver; no relational ORM and no SQL migration layer.
- Passwords use `bcryptjs`; authenticated sessions use a signed JWT in an HttpOnly cookie.
- Express mounts JSON parsing, request IDs, cookie parsing, authentication, role checks, API routes, static file serving, and one JSON error handler.
- The server root is the existing `maison-belle/maison-belle` directory. `express.static` serves that directory after API routes so `/`, `/products.html`, `/product.html`, `/cart.html`, and `/admin.html` continue to work.

## Roles and authorization

| Role | Allowed scope |
| --- | --- |
| `customer` | Public products, own cart, own orders, own appointments, voucher validation, and own profile context |
| `sales` | Customer/order assistance, appointment handling, product catalog writes, promotions, deliveries, and returns |
| `warehouse` | Inventory, stock receipts, stock adjustments, order fulfillment data, and deliveries |
| `manager` | All staff operations and reports |

The customer identity is always taken from the authenticated session for protected own-data operations. Staff endpoints never accept a user ID from the body when the identity can be derived from the session.

## MongoDB model

The implementation keeps the diagram's references while using document modeling where the source report permits it.

### Referenced collections

- `roles`, `users`, `stores`, `brands`, `categories`, `products`, and `product_variants` have independent lifecycles.
- `inventories` has one document per `{ storeId, variantId }` and stores `stockQuantity`, `reservedQuantity`, and `version`.
- `appointments`, `vouchers`, `promotions`, `deliveries`, `returns`, `invoices`, and `payments` are separate because they have their own workflow and history.
- `inventory_logs`, `order_histories`, and `point_histories` are append-only history collections.

### Embedded documents

- `carts.items` embeds the current variant references and requested quantities.
- `orders.items` embeds product/variant references plus immutable product name, SKU, unit price, quantity, and line discount snapshots.
- `orders.shippingAddress`, `orders.appliedVoucher`, and `orders.payment` are snapshots so later profile or voucher changes do not alter historical transactions.
- `orders.statusHistory` may be returned from `order_histories`; the history collection remains the audit source.
- `promotions.items` embeds the bounded promotion rules for a promotion document.

### Operational invariants

- Inventory updates use an atomic filter that prevents `stockQuantity - reservedQuantity` from becoming negative.
- Order creation validates every active variant, reserves stock, validates and atomically consumes the voucher, then writes the order. Failed writes release any reservation already acquired.
- Cancelling an order releases its reservation exactly once. Completing a COD/mock payment converts the reservation to sold stock.
- Prices, discounts, recipient data, and voucher details are copied into the order.
- Order, payment, delivery, return, inventory, and membership status changes append actor/time history records.

### Indexes

The index script creates idempotent indexes for:

- `users.email` unique and `users.phone` sparse unique.
- `products.slug`, `products.name`, `products.categoryId`, `products.brandId`, and `products.isActive`.
- `product_variants.sku` unique and `{ productId: 1, isActive: 1 }`.
- `inventories.{ storeId: 1, variantId: 1 }` unique.
- `carts.userId` unique sparse and `carts.sessionId` unique sparse.
- `orders.orderCode` unique and `{ userId: 1, createdAt: -1 }`, `{ orderStatus: 1, createdAt: -1 }`.
- `vouchers.code` unique and active-date lookup fields.
- `appointments.{ userId: 1, appointmentDate: 1 }` and `{ status: 1, appointmentDate: 1 }`.
- History and report date fields.

## API behavior

All API responses are JSON. Errors use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request data is invalid",
    "details": [{ "field": "quantity", "message": "Must be greater than zero" }]
  },
  "requestId": "..."
}
```

List endpoints return `{ data, pagination }`. Object endpoints return `{ data }`. Object IDs accept MongoDB ObjectId strings; product and variant seed aliases remain available as `slug` and `sku`.

The minimum contract is:

- Health: `GET /api/health`.
- Catalog: `GET /api/products`, `GET /api/products/:id`.
- Auth: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- Cart: `GET /api/cart`, `PUT /api/cart`.
- Voucher: `POST /api/vouchers/validate`.
- Orders: `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id`, `PATCH /api/orders/:id/status`.
- Appointments: `GET /api/appointments`, `POST /api/appointments`, `PATCH /api/appointments/:id`.
- Admin catalog: `GET/POST/PATCH /api/admin/products`.
- Inventory: `GET /api/admin/inventory`, `POST /api/admin/stock-receipts`, `POST /api/admin/stock-adjustments`.
- Promotions: `GET/POST/PATCH /api/admin/promotions`.
- Delivery: `GET/POST /api/admin/deliveries`.
- Returns: `GET/POST /api/admin/returns`.
- Reports: `GET /api/admin/reports`.

The contract also documents the small supporting endpoints needed for invoice/payment visibility without adding a real payment integration.

## Status flows

- Orders: `pending -> confirmed -> processing -> shipped -> delivered -> completed`; `pending|confirmed|processing -> cancelled`; `delivered -> returned` only through the returns workflow.
- Payments: `pending -> paid|failed`; COD remains `pending` until the mock completion action.
- Appointments: `requested -> confirmed|cancelled|completed`.
- Deliveries: `ready -> assigned -> picked_up -> in_transit -> delivered|failed`.
- Returns: `requested -> approved|rejected -> received -> refunded|exchanged`.

The status route validates allowed transitions and records the actor. A customer can cancel only their own pending order; staff transitions require the relevant role.

## Demo and safety

The seed script writes only the database name from `MONGODB_DB`, whose example value is `maison_belle_dev`. It refuses a URI/database containing obvious production markers unless `ALLOW_DEMO_SEED=true` is explicitly present. Every seeded record includes `isDemo: true` where the collection is user-visible. Demo credentials are documented in the API contract and are not production credentials.

## Verification strategy

- Unit-level tests cover validation, status transition rules, voucher calculations, and pagination.
- API integration tests use a dedicated test database name, seed a small fixture, exercise the main customer/staff flows, and clean that database afterward.
- Smoke checks start the server, verify `/api/health`, verify static serving, and check that the API returns JSON errors for invalid input.
- The final verification records the exact commands and output, and separately reports any missing external MongoDB service or unimplemented real integration.
