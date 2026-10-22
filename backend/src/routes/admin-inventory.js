import { Router } from "express";
import { ObjectId } from "mongodb";
import { HttpError, notFound } from "../lib/errors.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serialize(item) {
  return { ...item, id: item._id.toString(), _id: undefined, storeId: item.storeId?.toString(), variantId: item.variantId?.toString() };
}

async function syncAvailability(db, variantId) {
  const variants = db.collection("product_variants");
  const products = db.collection("products");
  const inventories = db.collection("inventories");
  const variant = await variants.findOne({ _id: variantId }, { projection: { productId: 1 } });
  if (!variant) return;

  const rows = await inventories.find({ variantId }, { projection: { stockQuantity: 1, reservedQuantity: 1 } }).toArray();
  const available = rows.reduce((total, row) => total + Math.max(0, Number(row.stockQuantity || 0) - Number(row.reservedQuantity || 0)), 0);
  const now = new Date();
  if (available <= 0) {
    await variants.updateOne(
      { _id: variantId, isActive: true },
      { $set: { isActive: false, stockAutoDisabled: true, updatedAt: now } }
    );
  } else {
    await variants.updateOne(
      { _id: variantId, stockAutoDisabled: true },
      { $set: { isActive: true, updatedAt: now }, $unset: { stockAutoDisabled: "" } }
    );
  }

  const productVariants = await variants.find({ productId: variant.productId }, { projection: { _id: 1 } }).toArray();
  const productRows = productVariants.length
    ? await inventories.find({ variantId: { $in: productVariants.map((item) => item._id) } }, { projection: { variantId: 1, stockQuantity: 1, reservedQuantity: 1 } }).toArray()
    : [];
  const availableByVariant = new Map();
  for (const row of productRows) {
    const key = String(row.variantId);
    availableByVariant.set(key, (availableByVariant.get(key) || 0) + Math.max(0, Number(row.stockQuantity || 0) - Number(row.reservedQuantity || 0)));
  }
  const hasAvailableVariant = productVariants.some((item) => (availableByVariant.get(String(item._id)) || 0) > 0);
  if (!hasAvailableVariant) {
    await products.updateOne(
      { _id: variant.productId, isActive: true },
      { $set: { isActive: false, stockAutoDisabled: true, updatedAt: now } }
    );
  } else {
    await products.updateOne(
      { _id: variant.productId, stockAutoDisabled: true },
      { $set: { isActive: true, updatedAt: now }, $unset: { stockAutoDisabled: "" } }
    );
  }
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
      if (!await db.collection("product_variants").findOne({ _id: variantId, $or: [{ isActive: true }, { stockAutoDisabled: true }] })) throw notFound("Variant not found");
      if (item.unitCost !== undefined && (typeof item.unitCost !== "number" || !Number.isFinite(item.unitCost) || item.unitCost < 0)) throw new HttpError(400, "VALIDATION_ERROR", "unitCost must be a non-negative number");
      return { ...item, variantId };
    }));
    for (const item of items) {
      const now = new Date();
      const inventory = await inventories.findOneAndUpdate({ storeId, variantId: item.variantId }, { $setOnInsert: { _id: new ObjectId(), storeId, variantId: item.variantId, reservedQuantity: 0, createdAt: now }, $inc: { stockQuantity: item.quantity, version: 1 }, $set: { updatedAt: now } }, { upsert: true, returnDocument: "after" });
      await db.collection("inventory_logs").insertOne({ inventoryId: inventory._id, storeId, variantId: item.variantId, changeType: "receipt", quantityChanged: item.quantity, unitCost: item.unitCost ?? null, note: item.note || "", createdAt: now, createdByUserId: req.user._id });
      await syncAvailability(db, item.variantId);
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
    await syncAvailability(db, variantId);
    res.status(201).json({ data: serialize(updated) });
  });
  return router;
}
