const test = require("node:test");
const assert = require("node:assert/strict");
const { findOrderByCode, supportGuide } = require("./warranty-page.js");

test("order lookup matches the customer order code without case sensitivity", () => {
  const order = { id: "o-1", orderCode: "MB-2026-0001", orderStatus: "delivered" };
  assert.deepEqual(findOrderByCode([order], " mb-2026-0001 "), order);
  assert.equal(findOrderByCode([order], "MB-404"), null);
});

test("support guide changes with the current order state", () => {
  assert.match(supportGuide("delivered").title, /đổi trả/i);
  assert.match(supportGuide("pending").description, /xác nhận/i);
  assert.match(supportGuide("cancelled").description, /hỗ trợ/i);
});
