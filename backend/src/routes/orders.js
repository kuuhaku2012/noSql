import { Router } from "express";
import { ObjectId } from "mongodb";
import { HttpError, notFound } from "../lib/errors.js";
import { toReference } from "../lib/validation.js";
import { authenticate } from "../middleware/auth.js";
import { createOrder, serializeOrder, transitionOrder } from "../services/order-service.js";

function serializeRecord(record) {
  if (!record) return null;
  return { ...record, id: String(record._id), _id: undefined, orderId: record.orderId ? String(record.orderId) : undefined };
}

async function orderDetails(db, order) {
  const [payment, invoice, history] = await Promise.all([
    db.collection("payments").findOne({ orderId: order._id }),
    db.collection("invoices").findOne({ orderId: order._id }),
    db.collection("order_histories").find({ orderId: order._id }).sort({ createdAt: 1 }).toArray()
  ]);
  return { ...serializeOrder(order), payment: serializeRecord(payment), invoice: serializeRecord(invoice), history: history.map(serializeRecord) };
}

export function ordersRouter({ db }) {
  const router = Router();
  const orders = db.collection("orders");
  router.use(authenticate);

  router.post("/", async (req, res) => {
    const order = await createOrder({ db, user: req.user, body: req.body });
    res.status(201).json({ data: serializeOrder(order) });
  });

  router.get("/", async (req, res) => {
    const filter = ["sales", "warehouse", "manager"].includes(req.user.role) ? {} : { userId: req.user._id };
    const data = (await orders.find(filter).sort({ createdAt: -1 }).toArray()).map(serializeOrder);
    res.json({ data, pagination: { page: 1, limit: data.length, total: data.length, totalPages: data.length ? 1 : 0 } });
  });

  router.get("/:id", async (req, res) => {
    const filter = { _id: toReference(req.params.id, "id") };
    if (!["sales", "warehouse", "manager"].includes(req.user.role)) filter.userId = req.user._id;
    const order = await orders.findOne(filter);
    if (!order) throw notFound("Order not found");
    res.json({ data: await orderDetails(db, order) });
  });

  router.delete("/:id", async (req, res) => {
    const filter = { _id: toReference(req.params.id, "id") };
    const staff = ["sales", "warehouse", "manager"].includes(req.user.role);
    if (!staff) filter.userId = req.user._id;
    const order = await orders.findOne(filter);
    if (!order) throw notFound("Order not found");
    if (!staff && order.orderStatus !== "pending") throw new HttpError(403, "FORBIDDEN", "Only pending orders can be cancelled by customers");
    const updated = await transitionOrder({ db, order, user: req.user, status: "cancelled", note: req.body?.note || "Order cancelled" });
    res.json({ data: serializeOrder(updated) });
  });

  router.post("/:id/payment", async (req, res) => {
    if (!["success", "failure"].includes(req.body.outcome)) throw new HttpError(400, "VALIDATION_ERROR", "outcome must be success or failure");
    const filter = { _id: toReference(req.params.id, "id") };
    const staff = ["sales", "warehouse", "manager"].includes(req.user.role);
    if (!staff) filter.userId = req.user._id;
    const order = await orders.findOne(filter);
    if (!order) throw notFound("Order not found");
    if (order.paymentMethod !== "mock") throw new HttpError(409, "PAYMENT_NOT_SUPPORTED", "Only simulated payments can be processed here");
    if (["cancelled", "returned"].includes(order.orderStatus)) throw new HttpError(409, "ORDER_NOT_PAYABLE", "This order cannot be paid");

    const existing = await db.collection("payments").findOne({ orderId: order._id });
    if (existing?.status === "paid") {
      if (req.body.outcome === "failure") throw new HttpError(409, "PAYMENT_ALREADY_PAID", "This order has already been paid");
      res.json({ data: await orderDetails(db, order) });
      return;
    }

    const now = new Date();
    const payment = await db.collection("payments").findOneAndUpdate({ orderId: order._id }, {
      $set: { method: "mock", status: req.body.outcome === "success" ? "paid" : "failed", isMock: true, updatedAt: now, lastAttemptAt: now },
      $setOnInsert: { _id: new ObjectId(), orderId: order._id, amount: order.finalAmount, createdAt: now },
      $inc: { attemptCount: 1 }
    }, { upsert: true, returnDocument: "after" });
    await db.collection("invoices").updateOne({ orderId: order._id }, {
      $set: { status: req.body.outcome === "success" ? "issued" : "pending", updatedAt: now, ...(req.body.outcome === "success" ? { issuedAt: now } : {}) },
      $setOnInsert: { _id: new ObjectId(), orderId: order._id, invoiceCode: `INV-${order.orderCode}`, amount: order.finalAmount, createdAt: now }
    }, { upsert: true });
    await orders.updateOne({ _id: order._id }, { $set: { paymentStatus: payment.status, updatedAt: now } });
    const updated = await orders.findOne({ _id: order._id });
    res.json({ data: await orderDetails(db, updated) });
  });

  router.patch("/:id/status", async (req, res) => {
    if (!req.body.status) throw new HttpError(400, "VALIDATION_ERROR", "status is required");
    const filter = { _id: toReference(req.params.id, "id") };
    const staff = ["sales", "warehouse", "manager"].includes(req.user.role);
    if (!staff) filter.userId = req.user._id;
    const order = await orders.findOne(filter);
    if (!order) throw notFound("Order not found");
    if (!staff && req.body.status !== "cancelled") throw new HttpError(403, "FORBIDDEN", "Customers can only cancel their pending order");
    if (!staff && order.orderStatus !== "pending") throw new HttpError(403, "FORBIDDEN", "Only pending orders can be cancelled by customers");
    const updated = await transitionOrder({ db, order, user: req.user, status: req.body.status, note: req.body.note || "" });
    res.json({ data: serializeOrder(updated) });
  });
  return router;
}
