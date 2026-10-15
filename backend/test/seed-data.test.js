import test from "node:test";
import assert from "node:assert/strict";
import { buildDemoData } from "../scripts/seed.js";

test("demo seed includes the supplemental catalog with linked variants, inventory, and reviews", () => {
  const data = buildDemoData();
  const extraSlugs = [
    "demo-extra-barrier-cream",
    "demo-extra-centella-serum",
    "demo-extra-cleansing-oil",
    "demo-extra-vitamin-c-serum",
    "demo-extra-green-tea-toner",
    "demo-extra-panthenol-lotion",
    "demo-extra-soft-blur-cushion",
    "demo-extra-rose-lip-tint",
    "demo-extra-dewy-lip-balm",
    "demo-extra-coffee-body-scrub",
    "demo-extra-coffee-body-lotion",
    "demo-extra-lotus-hand-cream"
  ];
  const extraProducts = data.products.filter((product) => extraSlugs.includes(product.slug));
  const extraProductIds = new Set(extraProducts.map((product) => product._id));
  const extraVariants = data.variants.filter((variant) => extraProductIds.has(variant.productId));
  const extraVariantIds = new Set(extraVariants.map((variant) => variant._id));
  const extraInventories = data.inventories.filter((inventory) => extraVariantIds.has(inventory.variantId));
  const supplementalReviews = data.reviews.filter((review) => review.generationBatch === "codex-demo-20261015");

  assert.equal(extraProducts.length, 12);
  assert.deepEqual(extraProducts.map((product) => product.slug).sort(), extraSlugs.sort());
  assert.equal(data.products.length, 24);
  assert.equal(extraVariants.length, 12);
  assert.equal(new Set(extraVariants.map((variant) => variant.sku)).size, 12);
  assert.equal(extraInventories.length, 12);
  assert.ok(extraProducts.every((product) => product.isDemo && product.generationBatch === "codex-demo-20261015"));
  assert.ok(extraVariants.every((variant) => variant.isDemo && variant.generationBatch === "codex-demo-20261015"));
  assert.ok(extraInventories.every((inventory) => inventory.isDemo && inventory.stockQuantity > 0));
  assert.equal(supplementalReviews.length, 6);
  assert.ok(supplementalReviews.every((review) => review.isDemo && extraProductIds.has(review.productId)));
  assert.deepEqual(data.shippingRates.map((rate) => rate.code).sort(), ["hcm-demo", "hn-demo"]);
});
