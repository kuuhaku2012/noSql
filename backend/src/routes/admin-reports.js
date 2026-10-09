import { Router } from "express";
import { HttpError } from "../lib/errors.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { toReference } from "../lib/validation.js";

export function adminReportsRouter({ db }) {
  const router = Router();
  router.use(authenticate, requireRoles("manager"));
  router.get("/", async (req, res) => {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : new Date();
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || to < from) throw new HttpError(400, "VALIDATION_ERROR", "Report date range is invalid");
    const match = { createdAt: { $gte: from, $lte: to }, orderStatus: { $nin: ["cancelled"] } };
    if (req.query.storeId) match.storeId = toReference(req.query.storeId, "storeId");
    const [orderSummary] = await db.collection("orders").aggregate([
      { $match: match },
      { $group: { _id: null, orderIds: { $addToSet: "$_id" }, revenue: { $sum: "$finalAmount" } } },
      { $project: { _id: 0, orderCount: { $size: "$orderIds" }, revenue: 1 } }
    ]).toArray();
    const [itemSummary] = await db.collection("orders").aggregate([
      { $match: match },
      { $unwind: "$items" },
      { $group: { _id: null, itemCount: { $sum: "$items.quantity" } } },
      { $project: { _id: 0, itemCount: 1 } }
    ]).toArray();
    const summary = { orderCount: orderSummary?.orderCount || 0, revenue: orderSummary?.revenue || 0, itemCount: itemSummary?.itemCount || 0 };
    const topProducts = await db.collection("orders").aggregate([
      { $match: match },
      { $unwind: "$items" },
      { $group: { _id: "$items.productId", name: { $first: "$items.productName" }, quantity: { $sum: "$items.quantity" }, revenue: { $sum: "$items.lineTotal" } } },
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, productId: "$_id", name: 1, quantity: 1, revenue: 1 } }
    ]).toArray();
    const [dailySales, orderStatuses] = await Promise.all([
      db.collection("orders").aggregate([
        { $match: match },
        { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
          orderCount: { $sum: 1 },
          revenue: { $sum: "$finalAmount" }
        } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", orderCount: 1, revenue: 1 } }
      ]).toArray(),
      db.collection("orders").aggregate([
        { $match: match },
        { $group: { _id: "$orderStatus", count: { $sum: 1 }, amount: { $sum: "$finalAmount" } } },
        { $sort: { count: -1, _id: 1 } },
        { $project: { _id: 0, status: "$_id", count: 1, amount: 1 } }
      ]).toArray()
    ]);
    res.json({ data: { from, to, summary, dailySales, orderStatuses, topProducts } });
  });
  return router;
}
