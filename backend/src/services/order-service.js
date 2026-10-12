import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { HttpError, notFound } from "../lib/errors.js";
import { calculateVoucher } from "../lib/vouchers.js";
import { assertTransition, orderTransitions } from "../lib/status.js";
import { validateBody, toReference } from "../lib/validation.js";
import { isDateRangeActive } from "../lib/dates.js";

function serialize(value) {
  return value && typeof value.toHexString === "function" ? value.toHexString() : value;
}

export function serializeOrder(order) {
  return {
    ...order,
    id: serialize(order._id),
    _id: undefined,
    userId: serialize(order.userId),
    storeId: serialize(order.storeId),
    items: (order.items || []).map((item) => ({ ...item, productId: serialize(item.productId), variantId: serialize(item.variantId) }))
  };
}

async function releaseReservations(db, reservations) {
  const released = [];
  for (const item of reservations) {
    const result = await db.collection("inventories").updateOne(
      { storeId: item.storeId, variantId: item.variantId, reservedQuantity: { $gte: item.quantity } },
      { $inc: { reservedQuantity: -item.quantity, version: 1 }, $set: { updatedAt: new Date() } }
    );
    if (result.modifiedCount !== 1) {
      for (const previous of released) {
        await db.collection("inventories").updateOne(
          { storeId: previous.storeId, variantId: previous.variantId },
          { $inc: { reservedQuantity: previous.quantity, version: 1 }, $set: { updatedAt: new Date() } }
        );
      }
      throw new HttpError(409, "RESERVATION_RELEASE_FAILED", "Could not release all reserved stock");
    }
    released.push(item);
  }
}

