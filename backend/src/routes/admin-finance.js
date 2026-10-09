import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serialize(record) {
  return { ...record, id: record._id.toString(), _id: undefined, orderId: record.orderId?.toString(), createdByUserId: record.createdByUserId?.toString() };
}

function pagination(query) {
  return parsePagination(query);
}

export function adminFinanceRouter({ db }) {
  const router = Router();
  const payments = db.collection("payments");
  const invoices = db.collection("invoices");
  router.use(authenticate, requireRoles("manager"));

  router.get("/payments", async (req, res) => {
    const { page, limit, skip } = pagination(req.query);
    const filter = req.query.orderId ? { orderId: toReference(req.query.orderId, "orderId") } : {};
    const [items, total] = await Promise.all([payments.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(), payments.countDocuments(filter)]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.get("/payments/:id", async (req, res) => {
    const item = await payments.findOne({ _id: toReference(req.params.id, "id") });
    if (!item) throw notFound("Payment not found");
    res.json({ data: serialize(item) });
  });

  router.post("/payments", async (req, res) => {
    validateBody({ orderId: { required: true }, method: { type: "string" }, amount: { type: "nonNegativeNumber" } }, req.body);
    if (req.body.method !== undefined && !["cod", "mock"].includes(req.body.method)) throw new HttpError(400, "VALIDATION_ERROR", "method must be cod or mock");
    const orderId = toReference(req.body.orderId, "orderId");
    const order = await db.collection("orders").findOne({ _id: orderId });
    if (!order) throw notFound("Order not found");
    if (await payments.findOne({ orderId })) throw new HttpError(409, "PAYMENT_EXISTS", "Payment already exists for this order");
    const now = new Date();
    const payment = { _id: new ObjectId(), orderId, method: req.body.method || order.paymentMethod || "mock", status: req.body.status || "pending", amount: req.body.amount ?? order.finalAmount, isMock: true, createdAt: now, updatedAt: now, createdByUserId: req.user._id };
    if (!["cod", "mock"].includes(payment.method)) throw new HttpError(400, "VALIDATION_ERROR", "method must be cod or mock");
    if (!["pending", "paid", "failed", "refunded", "void"].includes(payment.status)) throw new HttpError(400, "VALIDATION_ERROR", "payment status is invalid");
    await payments.insertOne(payment);
    res.status(201).json({ data: serialize(payment) });
  });

  router.patch("/payments/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    if (req.body.status !== undefined && !["pending", "paid", "failed", "refunded", "void"].includes(req.body.status)) throw new HttpError(400, "VALIDATION_ERROR", "payment status is invalid");
    const update = { updatedAt: new Date() };
    if (req.body.status !== undefined) update.status = req.body.status;
    if (req.body.note !== undefined) update.note = String(req.body.note);
    const saved = await payments.findOneAndUpdate({ _id: id }, { $set: update }, { returnDocument: "after" });
    if (!saved) throw notFound("Payment not found");
    if (update.status) await db.collection("orders").updateOne({ _id: saved.orderId }, { $set: { paymentStatus: update.status, updatedAt: update.updatedAt } });
    res.json({ data: serialize(saved) });
  });

  router.delete("/payments/:id", async (req, res) => {
    const saved = await payments.findOneAndUpdate({ _id: toReference(req.params.id, "id") }, { $set: { status: "void", updatedAt: new Date() } }, { returnDocument: "after" });
    if (!saved) throw notFound("Payment not found");
    await db.collection("orders").updateOne({ _id: saved.orderId }, { $set: { paymentStatus: "void", updatedAt: saved.updatedAt } });
    res.json({ data: serialize(saved) });
  });

  router.get("/invoices", async (req, res) => {
    const { page, limit, skip } = pagination(req.query);
    const filter = req.query.orderId ? { orderId: toReference(req.query.orderId, "orderId") } : {};
    const [items, total] = await Promise.all([invoices.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(), invoices.countDocuments(filter)]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.get("/invoices/:id", async (req, res) => {
    const item = await invoices.findOne({ _id: toReference(req.params.id, "id") });
    if (!item) throw notFound("Invoice not found");
    res.json({ data: serialize(item) });
  });

  router.post("/invoices", async (req, res) => {
    validateBody({ orderId: { required: true }, amount: { type: "nonNegativeNumber" } }, req.body);
    const orderId = toReference(req.body.orderId, "orderId");
    const order = await db.collection("orders").findOne({ _id: orderId });
    if (!order) throw notFound("Order not found");
    if (await invoices.findOne({ orderId })) throw new HttpError(409, "INVOICE_EXISTS", "Invoice already exists for this order");
    const now = new Date();
    const invoice = { _id: new ObjectId(), orderId, invoiceCode: req.body.invoiceCode || `INV-${order.orderCode}`, status: req.body.status || "pending", amount: req.body.amount ?? order.finalAmount, isMock: true, createdAt: now, updatedAt: now, createdByUserId: req.user._id };
    if (!["pending", "issued", "void"].includes(invoice.status)) throw new HttpError(400, "VALIDATION_ERROR", "invoice status is invalid");
    await invoices.insertOne(invoice);
    res.status(201).json({ data: serialize(invoice) });
  });

  router.patch("/invoices/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    if (req.body.status !== undefined && !["pending", "issued", "void"].includes(req.body.status)) throw new HttpError(400, "VALIDATION_ERROR", "invoice status is invalid");
    const update = { updatedAt: new Date() };
    if (req.body.status !== undefined) update.status = req.body.status;
    if (req.body.note !== undefined) update.note = String(req.body.note);
    const saved = await invoices.findOneAndUpdate({ _id: id }, { $set: update }, { returnDocument: "after" });
    if (!saved) throw notFound("Invoice not found");
    res.json({ data: serialize(saved) });
  });

  router.delete("/invoices/:id", async (req, res) => {
    const saved = await invoices.findOneAndUpdate({ _id: toReference(req.params.id, "id") }, { $set: { status: "void", updatedAt: new Date() } }, { returnDocument: "after" });
    if (!saved) throw notFound("Invoice not found");
    res.json({ data: serialize(saved) });
  });

  return router;
}
