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

function checkoutInProgress() {
  return new HttpError(409, "CHECKOUT_IN_PROGRESS", "Checkout is still being processed; retry the same request shortly");
}

async function isCheckoutComplete(db, order) {
  if (Object.hasOwn(order, "checkoutComplete")) return order.checkoutComplete === true;
  const artifacts = await Promise.all(["order_histories", "payments", "invoices"].map(
    (collection) => db.collection(collection).findOne({ orderId: order._id })
  ));
  return artifacts.every(Boolean);
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
    if (existing && await isCheckoutComplete(db, existing)) return existing;
    if (existing) throw checkoutInProgress();
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
      checkoutComplete: false,
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
    const completion = await db.collection("orders").updateOne(
      { _id: order._id, checkoutComplete: false },
      { $set: { checkoutComplete: true } }
    );
    if (completion.modifiedCount !== 1) throw new Error("Checkout completion marker could not be persisted");
    order.checkoutComplete = true;
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
      if (winner && await isCheckoutComplete(db, winner)) return winner;
      if (winner) throw checkoutInProgress();
    }
    throw error;
  }
}

async function completeOrderTransition({ db, order, user, note, now, stockAlreadyCommitted = false }) {
  const completionClaim = new ObjectId();
  const orders = db.collection("orders");
  let claimed;
  try {
    claimed = await orders.findOneAndUpdate(
      {
        _id: order._id,
        orderStatus: order.orderStatus,
        stockCommitted: stockAlreadyCommitted ? true : { $ne: true },
        stockCommitClaim: { $exists: false },
        paymentOperationClaim: { $exists: false }
      },
      { $set: { stockCommitClaim: completionClaim } },
      { returnDocument: "after" }
    );
  } catch (error) {
    // A network timeout can happen after MongoDB applied findOneAndUpdate.
    claimed = await orders.findOne({ _id: order._id, stockCommitClaim: completionClaim });
    if (!claimed) throw error;
  }
  if (!claimed) throw new HttpError(409, "CONCURRENT_UPDATE", "Order was changed by another request");
  // The caller may have loaded a stale order before a mock payment completed.
  // Use the locked document as the compensation snapshot so rollback preserves
  // the latest payment state that existed when this completion claimed it.
  const orderSnapshot = claimed;

  const attemptedItems = [];
  const completionHistoryId = new ObjectId();
  const pointHistoryId = new ObjectId();
  let paymentSnapshot;
  let invoiceSnapshot;
  let paymentUpdateAttempted = false;
  let invoiceUpdateAttempted = false;
  let membershipUpdateAttempted = false;
  let orderCompletionAttempted = false;
  let finalClaimReleaseAttempted = false;
  let finalClaimReleaseStateConfirmed = false;
  let loyaltyPoints = 0;
  let saved;
  const clearCompletionMarkers = async () => {
    const results = await Promise.allSettled([
      db.collection("inventories").updateMany({ stockCommitClaims: completionClaim }, { $pull: { stockCommitClaims: completionClaim } }),
      db.collection("memberships").updateOne({ userId: order.userId, completionClaims: completionClaim }, { $pull: { completionClaims: completionClaim } }),
      db.collection("payments").updateOne({ orderId: order._id, completionClaim }, { $unset: { completionClaim: "" } }),
      db.collection("invoices").updateOne({ orderId: order._id, completionClaim }, { $unset: { completionClaim: "" } })
    ]);
    for (const result of results) {
      if (result.status === "rejected") console.error("Order completion committed but a transient marker could not be cleared", result.reason);
    }
  };

  try {
    [paymentSnapshot, invoiceSnapshot] = await Promise.all([
      db.collection("payments").findOne({ orderId: order._id }),
      db.collection("invoices").findOne({ orderId: order._id })
    ]);
    if (!paymentSnapshot || !invoiceSnapshot) {
      throw new HttpError(409, "ORDER_ARTIFACTS_MISSING", "Order payment or invoice record is missing");
    }
    if (stockAlreadyCommitted && (
      claimed.paymentStatus !== "paid" || paymentSnapshot.status !== "paid" || invoiceSnapshot.status !== "issued"
    )) {
      throw new HttpError(409, "ORDER_ARTIFACTS_INCOMPLETE", "Stock-committed legacy order needs payment and invoice reconciliation before completion");
    }

    if (!stockAlreadyCommitted) {
      for (const item of order.items) {
        attemptedItems.push(item);
        const result = await db.collection("inventories").updateOne(
          { storeId: order.storeId, variantId: item.variantId, stockQuantity: { $gte: item.quantity }, reservedQuantity: { $gte: item.quantity } },
          {
            $inc: { stockQuantity: -item.quantity, reservedQuantity: -item.quantity, version: 1 },
            $addToSet: { stockCommitClaims: completionClaim },
            $set: { updatedAt: new Date() }
          }
        );
        if (result.modifiedCount !== 1) throw new HttpError(409, "STOCK_COMMIT_FAILED", `Could not commit stock for ${item.sku}`);
      }
    }

    orderCompletionAttempted = true;
    saved = await db.collection("orders").findOneAndUpdate(
      { _id: order._id, orderStatus: order.orderStatus, stockCommitClaim: completionClaim },
      { $set: { orderStatus: "completed", stockCommitted: true, paymentStatus: "paid", updatedAt: now, lastUpdatedByUserId: user._id } },
      { returnDocument: "after" }
    );
    if (!saved) throw new HttpError(409, "CONCURRENT_UPDATE", "Order was changed by another request");

    await db.collection("order_histories").insertOne({
      _id: completionHistoryId,
      orderId: order._id,
      oldStatus: order.orderStatus,
      newStatus: "completed",
      note,
      createdByUserId: user._id,
      createdAt: now
    });

    paymentUpdateAttempted = true;
    const paymentUpdate = await db.collection("payments").updateOne(
      { orderId: order._id },
      { $set: { status: "paid", paidAt: now, updatedAt: now, completionClaim } }
    );
    if (paymentUpdate.matchedCount !== 1) throw new HttpError(409, "ORDER_ARTIFACTS_MISSING", "Order payment record is missing");
    invoiceUpdateAttempted = true;
    const invoiceUpdate = await db.collection("invoices").updateOne(
      { orderId: order._id },
      { $set: { status: "issued", issuedAt: now, updatedAt: now, completionClaim } }
    );
    if (invoiceUpdate.matchedCount !== 1) throw new HttpError(409, "ORDER_ARTIFACTS_MISSING", "Order invoice record is missing");

    const loyaltyAmount = order.subtotal == null
      ? Number(order.finalAmount || 0) - Number(order.deliveryFee || 0)
      : Number(order.subtotal) - Number(order.discountAmount || 0);
    loyaltyPoints = Math.floor(Math.max(0, loyaltyAmount) / 10000);
    if (loyaltyPoints > 0 && !await db.collection("point_histories").findOne({ orderId: order._id, type: "earned" })) {
      membershipUpdateAttempted = true;
      const membershipUpdate = await db.collection("memberships").updateOne({ userId: order.userId }, {
        $setOnInsert: { _id: new ObjectId(), userId: order.userId, tier: "bronze", createdAt: now },
        $inc: { pointsBalance: loyaltyPoints, lifetimePoints: loyaltyPoints },
        $addToSet: { completionClaims: completionClaim },
        $set: { updatedAt: now }
      }, { upsert: true });
      if (membershipUpdate.matchedCount !== 1 && membershipUpdate.upsertedCount !== 1) throw new Error("Could not award loyalty points");
      await db.collection("point_histories").insertOne({
        _id: pointHistoryId,
        userId: order.userId,
        orderId: order._id,
        type: "earned",
        points: loyaltyPoints,
        note: "Points for completed order",
        createdAt: now
      });
    } else {
      loyaltyPoints = 0;
    }

    finalClaimReleaseAttempted = true;
    try {
      saved = await db.collection("orders").findOneAndUpdate(
        { _id: order._id, orderStatus: "completed", stockCommitClaim: completionClaim },
        { $unset: { stockCommitClaim: "" } },
        { returnDocument: "after" }
      );
      if (!saved) {
        saved = await orders.findOne({ _id: order._id, orderStatus: "completed", stockCommitted: true, stockCommitClaim: { $exists: false } });
        finalClaimReleaseStateConfirmed = true;
      }
      if (!saved) throw new HttpError(409, "CONCURRENT_UPDATE", "Order was changed by another request");
      finalClaimReleaseStateConfirmed = true;
    } catch (error) {
      const persisted = await orders.findOne({
        _id: order._id,
        orderStatus: "completed",
        stockCommitted: true,
        stockCommitClaim: { $exists: false }
      });
      finalClaimReleaseStateConfirmed = true;
      if (!persisted) throw error;
      saved = persisted;
    }

    // The order is now committed. Marker cleanup is deliberately outside the
    // compensation block: a cleanup ACK loss must never undo committed stock.
    await clearCompletionMarkers();
    return saved;
  } catch (error) {
    const compensationErrors = [];
    const compensate = async (operation) => {
      try {
        return await operation();
      } catch (compensationError) {
        compensationErrors.push(compensationError);
        return undefined;
      }
    };
    const deleteIfPresent = async (collectionName, filter, description) => {
      const collection = db.collection(collectionName);
      try {
        const result = await collection.deleteOne(filter);
        if (result.deletedCount === 1) return;
        if (!await collection.findOne(filter)) return;
        throw new Error(`Could not remove ${description}`);
      } catch (deleteError) {
        if (!await collection.findOne(filter)) return;
        throw deleteError;
      }
    };
    const restoreMarkedSnapshot = async (collectionName, snapshot, markerField, description) => {
      const collection = db.collection(collectionName);
      const filter = { _id: snapshot._id, [markerField]: completionClaim };
      if (!await collection.findOne(filter)) return;
      try {
        const restored = await collection.replaceOne(filter, snapshot);
        if (restored.matchedCount === 1) return;
      } catch (restoreError) {
        if (!await collection.findOne(filter)) return;
        throw restoreError;
      }
      if (await collection.findOne(filter)) throw new Error(`Could not restore ${description}`);
    };

    if (finalClaimReleaseAttempted && !finalClaimReleaseStateConfirmed) {
      throw new AggregateError([error, ...compensationErrors], "Final order completion acknowledgement is ambiguous; inspect the order before retrying");
    }

    if (finalClaimReleaseAttempted) {
      const persisted = await compensate(async () => orders.findOne({
        _id: order._id,
        orderStatus: "completed",
        stockCommitted: true,
        stockCommitClaim: { $exists: false }
      }));
      if (persisted) {
        await clearCompletionMarkers();
        return persisted;
      }
    }

    if (membershipUpdateAttempted) {
      await compensate(() => deleteIfPresent("point_histories", { _id: pointHistoryId }, "loyalty point history"));
      await compensate(async () => {
        const membership = await db.collection("memberships").findOne({ userId: order.userId, completionClaims: completionClaim });
        if (!membership) return;
        try {
          const restored = await db.collection("memberships").updateOne(
            { userId: order.userId, completionClaims: completionClaim },
            {
              $inc: { pointsBalance: -loyaltyPoints, lifetimePoints: -loyaltyPoints },
              $pull: { completionClaims: completionClaim },
              $set: { updatedAt: new Date() }
            }
          );
          if (restored.modifiedCount === 1) return;
        } catch (restoreError) {
          const markerRemains = await db.collection("memberships").findOne({ userId: order.userId, completionClaims: completionClaim });
          if (!markerRemains) return;
          throw restoreError;
        }
        const markerRemains = await db.collection("memberships").findOne({ userId: order.userId, completionClaims: completionClaim });
        if (markerRemains) throw new Error("Could not restore membership points");
      });
    }

    await compensate(() => deleteIfPresent("order_histories", { _id: completionHistoryId }, "completion history"));
    if (invoiceUpdateAttempted && invoiceSnapshot) {
      await compensate(() => restoreMarkedSnapshot("invoices", invoiceSnapshot, "completionClaim", "invoice snapshot"));
    }
    if (paymentUpdateAttempted && paymentSnapshot) {
      await compensate(() => restoreMarkedSnapshot("payments", paymentSnapshot, "completionClaim", "payment snapshot"));
    }

    if (orderCompletionAttempted) await compensate(async () => {
      const set = { orderStatus: orderSnapshot.orderStatus };
      const unset = {};
      for (const field of ["stockCommitted", "paymentStatus", "updatedAt", "lastUpdatedByUserId"]) {
        if (Object.hasOwn(orderSnapshot, field)) set[field] = orderSnapshot[field];
        else unset[field] = "";
      }
      const update = { $set: set, $unset: { ...unset } };
      try {
        const restored = await db.collection("orders").updateOne(
          { _id: order._id, stockCommitClaim: completionClaim },
          update
        );
        if (restored.matchedCount === 1) return;
      } catch (restoreError) {
        const current = await orders.findOne({ _id: order._id, stockCommitClaim: completionClaim });
        if (current?.orderStatus === order.orderStatus) return;
        throw restoreError;
      }
      const current = await orders.findOne({ _id: order._id, stockCommitClaim: completionClaim });
      if (current?.orderStatus !== order.orderStatus) throw new Error("Could not restore the order completion state");
    });

    const committedItems = [];
    for (const item of attemptedItems) {
      await compensate(async () => {
        const inventory = await db.collection("inventories").findOne({
          storeId: order.storeId,
          variantId: item.variantId,
          stockCommitClaims: completionClaim
        });
        if (inventory) committedItems.push(item);
      });
    }
    for (const item of committedItems.reverse()) {
      await compensate(async () => {
        try {
          const restored = await db.collection("inventories").updateOne(
            { storeId: order.storeId, variantId: item.variantId, stockCommitClaims: completionClaim },
            {
              $inc: { stockQuantity: item.quantity, reservedQuantity: item.quantity, version: 1 },
              $pull: { stockCommitClaims: completionClaim },
              $set: { updatedAt: new Date() }
            }
          );
          if (restored.modifiedCount === 1) return;
        } catch (restoreError) {
          const markerRemains = await db.collection("inventories").findOne({ storeId: order.storeId, variantId: item.variantId, stockCommitClaims: completionClaim });
          if (!markerRemains) return;
          throw restoreError;
        }
        const markerRemains = await db.collection("inventories").findOne({ storeId: order.storeId, variantId: item.variantId, stockCommitClaims: completionClaim });
        if (markerRemains) throw new Error(`Could not restore stock for ${item.sku}`);
      });
    }

    if (compensationErrors.length === 0) {
      await compensate(async () => {
        try {
          const released = await db.collection("orders").updateOne(
            { _id: order._id, stockCommitClaim: completionClaim },
            { $unset: { stockCommitClaim: "" } }
          );
          if (released.matchedCount === 1) return;
        } catch (releaseError) {
          const stillClaimed = await orders.findOne({ _id: order._id, stockCommitClaim: completionClaim });
          if (!stillClaimed) return;
          throw releaseError;
        }
        if (await orders.findOne({ _id: order._id, stockCommitClaim: completionClaim })) {
          throw new Error("Could not release the order completion claim");
        }
      });
    }
    if (compensationErrors.length) throw new AggregateError([error, ...compensationErrors], "Order completion failed and compensation was incomplete");
    throw error;
  }
}

