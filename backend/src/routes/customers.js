import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { validateBody, toReference } from "../lib/validation.js";
import { authenticate, publicUser, requireRoles } from "../middleware/auth.js";

function serializeAddress(address) {
  return { ...address, id: String(address._id), _id: undefined, userId: String(address.userId) };
}

function cleanAddress(input, partial = false) {
  const schema = {
    receiverName: { required: !partial, type: "string", maxLength: 120 },
    receiverPhone: { required: !partial, type: "string", maxLength: 30 },
    fullAddress: { required: !partial, type: "string", maxLength: 500 },
    regionCode: { required: false, type: "string", maxLength: 64 },
    regionName: { required: false, type: "string", maxLength: 120 }
  };
  validateBody(schema, input);
  const result = {};
  for (const field of Object.keys(schema)) {
    if (input[field] !== undefined) result[field] = input[field].trim();
  }
  if (Object.values(result).some((value) => value === "")) throw new HttpError(400, "VALIDATION_ERROR", "Address fields cannot be empty");
  if (result.regionCode !== undefined) {
    result.regionCode = result.regionCode.toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.regionCode)) throw new HttpError(400, "VALIDATION_ERROR", "regionCode is invalid");
  }
  if (input.isDefault !== undefined) {
    if (typeof input.isDefault !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isDefault must be boolean");
    result.isDefault = input.isDefault;
  }
  return result;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function customersRouter({ db }) {
  const router = Router();
  const users = db.collection("users");
  const addresses = db.collection("user_addresses");
  router.use(authenticate);

  router.get("/me", (req, res) => res.json({ data: publicUser(req.user) }));

  router.patch("/me", async (req, res) => {
    const update = {};
    for (const field of ["fullName", "phone", "skinType"]) {
      if (req.body[field] === undefined) continue;
      if (typeof req.body[field] !== "string" || (field === "fullName" && !req.body[field].trim())) throw new HttpError(400, "VALIDATION_ERROR", `${field} must be a non-empty string`);
      update[field] = req.body[field].trim();
    }
    if (!Object.keys(update).length) throw new HttpError(400, "VALIDATION_ERROR", "No profile fields to update");
    const user = await users.findOneAndUpdate({ _id: req.user._id, isActive: true }, { $set: { ...update, updatedAt: new Date() } }, { returnDocument: "after" });
    res.json({ data: publicUser(user) });
  });

  router.get("/me/addresses", async (req, res) => {
    const data = await addresses.find({ userId: req.user._id }).sort({ isDefault: -1, createdAt: -1 }).toArray();
    res.json({ data: data.map(serializeAddress), pagination: { page: 1, limit: data.length, total: data.length, totalPages: data.length ? 1 : 0 } });
  });

  router.post("/me/addresses", async (req, res) => {
    const fields = cleanAddress(req.body);
    const now = new Date();
    if (fields.isDefault) await addresses.updateMany({ userId: req.user._id }, { $set: { isDefault: false, updatedAt: now } });
    const address = { _id: new ObjectId(), userId: req.user._id, ...fields, isDefault: fields.isDefault === true, createdAt: now, updatedAt: now };
    await addresses.insertOne(address);
    res.status(201).json({ data: serializeAddress(address) });
  });

  router.patch("/me/addresses/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const current = await addresses.findOne({ _id: id, userId: req.user._id });
    if (!current) throw notFound("Address not found");
    const fields = cleanAddress(req.body, true);
    if (!Object.keys(fields).length) throw new HttpError(400, "VALIDATION_ERROR", "No address fields to update");
    if (fields.isDefault === true) await addresses.updateMany({ userId: req.user._id }, { $set: { isDefault: false, updatedAt: new Date() } });
    const saved = await addresses.findOneAndUpdate({ _id: id, userId: req.user._id }, { $set: { ...fields, updatedAt: new Date() } }, { returnDocument: "after" });
    res.json({ data: serializeAddress(saved) });
  });

  router.delete("/me/addresses/:id", async (req, res) => {
    const result = await addresses.deleteOne({ _id: toReference(req.params.id, "id"), userId: req.user._id });
    if (!result.deletedCount) throw notFound("Address not found");
    res.status(204).end();
  });

  router.get("/me/loyalty", async (req, res) => {
    const [membership, history] = await Promise.all([
      db.collection("memberships").findOne({ userId: req.user._id }),
      db.collection("point_histories").find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).toArray()
    ]);
    const points = membership?.pointsBalance || 0;
    res.json({ data: {
      membership: membership ? { ...membership, id: String(membership._id), _id: undefined, userId: String(membership.userId) } : { pointsBalance: 0, lifetimePoints: 0, tier: "bronze" },
      history: history.map((entry) => ({ ...entry, id: String(entry._id), _id: undefined, userId: String(entry.userId), orderId: entry.orderId ? String(entry.orderId) : null })),
      pointsBalance: points
    } });
  });

  return router;
}

export function adminCustomersRouter({ db }) {
  const router = Router();
  router.use(authenticate, requireRoles("sales", "manager"));
  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { role: "customer" };
    if (req.query.q?.trim()) {
      const pattern = new RegExp(escapeRegex(req.query.q.trim()), "i");
      filter.$or = [{ fullName: pattern }, { email: pattern }, { phone: pattern }];
    }
    const [users, total] = await Promise.all([
      db.collection("users").find(filter, { projection: { passwordHash: 0 } }).sort({ fullName: 1 }).skip(skip).limit(limit).toArray(),
      db.collection("users").countDocuments(filter)
    ]);
    const data = await Promise.all(users.map(async (user) => {
      const membership = await db.collection("memberships").findOne({ userId: user._id }, { projection: { pointsBalance: 1, lifetimePoints: 1, tier: 1 } });
      return { ...publicUser(user), membership: membership || { pointsBalance: 0, lifetimePoints: 0, tier: "bronze" } };
    }));
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });
  return router;
}
