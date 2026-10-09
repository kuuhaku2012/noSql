import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { isDateRangeActive, inclusiveEndDate } from "../lib/dates.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serialize(sale) {
  return { ...sale, id: String(sale._id), _id: undefined, createdByUserId: sale.createdByUserId ? String(sale.createdByUserId) : undefined, items: (sale.items || []).map((item) => ({ ...item, variantId: String(item.variantId) })) };
}

function parseDates(input, current = {}) {
  const startDate = input.startDate === undefined ? new Date(current.startDate) : new Date(input.startDate);
  const endDate = inclusiveEndDate(input.endDate === undefined ? new Date(current.endDate) : input.endDate);
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf()) || endDate <= startDate) throw new HttpError(400, "VALIDATION_ERROR", "Flash sale dates are invalid");
  return { startDate, endDate };
}

async function normalizeItems(db, items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, "VALIDATION_ERROR", "items must be a non-empty array");
  const normalized = items.map((item) => {
    validateBody({ variantId: { required: true }, promotionPrice: { required: true, type: "nonNegativeNumber" }, quantityLimit: { required: true, type: "positiveInteger" } }, item);
    if (item.maxQuantityPerUser !== undefined && (!Number.isInteger(item.maxQuantityPerUser) || item.maxQuantityPerUser <= 0)) throw new HttpError(400, "VALIDATION_ERROR", "maxQuantityPerUser must be a positive integer");
    return { variantId: toReference(item.variantId, "variantId"), promotionPrice: item.promotionPrice, quantityLimit: item.quantityLimit, soldQuantity: item.soldQuantity || 0, maxQuantityPerUser: item.maxQuantityPerUser || null };
  });
  if (new Set(normalized.map((item) => String(item.variantId))).size !== normalized.length) throw new HttpError(409, "DUPLICATE_FLASH_SALE_ITEM", "A variant may appear only once in a flash sale");
  const variants = await db.collection("product_variants").find({ _id: { $in: normalized.map((item) => item.variantId) }, isActive: true }).toArray();
  if (variants.length !== normalized.length) throw notFound("One or more variants were not found");
  const byId = new Map(variants.map((variant) => [String(variant._id), variant]));
  for (const item of normalized) if (item.promotionPrice >= Number(byId.get(String(item.variantId)).retailPrice)) throw new HttpError(400, "INVALID_FLASH_SALE_PRICE", "Flash sale price must be lower than retail price");
  return normalized;
}

export function flashSalesRouter({ db }) {
  const router = Router();
  const flashSales = db.collection("flash_sales");

  router.get("/flash-sales", async (req, res) => {
    const now = new Date();
    const candidates = await flashSales.find({ isActive: true, startDate: { $lte: now }, endDate: { $gte: now } }).sort({ startDate: 1 }).toArray();
    const data = candidates.filter((sale) => isDateRangeActive(sale.startDate, sale.endDate, now)).map(serialize);
    res.json({ data, pagination: { page: 1, limit: data.length, total: data.length, totalPages: data.length ? 1 : 0 } });
  });

  router.use("/admin/flash-sales", authenticate, requireRoles("manager"));
  router.get("/admin/flash-sales", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const [items, total] = await Promise.all([flashSales.find({}).sort({ startDate: -1 }).skip(skip).limit(limit).toArray(), flashSales.countDocuments({})]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.get("/admin/flash-sales/:id", async (req, res) => {
    const sale = await flashSales.findOne({ _id: toReference(req.params.id, "id") });
    if (!sale) throw notFound("Flash sale not found");
    res.json({ data: serialize(sale) });
  });

  router.post("/admin/flash-sales", async (req, res) => {
    validateBody({ name: { required: true, type: "string" }, startDate: { required: true, type: "string" }, endDate: { required: true, type: "string" } }, req.body);
    if (!req.body.name.trim()) throw new HttpError(400, "VALIDATION_ERROR", "Flash sale name cannot be empty");
    const { startDate, endDate } = parseDates(req.body);
    const items = await normalizeItems(db, req.body.items);
    const now = new Date();
    const sale = { _id: new ObjectId(), name: req.body.name.trim(), startDate, endDate, isActive: req.body.isActive !== false, items, createdAt: now, updatedAt: now, createdByUserId: req.user._id };
    await flashSales.insertOne(sale);
    res.status(201).json({ data: serialize(sale) });
  });

  router.patch("/admin/flash-sales/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const current = await flashSales.findOne({ _id: id });
    if (!current) throw notFound("Flash sale not found");
    const update = { updatedAt: new Date() };
    if (req.body.name !== undefined) {
      if (typeof req.body.name !== "string" || !req.body.name.trim()) throw new HttpError(400, "VALIDATION_ERROR", "Flash sale name cannot be empty");
      update.name = req.body.name.trim();
    }
    if (req.body.startDate !== undefined || req.body.endDate !== undefined) Object.assign(update, parseDates(req.body, current));
    if (req.body.items !== undefined) update.items = await normalizeItems(db, req.body.items);
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
      update.isActive = req.body.isActive;
    }
    const saved = await flashSales.findOneAndUpdate({ _id: id }, { $set: update }, { returnDocument: "after" });
    res.json({ data: serialize(saved) });
  });

  router.delete("/admin/flash-sales/:id", async (req, res) => {
    const saved = await flashSales.findOneAndUpdate({ _id: toReference(req.params.id, "id") }, { $set: { isActive: false, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!saved) throw notFound("Flash sale not found");
    res.json({ data: serialize(saved) });
  });

  return router;
}
