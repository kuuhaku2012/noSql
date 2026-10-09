import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { closeDatabase, connectDatabase } from "../src/db.js";
import { getConfig } from "../src/config.js";

export function assertSafeSeedDatabase(config) {
  const name = String(config.databaseName || "").toLowerCase();
  if ((name.includes("prod") || name.includes("production")) && !config.allowDemoSeed) {
    const error = new Error("Refusing to seed a production-looking database");
    error.code = "UNSAFE_SEED_DATABASE";
    throw error;
  }
}

function id() {
  return crypto.randomUUID();
}

export function buildDemoData() {
  const now = new Date();
  const roles = ["customer", "sales", "warehouse", "manager"].map((name) => ({ _id: id(), name, isDemo: true }));
  const role = Object.fromEntries(roles.map((item) => [item.name, item._id]));
  const storeId = id();
  const brands = ["SKIN1004", "COSRX", "COCOON", "MAISON BELLE"].map((name) => ({ _id: id(), name, code: name.replace(/\s+/g, "-"), slug: name.toLowerCase().replace(/\s+/g, "-"), origin: "Demo", logoUrl: null, isActive: true, isDemo: true }));
  const categories = ["skincare", "makeup", "body"].map((name) => ({ _id: id(), name, slug: name, description: `${name} demo category`, parentCategoryId: null, isActive: true, isDemo: true }));
  const brandByName = Object.fromEntries(brands.map((item) => [item.name, item._id]));
  const categoryByName = Object.fromEntries(categories.map((item) => [item.name, item._id]));
  const names = [
    ["centella", "Madagascar Centella Ampoule", "SKIN1004", "skincare", 289000],
    ["cicaplast", "Cicaplast Baume B5+ 40ml", "SKIN1004", "skincare", 320000],
    ["cleanser", "Low pH Good Morning Gel Cleanser", "COSRX", "skincare", 225000],
    ["niacinamide", "Niacinamide 10% + Zinc 1%", "COSRX", "skincare", 245000],
    ["cerave", "Moisturising Cream 50ml", "SKIN1004", "skincare", 195000],
    ["sun", "Relief Sun SPF50+", "SKIN1004", "skincare", 295000],
    ["tint", "Juicy Lasting Tint", "COSRX", "makeup", 189000],
    ["cushion", "Soft Blur Cushion", "MAISON BELLE", "makeup", 420000],
    ["oil", "Dầu dưỡng thể cà phê", "COCOON", "body", 265000],
    ["wash", "Sữa tắm hoa sen", "COCOON", "body", 175000],
    ["toner", "Centella Toner Essence", "SKIN1004", "skincare", 255000],
    ["eye", "Calm Eye Cream", "MAISON BELLE", "skincare", 310000]
  ];
  const products = names.map(([slug, name, brand, category, price]) => ({
    _id: id(), slug, name, brandId: brandByName[brand], categoryId: categoryByName[category],
    description: `${name} - sản phẩm demo của Maison Belle`, ingredients: "Demo ingredients", howToUse: "Dùng theo hướng dẫn trên bao bì", isActive: true, isDemo: true, createdAt: now, updatedAt: now
  }));
  const variants = products.map((product, index) => ({
    _id: id(), productId: product._id, sku: `DEMO-${String(index + 1).padStart(3, "0")}`, barcode: `893000000${String(index + 1).padStart(3, "0")}`, colorName: null, volume: "30ml", originalPrice: names[index][4] + 50000, retailPrice: names[index][4], imageUrl: "img/skincare.jpg", isActive: true, isDemo: true
  }));
  for (const product of products) Object.assign(product, { skinTypes: ["normal"], thumbnailUrl: "img/skincare.jpg" });
  for (const variant of variants) Object.assign(variant, { colorCode: null });
  const users = [
    ["customer@maisonbelle.local", "Khách demo", "customer"],
    ["sales@maisonbelle.local", "Nhân viên bán hàng demo", "sales"],
    ["warehouse@maisonbelle.local", "Nhân viên kho demo", "warehouse"],
    ["manager@maisonbelle.local", "Quản lý demo", "manager"]
  ].map(([email, fullName, roleName]) => ({ _id: id(), email, fullName, role: roleName, roleId: role[roleName], passwordHash: bcrypt.hashSync("Demo@123", 10), avatarUrl: null, isActive: true, isDemo: true, createdAt: now }));
  const inventories = variants.map((variant) => ({ _id: id(), storeId, variantId: variant._id, stockQuantity: 50, reservedQuantity: 0, version: 1, isDemo: true, updatedAt: now }));
  const vouchers = [{ _id: id(), code: "BELLE10", discountType: "percentage", discountValue: 10, minOrderValue: 200000, maxDiscountAmount: 100000, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01T23:59:59.999Z"), totalUsageLimit: 1000, usedCount: 0, isActive: true, isDemo: true }];
  const promotions = [{ _id: id(), name: "Demo Beauty Week", startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01T23:59:59.999Z"), isActive: true, items: [], isDemo: true, createdAt: now }];
  const consultationId = id();
  const consultationProducts = [{ productId: products[0]._id, variantId: variants[0]._id, productName: products[0].name, note: "Demo recommendation", createdAt: now }];
  const appointments = [{ _id: consultationId, userId: users[0]._id, employeeId: users[1]._id, consultationType: "skincare", appointmentDate: new Date("2027-01-10"), startTime: "09:00", endTime: "10:00", status: "completed", customerNote: "Demo consultation", employeeNote: "Demo staff note", consultationResult: "Demo consultation result", products: consultationProducts, createdAt: now, updatedAt: now, isDemo: true }];
  const consultationReviews = [{ _id: id(), consultationId, userId: users[0]._id, rating: 5, comment: "Demo consultation review", createdAt: now, isDemo: true }];
  const flashSales = [{ _id: id(), name: "Demo Flash Sale", startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01T23:59:59.999Z"), isActive: true, items: [{ variantId: variants[0]._id, promotionPrice: 249000, quantityLimit: 20, soldQuantity: 0, maxQuantityPerUser: 2 }], createdAt: now, updatedAt: now, isDemo: true }];
  const productRecommendations = [{ _id: id(), productId: products[0]._id, recommendedProductId: products[1]._id, rank: 1, reason: "Demo recommendation", isActive: true, createdAt: now, isDemo: true }];
  const productViews = [{ _id: id(), userId: users[0]._id, productId: products[0]._id, viewedAt: now, source: "demo", isDemo: true }];
  const reviews = [{ _id: id(), userId: users[0]._id, productId: products[0]._id, rating: 5, comment: "Demo product review", status: "approved", isApproved: true, isHidden: false, createdAt: now, updatedAt: now, isDemo: true }];
  const userBehaviors = [{ _id: id(), userId: users[0]._id, productId: products[0]._id, actionType: "view", metadata: { source: "demo" }, createdAt: now, isDemo: true }];
  const userVouchers = [{ _id: id(), userId: users[0]._id, voucherId: vouchers[0]._id, status: "available", claimedAt: now, usedAt: null, expiresAt: vouchers[0].endDate, isDemo: true }];
  const carts = [{ _id: id(), userId: users[0]._id, items: [{ variantId: variants[0]._id, quantity: 1, size: null }], createdAt: now, updatedAt: now, isDemo: true }];
  const wishlists = [{ _id: id(), userId: users[0]._id, items: [{ productId: products[0]._id, addedAt: now }], createdAt: now, updatedAt: now, isDemo: true }];
  const orderId = id();
  const orders = [{ _id: orderId, orderCode: "DEMO-ORDER-001", userId: users[0]._id, storeId, cartId: carts[0]._id, customerName: users[0].fullName, phoneNumber: "0900000000", shippingAddress: { receiverName: users[0].fullName, receiverPhone: "0900000000", fullAddress: "Demo address" }, district: "Demo District", ward: "Demo Ward", items: [{ productId: products[0]._id, variantId: variants[0]._id, sku: variants[0].sku, productName: products[0].name, quantity: 1, retailPrice: variants[0].retailPrice, unitPrice: variants[0].retailPrice, lineTotal: variants[0].retailPrice }], subtotal: variants[0].retailPrice, deliveryFee: 0, discountAmount: 0, finalAmount: variants[0].retailPrice, appliedVoucher: null, paymentMethod: "cod", paymentStatus: "paid", orderStatus: "completed", reservationReleased: true, stockCommitted: true, createdAt: now, updatedAt: now, isDemo: true }];
  const orderHistories = [{ _id: id(), orderId, oldStatus: null, newStatus: "completed", note: "Demo order", createdByUserId: users[1]._id, createdAt: now, isDemo: true }];
  const inventoryLogs = [{ _id: id(), inventoryId: inventories[0]._id, storeId, variantId: variants[0]._id, changeType: "receipt", quantityChanged: 50, unitCost: 100000, note: "Demo opening stock", createdAt: now, createdByUserId: users[2]._id, isDemo: true }];
  const memberships = [{ _id: id(), userId: users[0]._id, pointsBalance: 100, lifetimePoints: 100, tier: "bronze", createdAt: now, updatedAt: now, isDemo: true }];
  const pointHistories = [{ _id: id(), userId: users[0]._id, orderId, type: "earned", points: 100, transactionType: "order", description: "Demo points", createdAt: now, isDemo: true }];
  const userAddresses = [{ _id: id(), userId: users[0]._id, receiverName: users[0].fullName, receiverPhone: "0900000000", fullAddress: "Demo address", isDefault: true, createdAt: now, updatedAt: now, isDemo: true }];
  const payments = [{ _id: id(), orderId, method: "cod", status: "paid", amount: orders[0].finalAmount, isMock: true, createdAt: now, updatedAt: now, isDemo: true }];
  const invoices = [{ _id: id(), orderId, invoiceCode: "INV-DEMO-ORDER-001", status: "issued", amount: orders[0].finalAmount, isMock: true, createdAt: now, updatedAt: now, isDemo: true }];
  return {
    roles,
    users,
    stores: [{ _id: storeId, name: "Maison Belle Demo Store", code: "MB-DEMO", address: "Demo address", phone: "0900000000", latitude: 10.7769, longitude: 106.7009, isActive: true, isDemo: true }],
    brands,
    categories,
    products,
    variants,
    inventories,
    vouchers,
    promotions,
    appointments,
    consultationReviews,
    flashSales,
    productRecommendations,
    productViews,
    reviews,
    userBehaviors,
    userVouchers,
    carts,
    wishlists,
    orders,
    orderHistories,
    inventoryLogs,
    memberships,
    pointHistories,
    userAddresses,
    payments,
    invoices
  };
}

const seedCollectionNames = {
  variants: "product_variants",
  consultationReviews: "consultation_reviews",
  flashSales: "flash_sales",
  inventoryLogs: "inventory_logs",
  orderHistories: "order_histories",
  pointHistories: "point_histories",
  productRecommendations: "product_recommendations",
  productViews: "product_views",
  userAddresses: "user_addresses",
  userBehaviors: "user_behaviors",
  userVouchers: "user_vouchers"
};

async function cleanLegacyDemoCollection(db, legacyName, canonicalName) {
  if (legacyName === canonicalName) return;
  const legacy = db.collection(legacyName);
  if (!(await db.listCollections({ name: legacyName }, { nameOnly: true }).hasNext())) return;
  if (await legacy.countDocuments({ isDemo: { $ne: true } })) return;
  await legacy.deleteMany({ isDemo: true });
  try {
    await legacy.drop();
  } catch (error) {
    if (error.codeName !== "NamespaceNotFound") throw error;
  }
}

export async function seedDemo(db, config) {
  assertSafeSeedDatabase(config);
  const data = buildDemoData();
  for (const [name, records] of Object.entries(data)) {
    if (!records.length) continue;
    const collectionName = seedCollectionNames[name] || name;
    await cleanLegacyDemoCollection(db, name, collectionName);
    const collection = db.collection(collectionName);
    await collection.deleteMany({ isDemo: true });
    await collection.insertMany(records);
  }
  return data;
}

async function main() {
  const config = getConfig();
  assertSafeSeedDatabase(config);
  const { client, db } = await connectDatabase(config);
  try {
    const data = await seedDemo(db, config);
    console.log(`Seeded demo data into ${config.databaseName}: ${Object.values(data).reduce((sum, rows) => sum + rows.length, 0)} records`);
  } finally {
    await closeDatabase(client);
  }
}

if (process.argv[1]?.endsWith("seed.js")) await main();
