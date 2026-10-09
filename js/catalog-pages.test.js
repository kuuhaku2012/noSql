const test = require("node:test");
const assert = require("node:assert/strict");
const { brandHref, normalizeBrands, normalizeOffers } = require("./catalog-pages.js");

test("brands normalize API catalog data and link by stable code", () => {
  const brands = normalizeBrands({ data: { brands: [
    { id: "b-1", name: "Belle", code: "BELLE", isActive: true },
    { id: "b-2", name: "Hidden", code: "HIDDEN", isActive: false },
    { id: "b-3", name: "No code", slug: "no-code", isActive: true }
  ] } });

  assert.equal(brands.length, 2);
  assert.equal(brandHref(brands[0]), "products.html?brand=BELLE");
  assert.equal(brandHref(brands[1]), "products.html?brand=no-code");
});

test("offers combine promotion and flash-sale API payloads", () => {
  const offers = normalizeOffers({
    promotions: { data: [{ id: "p-1", name: "Summer", startDate: "2026-10-01", endDate: "2026-10-31", items: [{ variantId: "v-1", promotionPrice: 90000 }] }] },
    flashSales: { data: [{ id: "f-1", name: "Flash", startDate: "2026-10-02", endDate: "2026-10-03", items: [{ variantId: "v-2", promotionPrice: 70000, quantityLimit: 10 }] }] }
  });

  assert.deepEqual(offers.map((item) => [item.kind, item.id, item.name]), [
    ["promotion", "p-1", "Summer"],
    ["flashSale", "f-1", "Flash"]
  ]);
});