export async function transitionOrder({ db, order, user, status, note = "" }) {
  assertTransition(orderTransitions, order.orderStatus, status);
  if (status === "cancelled" && !order.reservationReleased) {
    const now = new Date();
    const claimed = await db.collection("orders").findOneAndUpdate(
      { _id: order._id, orderStatus: order.orderStatus, reservationReleased: { $ne: true }, stockCommitClaim: { $exists: false }, paymentOperationClaim: { $exists: false } },
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
  const now = new Date();
  if (status === "completed") {
    return completeOrderTransition({ db, order, user, note, now, stockAlreadyCommitted: order.stockCommitted === true });
  }

  const update = { orderStatus: status, updatedAt: now, lastUpdatedByUserId: user._id };
  if (status === "cancelled") update.reservationReleased = true;
  if (status === "completed") { update.stockCommitted = true; update.paymentStatus = "paid"; }
  const saved = await db.collection("orders").findOneAndUpdate(
    { _id: order._id, orderStatus: order.orderStatus, stockCommitClaim: { $exists: false }, paymentOperationClaim: { $exists: false } },
    { $set: update },
    { returnDocument: "after" }
  );
  if (!saved) throw new HttpError(409, "CONCURRENT_UPDATE", "Order was changed by another request");
  await db.collection("order_histories").insertOne({ orderId: order._id, oldStatus: order.orderStatus, newStatus: status, note, createdByUserId: user._id, createdAt: now });
  return saved;
}
