import { closeDatabase, connectDatabase } from "../src/db.js";
import { getConfig } from "../src/config.js";
import { collections } from "../src/collections.js";

export async function createIndexes(db) {
  const c = collections(db);
  const created = [];
  const add = async (collection, spec, options = {}) => {
    created.push(`${collection.collectionName}.${await collection.createIndex(spec, options)}`);
  };

  await add(c.users, { email: 1 }, { unique: true });
  await add(c.users, { phone: 1 }, { unique: true, sparse: true });
  await add(c.products, { slug: 1 }, { unique: true });
  await add(c.products, { name: 1, isActive: 1 });
  await add(c.products, { categoryId: 1, brandId: 1, isActive: 1 });
  await add(c.products, { skinTypes: 1, isActive: 1 });
  await add(c.categories, { slug: 1 }, { unique: true });
  await add(c.categories, { parentCategoryId: 1, isActive: 1 });
  await add(c.brands, { code: 1 }, { unique: true, sparse: true });
  await add(c.brands, { slug: 1 }, { unique: true, sparse: true });
  await add(c.stores, { code: 1 }, { unique: true, sparse: true });
  await add(c.stores, { latitude: 1, longitude: 1 });
  await add(c.variants, { sku: 1 }, { unique: true });
  await add(c.variants, { productId: 1, isActive: 1 });
  await add(c.inventories, { storeId: 1, variantId: 1 }, { unique: true });
  await add(c.carts, { userId: 1 }, { unique: true, sparse: true });
  await add(c.carts, { sessionId: 1 }, { unique: true, sparse: true });
  await add(c.orders, { orderCode: 1 }, { unique: true });
  await add(c.orders, { userId: 1, createdAt: -1 });
  await add(c.orders, { orderStatus: 1, createdAt: -1 });
  await add(c.vouchers, { code: 1 }, { unique: true });
  await add(c.vouchers, { isActive: 1, startDate: 1, endDate: 1 });
  await add(c.payments, { orderId: 1 }, { unique: true });
  await add(c.invoices, { orderId: 1 }, { unique: true });
  await add(c.appointments, { userId: 1, appointmentDate: 1 });
  await add(c.appointments, { status: 1, appointmentDate: 1 });
  await add(c.consultationReviews, { consultationId: 1, userId: 1 }, { unique: true });
  await add(c.consultationReviews, { consultationId: 1, createdAt: -1 });
  await add(c.flashSales, { isActive: 1, startDate: 1, endDate: 1 });
  await add(c.productRecommendations, { productId: 1, recommendedProductId: 1 }, { unique: true });
  await add(c.productRecommendations, { productId: 1, rank: 1 });
  await add(c.productViews, { userId: 1, viewedAt: -1 });
  await add(c.productViews, { productId: 1, viewedAt: -1 });
  await add(c.reviews, { productId: 1, status: 1, createdAt: -1 });
  await add(c.reviews, { userId: 1, createdAt: -1 });
  await add(c.userBehaviors, { userId: 1, createdAt: -1 });
  await add(c.userBehaviors, { productId: 1, actionType: 1, createdAt: -1 });
  await add(c.userVouchers, { userId: 1, voucherId: 1 }, { unique: true });
  await add(c.userVouchers, { userId: 1, status: 1, expiresAt: 1 });
  await add(c.wishlists, { userId: 1 }, { unique: true });
  await add(c.wishlists, { "items.productId": 1 });
  await add(c.orderHistories, { orderId: 1, createdAt: -1 });
  await add(c.inventoryLogs, { inventoryId: 1, createdAt: -1 });
  await add(c.pointHistories, { userId: 1, createdAt: -1 });
  return created;
}

async function main() {
  const config = getConfig();
  const { client, db } = await connectDatabase(config);
  try {
    console.log((await createIndexes(db)).join("\n"));
  } finally {
    await closeDatabase(client);
  }
}

if (process.argv[1]?.endsWith("create-indexes.js")) await main();
