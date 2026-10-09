import { Router } from "express";
import { isDateRangeActive } from "../lib/dates.js";

function serialize(promotion) {
  return {
    ...promotion,
    id: String(promotion._id),
    _id: undefined,
    items: (promotion.items || []).map((item) => ({ ...item, variantId: String(item.variantId) }))
  };
}

export function promotionsRouter({ db }) {
  const router = Router();
  router.get("/", async (_req, res) => {
    const now = new Date();
    const candidates = await db.collection("promotions").find({ isActive: true, startDate: { $lte: now } }).sort({ startDate: 1 }).toArray();
    const data = candidates.filter((promotion) => isDateRangeActive(promotion.startDate, promotion.endDate, now));
    res.json({ data: data.map(serialize), pagination: { page: 1, limit: data.length, total: data.length, totalPages: data.length ? 1 : 0 } });
  });
  return router;
}
