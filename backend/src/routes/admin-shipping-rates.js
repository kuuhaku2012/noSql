import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { toReference } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function normalizeRate(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Shipping rate must be an object");
  }

  const values = {};
  if (!partial || body.regionCode !== undefined) {
    if (typeof body.regionCode !== "string" || !body.regionCode.trim()) {
      throw new HttpError(400, "VALIDATION_ERROR", "regionCode must be a non-empty string");
    }
    const code = body.regionCode.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) {
      throw new HttpError(400, "VALIDATION_ERROR", "regionCode must contain lowercase letters, numbers, and hyphens");
    }
    values.code = code;
  }
  if (!partial || body.regionName !== undefined) {
    if (typeof body.regionName !== "string" || !body.regionName.trim()) {
      throw new HttpError(400, "VALIDATION_ERROR", "regionName must be a non-empty string");
    }
    values.regionName = body.regionName.trim();
  }
  if (!partial || body.fee !== undefined) {
    if (typeof body.fee !== "number" || !Number.isFinite(body.fee) || body.fee < 0) {
      throw new HttpError(400, "VALIDATION_ERROR", "fee must be a finite non-negative number");
    }
    values.fee = body.fee;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
    values.isActive = body.isActive;
  } else if (!partial) {
    values.isActive = true;
  }
  return values;
}

function serialize(rate) {
  const { _id, code, createdByUserId, ...fields } = rate;
  return {
    ...fields,
    id: _id.toString(),
    regionCode: code,
    ...(createdByUserId ? { createdByUserId: createdByUserId.toString() } : {})
  };
}

function duplicateCode() {
  return new HttpError(409, "DUPLICATE_SHIPPING_RATE", "Shipping region code already exists");
}

export function adminShippingRatesRouter({ db }) {
  const router = Router();
  const shippingRates = db.collection("shipping_rates");
  router.use(authenticate, requireRoles("manager"));

  router.get("/", async (_req, res) => {
    const rates = await shippingRates.find({}).sort({ code: 1 }).toArray();
    res.json({ data: rates.map(serialize) });
  });

  router.post("/", async (req, res) => {
    const values = normalizeRate(req.body);
    if (await shippingRates.findOne({ code: values.code })) throw duplicateCode();
    const now = new Date();
    const rate = {
      _id: new ObjectId(),
      ...values,
      currency: "VND",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
      createdByUserId: req.user._id
    };
    try {
      await shippingRates.insertOne(rate);
    } catch (error) {
      if (error.code === 11000) throw duplicateCode();
      throw error;
    }
    res.status(201).json({ data: serialize(rate) });
  });

  router.patch("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const current = await shippingRates.findOne({ _id: id });
    if (!current) throw notFound("Shipping rate not found");
    const values = normalizeRate(req.body, { partial: true });
    if (values.code && values.code !== current.code && current.isDemo && !current.createdByUserId) {
      throw new HttpError(400, "VALIDATION_ERROR", "Seeded shipping rate codes cannot be changed");
    }
    if (values.code && values.code !== current.code && await shippingRates.findOne({ code: values.code, _id: { $ne: id } })) {
      throw duplicateCode();
    }
    try {
      const saved = await shippingRates.findOneAndUpdate(
        { _id: id },
        { $set: { ...values, updatedAt: new Date() } },
        { returnDocument: "after" }
      );
      res.json({ data: serialize(saved) });
    } catch (error) {
      if (error.code === 11000) throw duplicateCode();
      throw error;
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const saved = await shippingRates.findOneAndUpdate(
      { _id: id },
      { $set: { isActive: false, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!saved) throw notFound("Shipping rate not found");
    res.json({ data: serialize(saved) });
  });

  return router;
}
