import { Router } from "express";
import { ObjectId } from "mongodb";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { assertTransition, returnTransitions } from "../lib/status.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serialize(item) {
  return { ...item, id: item._id.toString(), _id: undefined, orderId: item.orderId?.toString(), userId: item.userId?.toString() };
}

async function restockReceivedReturn(db, record, actorId) {
  const order = await db.collection("orders").findOne({ _id: record.orderId });
  if (!order?.storeId) throw new HttpError(409, "RETURN_STOCK_UNAVAILABLE", "The order has no store inventory reference");
  const itemsByVariant = new Map();
  for (const item of record.items || []) {
    const key = String(item.variantId);
    const existing = itemsByVariant.get(key);
    if (existing) existing.quantity += item.quantity;
    else itemsByVariant.set(key, { variantId: item.variantId, quantity: item.quantity });
  }
  for (const item of itemsByVariant.values()) {
    const now = new Date();
    const filter = { storeId: order.storeId, variantId: item.variantId, receivedReturnIds: { $ne: record._id } };
    const result = await db.collection("inventories").updateOne(filter, {
      $inc: { stockQuantity: item.quantity, version: 1 },
      $addToSet: { receivedReturnIds: record._id },
      $set: { updatedAt: now }
    });
    if (!result.matchedCount) {
      const current = await db.collection("inventories").findOne({ storeId: order.storeId, variantId: item.variantId });
      if (current?.receivedReturnIds?.some((returnId) => String(returnId) === String(record._id))) {
        const logs = db.collection("inventory_logs");
        const existingLog = await logs.findOne({ returnId: record._id, variantId: item.variantId });
        if (!existingLog) {
          await logs.insertOne({ inventoryId: current._id, storeId: order.storeId, variantId: item.variantId, changeType: "return", quantityChanged: item.quantity, returnId: record._id, note: `Restock received return ${record._id}`, createdAt: now, createdByUserId: actorId });
        }
        continue;
      }
      throw new HttpError(409, "RETURN_STOCK_UNAVAILABLE", "Inventory row not found for the returned item");
    }
    if (result.modifiedCount) {
      const inventory = await db.collection("inventories").findOne({ storeId: order.storeId, variantId: item.variantId });
      await db.collection("inventory_logs").insertOne({ inventoryId: inventory._id, storeId: order.storeId, variantId: item.variantId, changeType: "return", quantityChanged: item.quantity, returnId: record._id, note: `Restock received return ${record._id}`, createdAt: now, createdByUserId: actorId });
    }
  }
}

export function adminReturnsRouter({ db }) {
  const router = Router();
  const returns = db.collection("returns");
  router.use(authenticate, requireRoles("sales", "manager"));
  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const [items, total] = await Promise.all([
      returns.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      returns.countDocuments({})
    ]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });
  router.post("/", async (req, res) => {
    validateBody({ orderId: { required: true }, reason: { required: true, type: "string" } }, req.body);
    const orderId = toReference(req.body.orderId, "orderId");
    const order = await db.collection("orders").findOne({ _id: orderId });
    if (!order) throw notFound("Order not found");
    if (!["delivered", "completed"].includes(order.orderStatus)) throw new HttpError(409, "ORDER_NOT_RETURNABLE", "Only delivered or completed orders can be returned");
    if (!Array.isArray(req.body.items)) throw new HttpError(400, "VALIDATION_ERROR", "items must be an array");
    const earlier = await returns.find({ orderId, status: { $ne: "rejected" } }).toArray();
    const returned = new Map();
    for (const record of earlier) for (const item of record.items || []) {
      const key = String(item.variantId);
      returned.set(key, (returned.get(key) || 0) + Number(item.quantity || 0));
    }
    const requested = new Map();
    const itemList = req.body.items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new HttpError(400, "VALIDATION_ERROR", "Each return item must be an object");
      const variantId = toReference(item.variantId, "variantId");
      const quantity = Number(item.quantity);
      const key = String(variantId);
      const purchased = (order.items || []).find((orderItem) => String(orderItem.variantId) === String(variantId));
      const total = (requested.get(key) || 0) + quantity;
      if (!purchased || !Number.isInteger(quantity) || quantity <= 0 || total + (returned.get(key) || 0) > Number(purchased.quantity)) throw new HttpError(409, "RETURN_ITEM_INVALID", "Return item is not present in the order or exceeds unreturned quantity");
      requested.set(key, total);
      return { ...item, variantId, quantity };
    });
    if (!itemList.length || itemList.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) throw new HttpError(400, "VALIDATION_ERROR", "At least one valid return item is required");
    const now = new Date();
    const record = { _id: new ObjectId(), orderId, userId: order.userId || null, reason: req.body.reason.trim(), items: itemList, status: "requested", history: [{ status: "requested", userId: req.user._id, createdAt: now }], createdByUserId: req.user._id, createdAt: now, updatedAt: now };
    await returns.insertOne(record);
    res.status(201).json({ data: serialize(record) });
  });
  router.patch("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const record = await returns.findOne({ _id: id });
    if (!record) throw notFound("Return not found");
    if (!req.body.status) throw new HttpError(400, "VALIDATION_ERROR", "status is required");
    if (record.status === "received" && req.body.status === "received") {
      await restockReceivedReturn(db, record, req.user._id);
      res.json({ data: serialize(record) });
      return;
    }
    assertTransition(returnTransitions, record.status, req.body.status);
    const update = { status: req.body.status, updatedAt: new Date() };
    if (req.body.note !== undefined) update.note = String(req.body.note);
    if (req.body.refundAmount !== undefined) {
      if (typeof req.body.refundAmount !== "number" || !Number.isFinite(req.body.refundAmount) || req.body.refundAmount < 0) throw new HttpError(400, "VALIDATION_ERROR", "refundAmount must be a non-negative number");
      update.refundAmount = req.body.refundAmount;
    }
    update.history = [...(record.history || []), { status: req.body.status, userId: req.user._id, createdAt: new Date(), note: req.body.note || "" }];
    const saved = await returns.findOneAndUpdate({ _id: id, status: record.status }, { $set: update }, { returnDocument: "after" });
    if (!saved) throw new HttpError(409, "CONCURRENT_UPDATE", "Return was changed by another request");
    if (req.body.status === "received") await restockReceivedReturn(db, saved, req.user._id);
    res.json({ data: serialize(saved) });
  });
  return router;
}
