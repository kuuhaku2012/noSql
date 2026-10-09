import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serialize(item) {
  return { ...item, id: String(item._id), _id: undefined, userId: item.userId ? String(item.userId) : undefined, voucherId: item.voucherId ? String(item.voucherId) : undefined };
}

async function expireUserVouchers(collection, userId) {
  await collection.updateMany({ userId, status: "available", expiresAt: { $lt: new Date() } }, { $set: { status: "expired", updatedAt: new Date() } });
}

export function userVouchersRouter({ db }) {
  const router = Router();
  const userVouchers = db.collection("user_vouchers");

  router.get("/vouchers/mine", authenticate, async (req, res) => {
    await expireUserVouchers(userVouchers, req.user._id);
    const items = await userVouchers.find({ userId: req.user._id }).sort({ claimedAt: -1 }).toArray();
    res.json({ data: items.map(serialize), pagination: { page: 1, limit: items.length, total: items.length, totalPages: items.length ? 1 : 0 } });
  });

  router.post("/vouchers/claim", authenticate, async (req, res) => {
    validateBody({ code: { required: true, type: "string", maxLength: 50 } }, req.body);
    const now = new Date();
    const voucher = await db.collection("vouchers").findOne({ code: req.body.code.trim().toUpperCase(), isActive: true, startDate: { $lte: now }, endDate: { $gte: now } });
    if (!voucher) throw notFound("Active voucher not found");
    if (await userVouchers.findOne({ userId: req.user._id, voucherId: voucher._id })) throw new HttpError(409, "VOUCHER_ALREADY_CLAIMED", "Voucher already claimed");
    const item = { _id: new ObjectId(), userId: req.user._id, voucherId: voucher._id, status: "available", claimedAt: now, usedAt: null, expiresAt: voucher.endDate, createdAt: now, updatedAt: now };
    await userVouchers.insertOne(item);
    res.status(201).json({ data: serialize(item) });
  });

  router.post("/admin/user-vouchers", authenticate, requireRoles("manager"), async (req, res) => {
    validateBody({ userId: { required: true }, voucherId: { required: true } }, req.body);
    const userId = toReference(req.body.userId, "userId");
    const voucherId = toReference(req.body.voucherId, "voucherId");
    const [user, voucher] = await Promise.all([
      db.collection("users").findOne({ _id: userId, role: "customer", isActive: true }),
      db.collection("vouchers").findOne({ _id: voucherId, isActive: true })
    ]);
    if (!user) throw notFound("Customer not found");
    if (!voucher) throw notFound("Voucher not found");
    if (await userVouchers.findOne({ userId, voucherId })) throw new HttpError(409, "VOUCHER_ALREADY_ASSIGNED", "Voucher already assigned");
    const now = new Date();
    const item = { _id: new ObjectId(), userId, voucherId, status: "available", claimedAt: now, usedAt: null, expiresAt: voucher.endDate, createdAt: now, updatedAt: now, assignedByUserId: req.user._id };
    await userVouchers.insertOne(item);
    res.status(201).json({ data: serialize(item) });
  });

  return router;
}
