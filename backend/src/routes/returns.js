import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serialize(record) {
  return { ...record, id: String(record._id), _id: undefined, orderId: String(record.orderId), userId: record.userId ? String(record.userId) : undefined, items: (record.items || []).map((item) => ({ ...item, variantId: String(item.variantId) })) };
}

export function returnsRouter({ db }) {
  const router = Router();
  const returns = db.collection("returns");
  router.use(authenticate, requireRoles("customer"));

  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const [items, total] = await Promise.all([
      returns.find({ userId: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      returns.countDocuments({ userId: req.user._id })
    ]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.post("/", async (req, res) => {
    validateBody({ orderId: { required: true }, reason: { required: true, type: "string", maxLength: 1000 } }, req.body);
    if (!Array.isArray(req.body.items) || !req.body.items.length) throw new HttpError(400, "VALIDATION_ERROR", "At least one return item is required");
    const orderId = toReference(req.body.orderId, "orderId");
    const order = await db.collection("orders").findOne({ _id: orderId, userId: req.user._id });
    if (!order) throw notFound("Order not found");
    if (!["delivered", "completed"].includes(order.orderStatus)) throw new HttpError(409, "ORDER_NOT_RETURNABLE", "Only delivered or completed orders can be returned");
    const earlier = await returns.find({ orderId, status: { $ne: "rejected" } }).toArray();
    const returned = new Map();
    for (const record of earlier) for (const item of record.items || []) {
      const key = String(item.variantId);
      returned.set(key, (returned.get(key) || 0) + Number(item.quantity || 0));
    }
    const requested = new Map();
    const items = req.body.items.map((item) => {
      validateBody({ variantId: { required: true }, quantity: { required: true, type: "positiveInteger" } }, item);
      const variantId = toReference(item.variantId, "variantId");
      const key = String(variantId);
      const purchased = (order.items || []).find((line) => String(line.variantId) === key);
      const total = (requested.get(key) || 0) + item.quantity;
      if (!purchased || total + (returned.get(key) || 0) > Number(purchased.quantity)) throw new HttpError(409, "RETURN_ITEM_INVALID", "Requested return quantity exceeds the unreturned quantity");
      requested.set(key, total);
      return { variantId, quantity: item.quantity };
    });
    const now = new Date();
    const record = {
      _id: new ObjectId(), orderId, userId: req.user._id, reason: req.body.reason.trim(), items,
      status: "requested", history: [{ status: "requested", userId: req.user._id, createdAt: now }],
      createdByUserId: req.user._id, createdAt: now, updatedAt: now
    };
    await returns.insertOne(record);
    res.status(201).json({ data: serialize(record) });
  });

  return router;
}
