# Maison Belle Persistence and Test-Safety Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure migrations, indexes, seeds, and integration-test fixtures cannot mutate data outside an explicitly isolated test database.

**Architecture:** Keep the existing Express/MongoDB driver and scripts. Make test connection configuration consistent, inspect the additive migration and seed safeguards, and run persistence tests only against a disposable local MongoDB test instance.

**Tech Stack:** Node.js >=20, pnpm, MongoDB Node driver 6, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-13-maison-belle-functional-data-audit-design.md`

## Global Constraints

- Preserve the existing Express/MongoDB architecture and role names.
- Migrations are additive and repeatable; do not clear, replace, or destructively rewrite business records.
- Run seeds, migrations, and integration tests only against a database explicitly identified as a disposable test database.
- Never print connection secrets or inherit an unverified remote MongoDB URI for destructive test fixtures.
- Preserve all existing worktree changes; do not push to a remote.

**Execution order:** First complete Task 3 Steps 1–2 to locate and start/select the disposable MongoDB instance. Then complete Task 1 and Task 2, followed by Task 3 Steps 3–5. The storefront, commerce, and admin/support plans depend on Task 1 and Task 3 Step 2 being complete before any MongoDB-backed suite runs.

---

### Task 1: Make MongoDB integration fixtures honor the explicit test URI

**Files:**
- Modify: `backend/test/shipping-rates.test.js`
- Test: `backend/test/shipping-rates.test.js`

**Interfaces:**
- Consumes: `MONGODB_URI` and `MONGODB_TEST_DB` process environment variables.
- Produces: the shipping-rate fixture connects only to the explicitly selected MongoDB instance and retains its `maison_belle_test_*` database-prefix guard.

- [x] **Step 1: Confirm the fixture mismatch**

Run from the repository root:

```powershell
rg -n 'mongoUri|configuredDbPrefix|dropDatabase' backend/test/shipping-rates.test.js backend/test
```

Verified: `shipping-rates.test.js` was the fixture hardcoding `127.0.0.1:27017`; the other inspected integration fixtures read `MONGODB_URI`.

- [x] **Step 2: Add an explicit fixture-configuration assertion**

Update the existing `shipping-rate test databases use the configured prefix and isolate each process` test to also assert the fixture URI equals `process.env.MONGODB_URI || "mongodb://127.0.0.1:27017"`. Set `mongoUri` from that same expression. Keep the existing prefix and process-isolation assertions unchanged.

- [x] **Step 3: Run the fixture safety test against a disposable listener**

After the isolated listener from Task 3 Step 2 is ready, set `MONGODB_URI` to `mongodb://127.0.0.1:27019` and `MONGODB_TEST_DB` to `maison_belle_test_audit`, then run from `backend/`:

```powershell
node --test test/shipping-rates.test.js
```

Verified: 10/10 pass on port 27019; the fixture uses the `maison_belle_test_` prefix and exact per-process cleanup.

- [x] **Step 4: Commit the isolated fixture correction**

Stage only `backend/test/shipping-rates.test.js` and commit as `test: honor isolated MongoDB URI in shipping fixture`. If that file already contains unrelated user edits, stage only the fixture hunk and leave unrelated changes untouched.

### Task 2: Verify additive migration, index preflight, and seed repeatability

**Files:**
- Inspect: `backend/src/config.js`, `backend/src/db.js`, `backend/src/server.js`
- Inspect: `backend/scripts/create-indexes.js`, `backend/scripts/migrate-model.js`, `backend/scripts/seed.js`
- Test: `backend/test/seed-safety.test.js`, `backend/test/model-completion.test.js`, `backend/test/shipping-rates.test.js`

**Interfaces:**
- Consumes: `getConfig`, `migrateModel`, `createIndexes`, and `seedDemo` as currently exported by the repository.
- Produces: evidence that repeated setup preserves legacy orders/addresses and manager-edited shipping rates and fails safely on unique-key conflicts.

- [x] **Step 1: Run the focused persistence suite on the isolated instance**

