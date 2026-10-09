import { Router } from "express";
import { ObjectId } from "mongodb";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference, validateBody } from "../lib/validation.js";
import { inclusiveEndDate } from "../lib/dates.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serialize(item) {
  return { ...item, id: item._id.toString(), _id: undefined, createdByUserId: item.createdByUserId?.toString() };
}

function parseDateRange(input, current = {}) {
  const startDate = input.startDate === undefined ? new Date(current.startDate) : new Date(input.startDate);
  const endDate = inclusiveEndDate(input.endDate === undefined ? new Date(current.endDate) : input.endDate);
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf()) || endDate <= startDate) throw new HttpError(400, "VALIDATION_ERROR", "Promotion dates are invalid");
  return { startDate, endDate };
}

async function normalizeItems(db, items) {
  if (items === undefined) return undefined;
  if (!Array.isArray(items)) throw new HttpError(400, "VALIDATION_ERROR", "items must be an array");
  const normalized = items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new HttpError(400, "VALIDATION_ERROR", "Each promotion item must be an object");
    validateBody({ variantId: { required: true }, promotionPrice: { required: true, type: "nonNegativeNumber" } }, item);
    return { ...item, variantId: toReference(item.variantId, "variantId"), promotionPrice: item.promotionPrice };
  });
  const ids = normalized.map((item) => item.variantId);
  if (new Set(ids.map(String)).size !== ids.length) throw new HttpError(409, "DUPLICATE_PROMOTION_ITEM", "A variant may appear only once in a promotion");
  if (ids.length) {
    const variants = await db.collection("product_variants").find({ _id: { $in: ids }, isActive: true }).toArray();
    if (variants.length !== ids.length) throw new HttpError(404, "VARIANT_NOT_FOUND", "One or more promotion variants were not found");
    const byId = new Map(variants.map((variant) => [String(variant._id), variant]));
    if (normalized.some((item) => item.promotionPrice >= Number(byId.get(String(item.variantId)).retailPrice))) {
      throw new HttpError(400, "INVALID_PROMOTION_PRICE", "Promotion price must be lower than retail price");
    }
  }
  return normalized;
}

export function adminPromotionsRouter({ db }) {
  const router = Router();
  const promotions = db.collection("promotions");
  router.use(authenticate, requireRoles("sales", "manager"));
  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const [items, total] = await Promise.all([
      promotions.find({}).sort({ startDate: -1 }).skip(skip).limit(limit).toArray(),
      promotions.countDocuments({})
    ]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });
  router.get("/:id", async (req, res) => {
    const promotion = await promotions.findOne({ _id: toReference(req.params.id, "id") });
    if (!promotion) throw notFound("Promotion not found");
    res.json({ data: serialize(promotion) });
  });
  router.post("/", async (req, res) => {
    validateBody({ name: { required: true, type: "string" }, startDate: { required: true, type: "string" }, endDate: { required: true, type: "string" } }, req.body);
    if (!req.body.name.trim()) throw new HttpError(400, "VALIDATION_ERROR", "Promotion name cannot be empty");
    if (req.body.isActive !== undefined && typeof req.body.isActive !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
    const { startDate, endDate } = parseDateRange(req.body);
    const items = (await normalizeItems(db, req.body.items)) || [];
    const promotion = { _id: new ObjectId(), name: req.body.name.trim(), startDate, endDate, isActive: req.body.isActive !== false, items, createdAt: new Date(), updatedAt: new Date(), createdByUserId: req.user._id };
    await promotions.insertOne(promotion);
    res.status(201).json({ data: serialize(promotion) });
  });
  router.patch("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const current = await promotions.findOne({ _id: id });
    if (!current) throw notFound("Promotion not found");
    const update = { updatedAt: new Date() };
    if (req.body.name !== undefined) {
      if (typeof req.body.name !== "string" || !req.body.name.trim()) throw new HttpError(400, "VALIDATION_ERROR", "Promotion name cannot be empty");
      update.name = req.body.name.trim();
    }
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
      update.isActive = req.body.isActive;
    }
    if (req.body.startDate !== undefined || req.body.endDate !== undefined) Object.assign(update, parseDateRange(req.body, current));
    if (req.body.items !== undefined) update.items = await normalizeItems(db, req.body.items);
    const saved = await promotions.findOneAndUpdate({ _id: id }, { $set: update }, { returnDocument: "after" });
    res.json({ data: serialize(saved) });
  });
  router.delete("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const saved = await promotions.findOneAndUpdate({ _id: id }, { $set: { isActive: false, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!saved) throw notFound("Promotion not found");
    res.json({ data: serialize(saved) });
  });
  return router;
}
