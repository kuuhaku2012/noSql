import test from "node:test";
import assert from "node:assert/strict";
import { buildDemoData, assertSafeSeedDatabase } from "../scripts/seed.js";

test("demo seed rejects production-looking database names", () => {
  assert.throws(
    () => assertSafeSeedDatabase({ databaseName: "maison_belle_production", allowDemoSeed: false }),
    (error) => error.code === "UNSAFE_SEED_DATABASE"
  );
});

test("demo seed records are explicitly marked", () => {
  const data = buildDemoData();
  for (const collection of ["users", "products", "vouchers"]) {
    assert.ok(data[collection].length > 0);
    assert.ok(data[collection].every((record) => record.isDemo === true));
  }
});

test("demo users omit empty unique phone values", () => {
  const data = buildDemoData();
  assert.ok(data.users.every((user) => user.phone === undefined || typeof user.phone === "string"));
});
