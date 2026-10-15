import { Router } from "express";
import { ObjectId } from "mongodb";
import { HttpError, notFound } from "../lib/errors.js";
import { toReference } from "../lib/validation.js";
import { authenticate } from "../middleware/auth.js";
import { createOrder, serializeOrder, transitionOrder } from "../services/order-service.js";

const customerCancellableStatuses = new Set(["pending", "requested", "confirmed", "processing"]);

function canCustomerCancel(order) {
  return customerCancellableStatuses.has(String(order.orderStatus || order.status || "").toLowerCase());
}

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
    if (!staff && !canCustomerCancel(order)) throw new HttpError(403, "ORDER_NOT_CANCELLABLE", "Đơn hàng chỉ có thể hủy trước khi chuyển sang trạng thái đang giao.");
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
    const payments = db.collection("payments");
    const handleCompletedOrder = async (currentOrder) => {
      if (currentOrder.orderStatus !== "completed") return false;
      if (currentOrder.stockCommitClaim || currentOrder.paymentOperationClaim) {
        throw new HttpError(409, "CONCURRENT_UPDATE", "Order side effects are still being finalized");
      }
      const [payment, invoice] = await Promise.all([
        payments.findOne({ orderId: currentOrder._id }),
        db.collection("invoices").findOne({ orderId: currentOrder._id })
      ]);
      if (currentOrder.paymentStatus === "paid" && payment?.status === "paid" && invoice?.status === "issued") {
        if (req.body.outcome === "failure") throw new HttpError(409, "PAYMENT_ALREADY_PAID", "This order has already been paid");
        res.json({ data: await orderDetails(db, currentOrder) });
        return true;
      }
      if (!payment || !invoice) throw new HttpError(409, "ORDER_ARTIFACTS_MISSING", "Order payment or invoice record is missing");
      throw new HttpError(409, "ORDER_NOT_PAYABLE", "A completed order with unsettled payment cannot be paid");
    };
    if (await handleCompletedOrder(order)) return;

    const paymentOperationClaim = new ObjectId();
    let claimedOrder;
    try {
      claimedOrder = await orders.findOneAndUpdate(
        {
          ...filter,
          paymentMethod: "mock",
          orderStatus: { $nin: ["cancelled", "returned", "completed"] },
          stockCommitClaim: { $exists: false },
          paymentOperationClaim: { $exists: false }
        },
        { $set: { paymentOperationClaim } },
        { returnDocument: "after" }
      );
    } catch (error) {
      claimedOrder = await orders.findOne({ _id: order._id, paymentOperationClaim });
      if (!claimedOrder) throw error;
    }
    if (!claimedOrder) {
      const current = await orders.findOne(filter);
      if (!current) throw notFound("Order not found");
      if (["cancelled", "returned"].includes(current.orderStatus)) throw new HttpError(409, "ORDER_NOT_PAYABLE", "This order cannot be paid");
      if (await handleCompletedOrder(current)) return;
      throw new HttpError(409, "CONCURRENT_UPDATE", "Order is being updated by another request");
    }

    const invoices = db.collection("invoices");
    const releasePaymentClaim = async () => {
      try {
        const released = await orders.updateOne({ _id: order._id, paymentOperationClaim }, { $unset: { paymentOperationClaim: "" } });
        if (released.matchedCount === 1) return;
      } catch (error) {
        const current = await orders.findOne({ _id: order._id, paymentOperationClaim });
        if (!current) return;
        throw error;
      }
      const stillClaimed = await orders.findOne({ _id: order._id, paymentOperationClaim });
      if (stillClaimed) throw new Error("Could not release mock-payment claim");
    };

    let paymentSnapshot;
    let invoiceSnapshot;
    try {
      [paymentSnapshot, invoiceSnapshot] = await Promise.all([
        payments.findOne({ orderId: order._id }),
        invoices.findOne({ orderId: order._id })
      ]);
    } catch (error) {
      await releasePaymentClaim();
      throw error;
    }
    if (!paymentSnapshot || !invoiceSnapshot) {
      await releasePaymentClaim();
      throw new HttpError(409, "ORDER_ARTIFACTS_MISSING", "Order payment or invoice record is missing");
    }

    const existing = paymentSnapshot;
    if (existing.status === "paid") {
      if (req.body.outcome === "failure") {
        await releasePaymentClaim();
        throw new HttpError(409, "PAYMENT_ALREADY_PAID", "This order has already been paid");
      }
      if (claimedOrder.paymentStatus !== "paid" || invoiceSnapshot.status !== "issued") {
        await releasePaymentClaim();
        throw new HttpError(409, "ORDER_ARTIFACTS_INCOMPLETE", "Order, payment, and invoice states are not synchronized");
      }
      await releasePaymentClaim();
      res.json({ data: await orderDetails(db, await orders.findOne({ _id: order._id })) });
      return;
    }

    const now = new Date();
    const paymentStatus = req.body.outcome === "success" ? "paid" : "failed";
    try {
      const paymentResult = await payments.updateOne({ orderId: order._id }, {
        $set: { method: "mock", status: paymentStatus, isMock: true, updatedAt: now, lastAttemptAt: now, paymentAttemptClaim: paymentOperationClaim, ...(paymentStatus === "paid" ? { paidAt: now } : {}) },
        $inc: { attemptCount: 1 }
      });
      if (paymentResult.matchedCount !== 1) throw new HttpError(409, "ORDER_ARTIFACTS_MISSING", "Order payment record is missing");

      const invoiceResult = await invoices.updateOne({ orderId: order._id }, {
        $set: { status: paymentStatus === "paid" ? "issued" : "pending", updatedAt: now, paymentAttemptClaim: paymentOperationClaim, ...(paymentStatus === "paid" ? { issuedAt: now } : {}) }
      });
      if (invoiceResult.matchedCount !== 1) throw new HttpError(409, "ORDER_ARTIFACTS_MISSING", "Order invoice record is missing");

      try {
        const orderResult = await orders.updateOne(
          { _id: order._id, paymentOperationClaim },
          { $set: { paymentStatus, updatedAt: now }, $unset: { paymentOperationClaim: "" } }
        );
        if (orderResult.matchedCount !== 1) throw new HttpError(409, "CONCURRENT_UPDATE", "Order was changed by another request");
      } catch (error) {
        const persisted = await orders.findOne({ _id: order._id, paymentStatus, paymentOperationClaim: { $exists: false } });
        if (!persisted) throw error;
      }

      // A stale marker is harmless after the order-level commit; cleanup ACK
      // failures must not turn a successful payment into a failed response.
      const cleanupResults = await Promise.allSettled([
        payments.updateOne({ orderId: order._id, paymentAttemptClaim: paymentOperationClaim }, { $unset: { paymentAttemptClaim: "" } }),
        invoices.updateOne({ orderId: order._id, paymentAttemptClaim: paymentOperationClaim }, { $unset: { paymentAttemptClaim: "" } })
      ]);
      for (const result of cleanupResults) {
        if (result.status === "rejected") console.error("Mock payment committed but a transient marker could not be cleared", result.reason);
      }
    } catch (error) {
      const committed = await orders.findOne({ _id: order._id, paymentStatus, paymentOperationClaim: { $exists: false } });
      if (!committed) {
        const compensationErrors = [];
        const compensate = async (operation) => {
          try { await operation(); } catch (compensationError) { compensationErrors.push(compensationError); }
        };
        await compensate(async () => {
          const current = await payments.findOne({ orderId: order._id, paymentAttemptClaim: paymentOperationClaim });
          if (!current) return;
          const restored = await payments.replaceOne({ _id: paymentSnapshot._id, paymentAttemptClaim: paymentOperationClaim }, paymentSnapshot);
          if (restored.matchedCount !== 1) throw new Error("Could not restore payment after simulated payment failure");
        });
        await compensate(async () => {
          const current = await invoices.findOne({ orderId: order._id, paymentAttemptClaim: paymentOperationClaim });
          if (!current) return;
          const restored = await invoices.replaceOne({ _id: invoiceSnapshot._id, paymentAttemptClaim: paymentOperationClaim }, invoiceSnapshot);
          if (restored.matchedCount !== 1) throw new Error("Could not restore invoice after simulated payment failure");
        });
        await compensate(async () => {
          await releasePaymentClaim();
        });
        if (compensationErrors.length) throw new AggregateError([error, ...compensationErrors], "Mock payment failed and compensation was incomplete");
        throw error;
      }
    }

    const updated = await orders.findOne({ _id: order._id });
    res.json({ data: await orderDetails(db, updated) });
  });

  router.patch("/:id/status", async (req, res) => {
    if (!req.body.status) throw new HttpError(400, "VALIDATION_ERROR", "status is required");
    const requestedStatus = String(req.body.status).trim().toLowerCase();
    const isCancellation = ["cancelled", "canceled", "cancel", "hủy", "huỷ"].includes(requestedStatus);
    const filter = { _id: toReference(req.params.id, "id") };
    const staff = ["sales", "warehouse", "manager"].includes(req.user.role);
    if (!staff) filter.userId = req.user._id;
    const order = await orders.findOne(filter);
    if (!order) throw notFound("Order not found");
    if (!staff && !isCancellation) throw new HttpError(403, "FORBIDDEN", "Khách hàng chỉ có thể hủy đơn hàng.");
    if (!staff && !canCustomerCancel(order)) throw new HttpError(403, "ORDER_NOT_CANCELLABLE", "Đơn hàng chỉ có thể hủy trước khi chuyển sang trạng thái đang giao.");
    const updated = await transitionOrder({ db, order, user: req.user, status: isCancellation ? "cancelled" : requestedStatus, note: req.body.note || "" });
    res.json({ data: serializeOrder(updated) });
  });
  return router;
}
