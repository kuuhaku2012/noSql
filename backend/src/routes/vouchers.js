import { Router } from "express";
import { HttpError } from "../lib/errors.js";
import { calculateVoucher } from "../lib/vouchers.js";
import { authenticate } from "../middleware/auth.js";

export function vouchersRouter({ db }) {
  const router = Router();
  router.use(authenticate);
  router.post("/validate", async (req, res) => {
    const code = String(req.body.code || "").trim().toUpperCase();
    const subtotal = Number(req.body.subtotal);
    if (!code || !Number.isFinite(subtotal) || subtotal < 0) throw new HttpError(400, "VALIDATION_ERROR", "code and a non-negative subtotal are required");
    const voucher = await db.collection("vouchers").findOne({ code });
    if (!voucher) throw new HttpError(404, "VOUCHER_NOT_FOUND", "Voucher not found");
    if (voucher.totalUsageLimit && voucher.usedCount >= voucher.totalUsageLimit) throw new HttpError(409, "VOUCHER_USAGE_LIMIT", "Voucher usage limit has been reached");
    const result = calculateVoucher(voucher, subtotal);
    res.json({ data: { ...result.snapshot, subtotal, discountAmount: result.discountAmount, finalAmount: subtotal - result.discountAmount } });
  });
  return router;
}
