import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference, validateBody } from "../lib/validation.js";
import { inclusiveEndDate } from "../lib/dates.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serialize(voucher) {
  return {
    ...voucher,
    id: voucher._id.toString(),
    _id: undefined,
    createdByUserId: voucher.createdByUserId?.toString()
  };
}

function parseDates(input, current = {}) {
  const startDate = input.startDate === undefined ? new Date(current.startDate) : new Date(input.startDate);
  const endDate = inclusiveEndDate(input.endDate === undefined ? new Date(current.endDate) : input.endDate);
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf()) || endDate <= startDate) {
    throw new HttpError(400, "VALIDATION_ERROR", "Voucher dates are invalid");
  }
  return { startDate, endDate };
}

function validateDiscount(input, current = {}) {
  const discountType = input.discountType ?? current.discountType;
  const discountValue = input.discountValue ?? current.discountValue;
  if (!["percentage", "fixed"].includes(discountType)) throw new HttpError(400, "VALIDATION_ERROR", "discountType must be percentage or fixed");
  if (typeof discountValue !== "number" || !Number.isFinite(discountValue) || discountValue < 0 || (discountType === "percentage" && discountValue > 100)) {
    throw new HttpError(400, "VALIDATION_ERROR", "discountValue is invalid");
  }
  return { discountType, discountValue };
}

function validateMoney(value, field) {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new HttpError(400, "VALIDATION_ERROR", `${field} must be a non-negative number`);
}

export function adminVouchersRouter({ db }) {
  const router = Router();
  const vouchers = db.collection("vouchers");
  router.use(authenticate, requireRoles("sales", "manager"));

  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const [items, total] = await Promise.all([
      vouchers.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      vouchers.countDocuments({})
    ]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.get("/:id", async (req, res) => {
    const voucher = await vouchers.findOne({ _id: toReference(req.params.id, "id") });
    if (!voucher) throw notFound("Voucher not found");
    res.json({ data: serialize(voucher) });
  });

  router.post("/", async (req, res) => {
    validateBody({ code: { required: true, type: "string", maxLength: 50 }, discountType: { required: true, type: "string" }, discountValue: { required: true, type: "nonNegativeNumber" }, startDate: { required: true, type: "string" }, endDate: { required: true, type: "string" } }, req.body);
    const code = req.body.code.trim().toUpperCase();
    if (await vouchers.findOne({ code })) throw new HttpError(409, "DUPLICATE_VOUCHER", "Voucher code already exists");
    const { discountType, discountValue } = validateDiscount(req.body);
    const { startDate, endDate } = parseDates(req.body);
    validateMoney(req.body.minOrderValue, "minOrderValue");
    validateMoney(req.body.maxDiscountAmount, "maxDiscountAmount");
    if (req.body.totalUsageLimit !== undefined && (!Number.isInteger(req.body.totalUsageLimit) || req.body.totalUsageLimit <= 0)) throw new HttpError(400, "VALIDATION_ERROR", "totalUsageLimit must be a positive integer");
    const now = new Date();
    const voucher = { _id: new ObjectId(), code, discountType, discountValue, minOrderValue: req.body.minOrderValue ?? 0, maxDiscountAmount: req.body.maxDiscountAmount ?? null, startDate, endDate, totalUsageLimit: req.body.totalUsageLimit ?? null, usedCount: 0, isActive: req.body.isActive !== false, isDemo: false, createdAt: now, updatedAt: now, createdByUserId: req.user._id };
    await vouchers.insertOne(voucher);
    res.status(201).json({ data: serialize(voucher) });
  });

  router.patch("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const current = await vouchers.findOne({ _id: id });
    if (!current) throw notFound("Voucher not found");
    const update = { updatedAt: new Date() };
    if (req.body.code !== undefined) {
      if (typeof req.body.code !== "string" || !req.body.code.trim()) throw new HttpError(400, "VALIDATION_ERROR", "code must be a non-empty string");
      const code = req.body.code.trim().toUpperCase();
      if (code !== current.code && await vouchers.findOne({ code, _id: { $ne: id } })) throw new HttpError(409, "DUPLICATE_VOUCHER", "Voucher code already exists");
      update.code = code;
    }
    if (req.body.discountType !== undefined || req.body.discountValue !== undefined) Object.assign(update, validateDiscount(req.body, current));
    if (req.body.startDate !== undefined || req.body.endDate !== undefined) Object.assign(update, parseDates(req.body, current));
    for (const field of ["minOrderValue", "maxDiscountAmount"]) {
      if (req.body[field] !== undefined) {
        validateMoney(req.body[field], field);
        update[field] = req.body[field];
      }
    }
    if (req.body.totalUsageLimit !== undefined) {
      if (req.body.totalUsageLimit !== null && (!Number.isInteger(req.body.totalUsageLimit) || req.body.totalUsageLimit <= 0)) throw new HttpError(400, "VALIDATION_ERROR", "totalUsageLimit must be a positive integer or null");
      update.totalUsageLimit = req.body.totalUsageLimit;
    }
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
      update.isActive = req.body.isActive;
    }
    const saved = await vouchers.findOneAndUpdate({ _id: id }, { $set: update }, { returnDocument: "after" });
    res.json({ data: serialize(saved) });
  });

  router.delete("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const saved = await vouchers.findOneAndUpdate({ _id: id }, { $set: { isActive: false, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!saved) throw notFound("Voucher not found");
    res.json({ data: serialize(saved) });
  });

  return router;
}
