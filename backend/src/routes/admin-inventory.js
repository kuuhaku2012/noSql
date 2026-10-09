import { Router } from "express";
import { ObjectId } from "mongodb";
import { HttpError, notFound } from "../lib/errors.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serialize(item) {
  return { ...item, id: item._id.toString(), _id: undefined, storeId: item.storeId?.toString(), variantId: item.variantId?.toString() };
}

export function adminInventoryRouter({ db }) {
  const router = Router();
  const inventories = db.collection("inventories");

  router.get("/inventory", authenticate, requireRoles("warehouse", "manager"), async (req, res) => {
    const filter = {};
    if (req.query.storeId) filter.storeId = toReference(req.query.storeId, "storeId");
    if (req.query.variantId) filter.variantId = toReference(req.query.variantId, "variantId");
    const data = (await inventories.find(filter).sort({ updatedAt: -1 }).toArray()).map(serialize);
    res.json({ data, pagination: { page: 1, limit: data.length, total: data.length, totalPages: data.length ? 1 : 0 } });
  });

  router.post("/stock-receipts", authenticate, requireRoles("warehouse", "manager"), async (req, res) => {
    if (!Array.isArray(req.body.items) || !req.body.items.length) throw new HttpError(400, "VALIDATION_ERROR", "items is required");
    const storeId = toReference(req.body.storeId, "storeId");
    if (!await db.collection("stores").findOne({ _id: storeId, isActive: true })) throw notFound("Store not found");
    const results = [];
    const items = await Promise.all(req.body.items.map(async (item) => {
      validateBody({ variantId: { required: true }, quantity: { required: true, type: "positiveInteger" } }, item);
      const variantId = toReference(item.variantId, "variantId");
      if (!await db.collection("product_variants").findOne({ _id: variantId, isActive: true })) throw notFound("Variant not found");
      if (item.unitCost !== undefined && (typeof item.unitCost !== "number" || !Number.isFinite(item.unitCost) || item.unitCost < 0)) throw new HttpError(400, "VALIDATION_ERROR", "unitCost must be a non-negative number");
      return { ...item, variantId };
    }));
    for (const item of items) {
      const now = new Date();
      const inventory = await inventories.findOneAndUpdate({ storeId, variantId: item.variantId }, { $setOnInsert: { _id: new ObjectId(), storeId, variantId: item.variantId, reservedQuantity: 0, createdAt: now }, $inc: { stockQuantity: item.quantity, version: 1 }, $set: { updatedAt: now } }, { upsert: true, returnDocument: "after" });
      await db.collection("inventory_logs").insertOne({ inventoryId: inventory._id, storeId, variantId: item.variantId, changeType: "receipt", quantityChanged: item.quantity, unitCost: item.unitCost ?? null, note: item.note || "", createdAt: now, createdByUserId: req.user._id });
      results.push(serialize(inventory));
    }
    res.status(201).json({ data: results.length === 1 ? results[0] : results });
  });

  router.post("/stock-adjustments", authenticate, requireRoles("warehouse", "manager"), async (req, res) => {
    validateBody({ storeId: { required: true }, variantId: { required: true } }, req.body);
    const quantity = Number(req.body.quantity);
    if (!Number.isInteger(quantity) || quantity === 0) throw new HttpError(400, "VALIDATION_ERROR", "quantity must be a non-zero integer");
    const storeId = toReference(req.body.storeId, "storeId");
    const variantId = toReference(req.body.variantId, "variantId");
    const current = await inventories.findOne({ storeId, variantId });
    if (!current) throw notFound("Inventory row not found");
    const now = new Date();
    const updated = await inventories.findOneAndUpdate({ _id: current._id, $expr: { $gte: [{ $add: ["$stockQuantity", quantity] }, "$reservedQuantity"] } }, { $inc: { stockQuantity: quantity, version: 1 }, $set: { updatedAt: now } }, { returnDocument: "after" });
    if (!updated) throw new HttpError(409, "STOCK_NEGATIVE", "Adjustment would make stock lower than reserved quantity");
    await db.collection("inventory_logs").insertOne({ inventoryId: updated._id, storeId, variantId, changeType: "adjustment", quantityChanged: quantity, note: req.body.note || "", createdAt: now, createdByUserId: req.user._id });
    res.status(201).json({ data: serialize(updated) });
  });
  return router;
}
