# Maison Belle Admin and Support Audit — Task 2 Review

Date: 2026-10-14

## Scope and outcome

Completed the approved Task 2 API and UI verification slice in `maison-belle-mongodb-commerce`. This includes the initial four-file integration set, the model-completion and shipping-rate manager-only route groups, and the full frontend test suite. The evidence below describes representative role checks and explicitly identifies endpoints whose manager-success behavior is not covered; it does not imply that every route/method has a four-role Cartesian test.

No server-side authorization or persistence defect reproduced in the audited API cases. Browser smoke did reproduce one client-side navigation visibility defect, documented and fixed below; server-side role gates remain unchanged.

The worktree contained user changes before and during this audit. They were preserved. No changes were made to `backend/test/admin-workflows.test.js`, `backend/test/order-flows.test.js`, or CSS. The role-navigation regression required a small change in `js/admin.js` and assertions in the already-dirty `js/admin.test.js`; server routes and middleware were not changed. Nothing was staged, committed, or pushed.

## Route role coverage

The inspected middleware resolves the active user from the signed session and checks `req.user.role` server-side. Current gates in the audited route groups:

| Route group | Policy in source | Tested evidence in this slice |
| --- | --- | --- |
| Products | sales, manager writes | Sales create/update/soft-deactivate; customer denial; anonymous 401 and warehouse denial each assert unchanged product count |
| Inventory and stock adjustments | warehouse, manager | Warehouse receipt/adjustment flow; sales/customer denials assert unchanged inventory and scoped `inventory_logs` count |
| Deliveries | sales, warehouse, manager | Warehouse create/update; customer denial asserts unchanged delivery count |
| Manager-only catalog/user administration | manager | Manager CRUD; customer user-create denial; sales user-create denial asserts no user was inserted |
| Vouchers/promotions/returns | sales, manager | Manager CRUD, validation, and transition cases; the route gates were inspected; not every allowed staff role has a positive write assertion for every route |
| Payments/invoices and reports | manager | Manager payment/invoice writes and report access; sales report denial |
| Flash sales | manager | Manager create is covered. Anonymous, sales, warehouse, and customer POST/PATCH/DELETE denials each assert unchanged count or unchanged target record |
| Product recommendations | manager | Anonymous, sales, warehouse, and customer POST/PATCH/DELETE denials each assert unchanged collection count or target record |
| Admin behavior report | manager read access | Anonymous, sales, warehouse, and customer GET denials assert the behavior collection count is unchanged |
| Admin user-voucher assignment | manager | Manager assignment positive case; anonymous, sales, warehouse, and customer denials assert no target assignment is created |
| Shipping-rate administration | manager | Manager list/create/update/soft-deactivate; anonymous, sales, warehouse, and customer POST/PATCH/DELETE denials assert unchanged count or stored target record |

The denied stock-adjustment test now snapshots `inventory_logs` using `{ storeId, variantId }`, checks immediately after each denied sales/customer request, and also compares the inventory document. The anonymous product-write denial now checks product count immediately after its 401; the warehouse denial has its own before/after count.

## Frontend role and API evidence

Ran the full frontend suite, `node --test js/*.test.js`, rather than only the two files listed in the plan. It passed 100/100. Relevant passing test names include:

- `staff navigation reflects the role while manager can inspect every supported view`
- `staff without a requested section land on a section their role can use`
- `admin navigation is only added for manager or admin roles`
- `admin shipping-rate list uses the manager endpoint and JSON contract`
- `business workflow methods call the agreed catalog, customer, appointment, payment, return, and admin routes`
- `offers and admin flash-sale methods use the live API resources`

An isolated browser check on `http://127.0.0.2:3002` found the sales role's dashboard, inventory, and master-data links had `hidden=true` but still computed to `display:flex`, because the author `.side-link { display:flex }` rule overrode hidden rendering. After the fix, all three have `display:none` and no client rect; supported sales links remain visible. Direct navigation to `?view=inventory` still renders the existing “Không đủ quyền” state. A warehouse session shows only products, inventory, and deliveries, and a direct dashboard URL remains denied.

## Changes made

- `backend/test/crud.test.js`: added the immediate anonymous state assertion; retained separate warehouse product denial; added scoped inventory log count checks after denied stock adjustments.
- `backend/test/entity-crud.test.js`: added sales denial for manager-only user creation and asserted no user record was inserted (Round 1).
- `backend/test/model-completion.test.js`: added sales and warehouse fixture sessions; asserted manager-only role denials and no mutation for flash-sale writes, recommendation writes, admin behavior reads, and user-voucher assignment.
- `backend/test/shipping-rates.test.js`: extended manager-only write denials to anonymous and warehouse, and asserted state preservation for denied POST/PATCH/DELETE calls.
- `js/admin.js`: synchronize role visibility through both `hidden` and inline `display` so CSS cannot re-show inaccessible links while preserving allowed link styling.
- `js/admin.test.js`: assert inaccessible links have `display:none` and manager-accessible links clear the inline display override.
- Updated the Task 2 progress ledger and this review package.

The navigation fix was test-first: the focused test first failed on the expected empty display override; after the minimal fix, the admin suite passed 35/35 and the full frontend suite passed 100/100. An independent scoped review approved the change with no findings. No route or middleware source changed.

## Backend verification

All integration runs used the isolated local MongoDB endpoint and a test database prefix. From `backend/`, the environment was:

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27019'
$env:MONGODB_TEST_DB='maison_belle_test_audit'
$pnpmDirs = Get-ChildItem -LiteralPath 'node_modules/.pnpm' -Directory | ForEach-Object { Join-Path $_.FullName 'node_modules' }
$env:NODE_PATH = $pnpmDirs -join ';'
```

Round history is preserved:

| Run | Command | Result |
| --- | --- | --- |
| Initial baseline | `node --test test/auth-products.test.js test/crud.test.js test/entity-crud.test.js test/admin-workflows.test.js` | 25/25 passed |
| Round 1 | Same four-file command | 26/26 passed |
| Round 2 pre-edit baseline | `node --test test/model-completion.test.js test/shipping-rates.test.js` | 15/15 passed |
| Round 2 focused after edits | Same two-file command | 16/16 passed |
| Final Task 2 set | `node --test test/auth-products.test.js test/crud.test.js test/entity-crud.test.js test/admin-workflows.test.js test/model-completion.test.js test/shipping-rates.test.js` | 42/42 passed |

The full frontend command `node --test js/*.test.js` passed 100/100 in this round.

The initial sandbox-only invocation of the first four-file command was blocked at Mongo connection setup with `connect EACCES 127.0.0.1:27019`; its 29 setup-dependent tests did not exercise assertions. Retrying that same command with local-network access against the isolated port passed 25/25. Subsequent successful runs used the same isolated endpoint; no other MongoDB port was used.

## Remaining coverage limits

- Manager-success behavior for product recommendation create/update/deactivate and manager access to `/api/admin/behaviors` is not independently exercised here. The new assertions verify non-manager denial and no mutation; the source gate requires `manager`.
- Flash-sale manager create is covered, but manager PATCH/deactivation success is not independently tested. Non-manager denials for all three write methods are covered.
- The rest of the admin API does not have an exhaustive route × method × role matrix in this slice. Some allowed sales operations (for example sales-specific voucher, promotion, or return writes) are authorized by inspected route gates but are not each covered by a dedicated positive test here.
- Frontend checks establish role-appropriate navigation and client request contracts; they do not replace API authorization tests.

These are coverage limits, not reproduced runtime failures. They remain visible so the passing test totals are not read as proof of every manager-success contract or every possible role/method pairing.