Set `MONGODB_URI=mongodb://127.0.0.1:27019` and `MONGODB_TEST_DB=maison_belle_test_audit`; run from `backend/`:

```powershell
node --test test/seed-safety.test.js test/model-completion.test.js test/shipping-rates.test.js
```

Verified: all three files passed 21/21 using the local disposable instance and configured `maison_belle_test_` prefix.

- [x] **Step 2: Verify historical-record preservation assertions**

Verified: the named legacy-record, duplicate/missing/null preflight, and manager-edited/deactivated-rate cases all passed; no assertion was missing.

- [x] **Step 3: Correct only a reproduced safety defect**

No migration, index, or seed safety defect reproduced; no production script change was made.

- [x] **Step 4: Rerun focused persistence tests**

Verified: 21/21 passed, and a post-suite database list contained no remaining `maison_belle_test_audit*` databases.

### Task 3: Verify safe runtime startup and full-suite database targeting

**Files:**
- Inspect: `backend/src/config.js`, `backend/src/db.js`, `backend/src/server.js`
- Test: all `backend/test/*.test.js`

**Interfaces:**
- Consumes: local Node/pnpm/MongoDB installations and test-only environment variables.
- Produces: a documented runnable test setup that never starts the app against a valued/default database for the audit.

- [x] **Step 1: Locate runtimes without exposing environment secrets**

Run in PowerShell:

```powershell
Get-Command node,pnpm,mongod -ErrorAction SilentlyContinue | Select-Object Name,Source
Get-NetTCPConnection -State Listen -LocalPort 27017,27018,27019,3001 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort
```

Verified: Node, pnpm, and MongoDB 8.3.8 found; no runtime install was required. Ports 27017/27018 already had listeners and were left unused.

- [x] **Step 2: Start or select only the disposable local MongoDB instance**

Ports 27017 and 27018 already had listeners before the audit instance was started; 27018 belongs to an unrelated pre-existing `mongod.exe`. Do not connect to or stop either listener. Use the verified MongoDB binary on `127.0.0.1:27019` with a fresh data directory under the task's approved visualization root (not the per-command sandbox TEMP directory). For this checkout, run:

```powershell
$mongoExe = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe'
$taskDataRoot = 'C:\Users\kuuhaku\.codex\visualizations\2026\09\10\01a08c03-0e39-73d3-a2bb-93807779dc91'
$mongoDataDir = Join-Path $taskDataRoot ('mongo-audit-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$mongoLogPath = Join-Path $mongoDataDir 'mongod.log'
New-Item -ItemType Directory -Force -Path $mongoDataDir | Out-Null
Start-Process -FilePath $mongoExe -ArgumentList @('--dbpath', ('"' + $mongoDataDir + '"'), '--logpath', ('"' + $mongoLogPath + '"'), '--bind_ip', '127.0.0.1', '--port', '27019') -WindowStyle Hidden
```

Verified: audit `mongod` is bound to `127.0.0.1:27019` with dedicated data directory `mongo-audit-live-298cc264`; read-only ping succeeded. No `.env` URI was used.

- [x] **Step 3: Run the full backend suite on the isolated instance**

Set `MONGODB_URI=mongodb://127.0.0.1:27019` and `MONGODB_TEST_DB=maison_belle_test_audit`, then run from `backend/`:

```powershell
pnpm test
```

Verified: 107/107 tests passed. The two injected ACK-loss messages are expected output from passing compensation tests.

- [x] **Step 4: Run startup migration only against a named test database**

Port 3001 was occupied by an unverified Node process and left untouched. Port 3002 was free. Seeded 74 demo records into `maison_belle_test_audit_ui`, started the backend on 3002 with the same isolated URI/database, and confirmed `GET /api/health` returned `ok`.

- [ ] **Step 5: Record limitations and commit safety-only changes**

List unavailable runtimes or blocked integration tests with exact output. Stop only the MongoDB process started for this audit; retain and report its dedicated temporary data directory for optional cleanup rather than deleting an unverified path. Stage only persistence-fixture or migration-safety changes and commit them separately from commerce/UI changes.
