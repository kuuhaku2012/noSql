import test from "node:test";
import assert from "node:assert/strict";
import { validateBody, assertObjectId } from "../src/lib/validation.js";
import { parsePagination } from "../src/lib/pagination.js";
import { assertTransition, orderTransitions } from "../src/lib/status.js";
import { calculateVoucher } from "../src/lib/vouchers.js";

test("validateBody accepts a positive quantity", () => {
  assert.deepEqual(
    validateBody({ quantity: { type: "positiveInteger" } }, { quantity: 2 }),
    { quantity: 2 }
  );
});

test("validateBody rejects zero quantity", () => {
  assert.throws(
    () => validateBody({ quantity: { type: "positiveInteger" } }, { quantity: 0 }),
    (error) => error.code === "VALIDATION_ERROR" && error.details[0].field === "quantity"
  );
});

test("assertObjectId rejects malformed ids", () => {
  assert.throws(() => assertObjectId("bad-id", "productId"), (error) => error.code === "VALIDATION_ERROR");
});

test("parsePagination clamps unsafe values", () => {
  assert.deepEqual(parsePagination({ page: "0", limit: "999" }), { page: 1, limit: 100, skip: 0 });
});

test("assertTransition accepts and rejects order transitions", () => {
  assert.doesNotThrow(() => assertTransition(orderTransitions, "pending", "confirmed"));
  assert.throws(
    () => assertTransition(orderTransitions, "completed", "processing"),
    (error) => error.code === "INVALID_STATUS_TRANSITION"
  );
});

test("calculateVoucher applies and caps a percentage discount", () => {
  const voucher = {
    code: "TEN",
    discountType: "percentage",
    discountValue: 10,
    maxDiscountAmount: 50000,
    minOrderValue: 100000,
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2026-12-31T23:59:59Z"),
    isActive: true
  };
  assert.equal(calculateVoucher(voucher, 1000000, new Date("2026-06-01T00:00:00Z")).discountAmount, 50000);
});

test("calculateVoucher rejects an expired voucher and a low subtotal", () => {
  const voucher = {
    code: "FIXED",
    discountType: "fixed",
    discountValue: 20000,
    minOrderValue: 200000,
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2026-02-01T00:00:00Z"),
    isActive: true
  };
  assert.throws(() => calculateVoucher(voucher, 100000, new Date("2026-01-15T00:00:00Z")), (error) => error.code === "VOUCHER_MIN_ORDER");
  assert.throws(() => calculateVoucher(voucher, 300000, new Date("2026-03-01T00:00:00Z")), (error) => error.code === "VOUCHER_EXPIRED");
});