export async function createOrder({ db, user, body }) {
  let checkoutRequestId;
  if (body.checkoutRequestId !== undefined) {
    if (typeof body.checkoutRequestId !== "string" || !body.checkoutRequestId.trim() || body.checkoutRequestId.length > 128) {
      throw new HttpError(400, "VALIDATION_ERROR", "checkoutRequestId must be a non-empty string of at most 128 characters");
    }
    checkoutRequestId = body.checkoutRequestId.trim();
    const existing = await db.collection("orders").findOne({ userId: user._id, checkoutRequestId });
    if (existing) return existing;
  }
  if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, "VALIDATION_ERROR", "At least one order item is required");
  validateBody({ paymentMethod: { required: true, type: "string" } }, body);
  if (!["cod", "mock"].includes(body.paymentMethod)) throw new HttpError(400, "VALIDATION_ERROR", "paymentMethod must be cod or mock");
  if (!body.shippingAddress || typeof body.shippingAddress !== "object" || Array.isArray(body.shippingAddress)) throw new HttpError(400, "VALIDATION_ERROR", "shippingAddress is required");
  validateBody({
    receiverName: { required: true, type: "string", maxLength: 120 },
    receiverPhone: { required: true, type: "string", maxLength: 30 },
    fullAddress: { required: true, type: "string", maxLength: 500 },
    regionCode: { required: true, type: "string", maxLength: 64 }
  }, body.shippingAddress);
  const regionCode = body.shippingAddress.regionCode.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(regionCode)) throw new HttpError(400, "VALIDATION_ERROR", "regionCode is invalid");
  const rate = await db.collection("shipping_rates").findOne({ code: regionCode, isActive: true });
  if (!rate) throw new HttpError(409, "SHIPPING_UNAVAILABLE", "This delivery region is not supported");
  const deliveryFee = Number(rate.fee);
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0 || typeof rate.regionName !== "string" || !rate.regionName.trim()) {
    throw new HttpError(409, "SHIPPING_UNAVAILABLE", "This delivery region is not configured correctly");
  }
  const shippingAddress = {
    receiverName: body.shippingAddress.receiverName.trim(),
    receiverPhone: body.shippingAddress.receiverPhone.trim(),
    fullAddress: body.shippingAddress.fullAddress.trim(),
    regionCode: rate.code,
    regionName: rate.regionName
  };
  if (Object.values(shippingAddress).some((value) => !value)) throw new HttpError(400, "VALIDATION_ERROR", "Shipping address fields cannot be empty");

  const variantRefs = body.items.map((item) => {
    validateBody({ variantId: { required: true }, quantity: { required: true, type: "positiveInteger" } }, item);
    return toReference(item.variantId, "variantId");
  });
  const variants = await db.collection("product_variants").find({ _id: { $in: variantRefs }, isActive: true }).toArray();
  const variantMap = new Map(variants.map((variant) => [String(variant._id), variant]));
  const products = db.collection("products");
  const items = [];
  for (const requested of body.items) {
    const variantId = toReference(requested.variantId, "variantId");
    const variant = variantMap.get(String(variantId));
    if (!variant) throw notFound("Variant not found");
    const product = await products.findOne({ _id: variant.productId, isActive: true });
    if (!product) throw notFound("Product not found");
    const now = new Date();
    const candidates = await db.collection("promotions").find({ isActive: true, startDate: { $lte: now }, "items.variantId": variant._id }).toArray();
    const promotions = candidates.filter((promotion) => isDateRangeActive(promotion.startDate, promotion.endDate, now));
    const offers = promotions.flatMap((promotion) => (promotion.items || [])
      .filter((offer) => String(offer.variantId) === String(variant._id) && Number(offer.promotionPrice) < Number(variant.retailPrice))
      .map((offer) => ({ id: promotion._id, name: promotion.name, price: Number(offer.promotionPrice) })));
    const promotion = offers.sort((a, b) => a.price - b.price)[0] || null;
    const unitPrice = promotion?.price ?? Number(variant.retailPrice);
    items.push({ productId: product._id, variantId: variant._id, sku: variant.sku, productName: product.name, quantity: requested.quantity, retailPrice: Number(variant.retailPrice), unitPrice, lineTotal: unitPrice * requested.quantity, lineDiscount: (Number(variant.retailPrice) - unitPrice) * requested.quantity, appliedPromotion: promotion ? { promotionId: promotion.id, name: promotion.name, unitPrice } : null });
  }
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  let voucherSnapshot = null;
  let voucherId = null;
  let voucherConsumed = false;
  if (body.voucherCode) {
    const voucher = await db.collection("vouchers").findOne({ code: String(body.voucherCode).trim().toUpperCase() });
    if (!voucher) throw new HttpError(404, "VOUCHER_NOT_FOUND", "Voucher not found");
    const result = calculateVoucher(voucher, subtotal);
    voucherId = voucher._id;
    voucherSnapshot = result.snapshot;
  }
  const store = body.storeId ? await db.collection("stores").findOne({ _id: toReference(body.storeId, "storeId"), isActive: true }) : await db.collection("stores").findOne({ isActive: true });
  if (!store) throw new HttpError(409, "STORE_UNAVAILABLE", "No active store is available");
  const reservations = [];
  let insertedOrderId = null;
  let orderInsertDuplicate = false;
  try {
    for (const item of items) {
      const result = await db.collection("inventories").findOneAndUpdate(
        { storeId: store._id, variantId: item.variantId, $expr: { $gte: [{ $subtract: ["$stockQuantity", "$reservedQuantity"] }, item.quantity] } },
        { $inc: { reservedQuantity: item.quantity, version: 1 }, $set: { updatedAt: new Date() } },
        { returnDocument: "after" }
      );
      if (!result) throw new HttpError(409, "STOCK_UNAVAILABLE", `Insufficient stock for ${item.sku}`);
      reservations.push({ storeId: store._id, variantId: item.variantId, quantity: item.quantity });
    }
    if (voucherId) {
      const filter = { _id: voucherId, isActive: true };
      const voucher = await db.collection("vouchers").findOne({ _id: voucherId });
      if (voucher.totalUsageLimit) filter.usedCount = { $lt: voucher.totalUsageLimit };
      const usage = await db.collection("vouchers").updateOne(filter, { $inc: { usedCount: 1 } });
      if (usage.modifiedCount !== 1) throw new HttpError(409, "VOUCHER_USAGE_LIMIT", "Voucher usage limit has been reached");
      voucherConsumed = true;
    }
    const now = new Date();
    const order = {
      _id: new ObjectId(),
      orderCode: `MB-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      userId: user._id,
      ...(checkoutRequestId ? { checkoutRequestId } : {}),
      storeId: store._id,
      customerName: shippingAddress.receiverName,
      phoneNumber: shippingAddress.receiverPhone,
      shippingAddress,
      shippingRateSnapshot: { regionCode: rate.code, regionName: rate.regionName, fee: deliveryFee, currency: "VND", isDemo: true },
      items,
      subtotal,
      deliveryFee,
      discountAmount: voucherSnapshot?.discountAmount || 0,
      finalAmount: subtotal + deliveryFee - (voucherSnapshot?.discountAmount || 0),
      appliedVoucher: voucherSnapshot,
      paymentMethod: body.paymentMethod,
      paymentStatus: "pending",
      orderStatus: "pending",
      reservationReleased: false,
      stockCommitted: false,
      createdAt: now,
      updatedAt: now
    };
    insertedOrderId = order._id;
    try { await db.collection("orders").insertOne(order); }
    catch (error) {
      orderInsertDuplicate = error.code === 11000;
      throw error;
    }
    await db.collection("order_histories").insertOne({ orderId: order._id, oldStatus: null, newStatus: "pending", note: "Order created", createdByUserId: user._id, createdAt: now });
    await db.collection("payments").insertOne({ orderId: order._id, method: body.paymentMethod, status: "pending", amount: order.finalAmount, isMock: true, createdAt: now });
    await db.collection("invoices").insertOne({ orderId: order._id, invoiceCode: `INV-${order.orderCode}`, status: "pending", amount: order.finalAmount, createdAt: now });
    return order;
  } catch (error) {
    const compensationErrors = [];
    const compensate = async (operation) => {
      try { await operation(); }
      catch (compensationError) { compensationErrors.push(compensationError); }
    };
    await compensate(() => releaseReservations(db, reservations));
    if (voucherConsumed) {
      await compensate(() => db.collection("vouchers").updateOne({ _id: voucherId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }));
    }
    if (insertedOrderId) {
      await compensate(() => db.collection("invoices").deleteMany({ orderId: insertedOrderId }));
      await compensate(() => db.collection("payments").deleteMany({ orderId: insertedOrderId }));
      await compensate(() => db.collection("order_histories").deleteMany({ orderId: insertedOrderId }));
      await compensate(() => db.collection("orders").deleteOne({ _id: insertedOrderId }));
    }
    if (compensationErrors.length) throw new AggregateError([error, ...compensationErrors], "Checkout failed and compensation was incomplete");
    if (orderInsertDuplicate && checkoutRequestId) {
      const winner = await db.collection("orders").findOne({ userId: user._id, checkoutRequestId });
      if (winner) return winner;
    }
    throw error;
  }
}

export async function transitionOrder({ db, order, user, status, note = "" }) {
  assertTransition(orderTransitions, order.orderStatus, status);
  if (status === "cancelled" && !order.reservationReleased) {
    const now = new Date();
    const claimed = await db.collection("orders").findOneAndUpdate(
      { _id: order._id, orderStatus: order.orderStatus, reservationReleased: { $ne: true } },
      { $set: { orderStatus: "cancelled", updatedAt: now, lastUpdatedByUserId: user._id } },
      { returnDocument: "after" }
    );
    if (!claimed) throw new HttpError(409, "CONCURRENT_UPDATE", "Order was changed by another request");
    try {
      await releaseReservations(db, order.items.map((item) => ({ storeId: order.storeId, variantId: item.variantId, quantity: item.quantity })));
    } catch (error) {
      await db.collection("orders").updateOne(
        { _id: order._id, orderStatus: "cancelled", reservationReleased: { $ne: true } },
        { $set: { orderStatus: order.orderStatus, updatedAt: new Date(), lastUpdatedByUserId: user._id } }
      );
      throw error;
    }
    const saved = await db.collection("orders").findOneAndUpdate(
      { _id: order._id, orderStatus: "cancelled", reservationReleased: { $ne: true } },
      { $set: { reservationReleased: true, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!saved) throw new HttpError(409, "CONCURRENT_UPDATE", "Order was changed by another request");
    await db.collection("order_histories").insertOne({ orderId: order._id, oldStatus: order.orderStatus, newStatus: status, note, createdByUserId: user._id, createdAt: now });
    return saved;
  }
  if (status === "completed" && !order.stockCommitted) {
    for (const item of order.items) {
      const result = await db.collection("inventories").updateOne({ storeId: order.storeId, variantId: item.variantId, stockQuantity: { $gte: item.quantity }, reservedQuantity: { $gte: item.quantity } }, { $inc: { stockQuantity: -item.quantity, reservedQuantity: -item.quantity, version: 1 }, $set: { updatedAt: new Date() } });
      if (result.modifiedCount !== 1) throw new HttpError(409, "STOCK_COMMIT_FAILED", `Could not commit stock for ${item.sku}`);
    }
  }
  const now = new Date();
  const update = { orderStatus: status, updatedAt: now, lastUpdatedByUserId: user._id };
  if (status === "cancelled") update.reservationReleased = true;
  if (status === "completed") { update.stockCommitted = true; update.paymentStatus = "paid"; }
  const saved = await db.collection("orders").findOneAndUpdate({ _id: order._id, orderStatus: order.orderStatus }, { $set: update }, { returnDocument: "after" });
  if (!saved) throw new HttpError(409, "CONCURRENT_UPDATE", "Order was changed by another request");
  await db.collection("order_histories").insertOne({ orderId: order._id, oldStatus: order.orderStatus, newStatus: status, note, createdByUserId: user._id, createdAt: now });
  if (status === "completed" && !order.stockCommitted) {
    await db.collection("payments").updateOne({ orderId: order._id }, { $set: { status: "paid", paidAt: now, updatedAt: now } });
    await db.collection("invoices").updateOne({ orderId: order._id }, { $set: { status: "issued", issuedAt: now, updatedAt: now } });
    const points = Math.floor(Number(order.finalAmount || 0) / 10000);
    if (points > 0 && !await db.collection("point_histories").findOne({ orderId: order._id, type: "earned" })) {
      await db.collection("memberships").updateOne({ userId: order.userId }, {
        $setOnInsert: { _id: new ObjectId(), userId: order.userId, tier: "bronze", createdAt: now },
        $inc: { pointsBalance: points, lifetimePoints: points },
        $set: { updatedAt: now }
      }, { upsert: true });
      await db.collection("point_histories").insertOne({ _id: new ObjectId(), userId: order.userId, orderId: order._id, type: "earned", points, note: "Points for completed order", createdAt: now });
    }
  }
  return saved;
}
