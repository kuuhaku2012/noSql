import { Router } from "express";
import { ObjectId } from "mongodb";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { assertTransition, deliveryTransitions } from "../lib/status.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serialize(item) {
  return { ...item, id: item._id.toString(), _id: undefined, orderId: item.orderId?.toString(), storeId: item.storeId?.toString(), assignedToUserId: item.assignedToUserId?.toString() };
}

export function adminDeliveriesRouter({ db }) {
  const router = Router();
  const deliveries = db.collection("deliveries");
  router.use(authenticate, requireRoles("sales", "warehouse", "manager"));
  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const [items, total] = await Promise.all([
      deliveries.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      deliveries.countDocuments({})
    ]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });
  router.post("/", async (req, res) => {
    validateBody({ orderId: { required: true }, storeId: { required: true }, deliveryAddress: { required: true, type: "string" } }, req.body);
    const orderId = toReference(req.body.orderId, "orderId");
    const storeId = toReference(req.body.storeId, "storeId");
    const order = await db.collection("orders").findOne({ _id: orderId });
    if (!order) throw notFound("Order not found");
    if (order.orderStatus !== "shipped") throw new HttpError(409, "ORDER_NOT_READY_FOR_DELIVERY", "Only shipped orders can be assigned a delivery");
    if (await deliveries.findOne({ orderId }, { projection: { _id: 1 } })) throw new HttpError(409, "DELIVERY_ALREADY_EXISTS", "A delivery already exists for this order");
    if (!await db.collection("stores").findOne({ _id: storeId, isActive: true })) throw notFound("Store not found");
    const now = new Date();
    const delivery = { _id: new ObjectId(), orderId, storeId, deliveryAddress: req.body.deliveryAddress, status: "ready", assignedToUserId: req.body.assignedToUserId ? toReference(req.body.assignedToUserId, "assignedToUserId") : null, note: req.body.note || "", history: [{ status: "ready", userId: req.user._id, createdAt: now }], createdAt: now, updatedAt: now, isMock: true };
    await deliveries.insertOne(delivery);
    res.status(201).json({ data: serialize(delivery) });
  });
  router.patch("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const delivery = await deliveries.findOne({ _id: id });
    if (!delivery) throw notFound("Delivery not found");
    if (!req.body.status) throw new HttpError(400, "VALIDATION_ERROR", "status is required");
    assertTransition(deliveryTransitions, delivery.status, req.body.status);
    const update = { status: req.body.status, updatedAt: new Date() };
    if (req.body.assignedToUserId !== undefined) update.assignedToUserId = req.body.assignedToUserId ? toReference(req.body.assignedToUserId, "assignedToUserId") : null;
    if (req.body.note !== undefined) update.note = String(req.body.note);
    const saved = await deliveries.findOneAndUpdate({ _id: id, status: delivery.status }, { $set: update }, { returnDocument: "after" });
    if (!saved) throw new HttpError(409, "CONCURRENT_UPDATE", "Delivery was changed by another request");
    saved.history = [...(delivery.history || []), { status: req.body.status, userId: req.user._id, createdAt: update.updatedAt, note: update.note || "" }];
    await deliveries.updateOne({ _id: id }, { $set: { history: saved.history } });
    if (req.body.status === "delivered") {
      const completedOrder = await db.collection("orders").findOneAndUpdate({ _id: delivery.orderId, orderStatus: "shipped" }, {
        $set: { orderStatus: "delivered", updatedAt: update.updatedAt, lastUpdatedByUserId: req.user._id }
      }, { returnDocument: "after" });
      if (completedOrder) await db.collection("order_histories").insertOne({ orderId: delivery.orderId, oldStatus: "shipped", newStatus: "delivered", note: "Delivery marked as delivered", createdByUserId: req.user._id, createdAt: update.updatedAt });
    }
    res.json({ data: serialize(saved) });
  });
  return router;
}
