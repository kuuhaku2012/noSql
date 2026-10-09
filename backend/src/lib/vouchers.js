import { HttpError } from "./errors.js";
import { inclusiveEndDate } from "./dates.js";

export function calculateVoucher(voucher, subtotal, now = new Date()) {
  const current = new Date(now);
  const start = new Date(voucher.startDate);
  const end = inclusiveEndDate(voucher.endDate);
  if (!voucher.isActive) throw new HttpError(409, "VOUCHER_INACTIVE", "Voucher is inactive");
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || current < start || current > end) {
    throw new HttpError(409, "VOUCHER_EXPIRED", "Voucher is outside its valid period");
  }
  if (subtotal < Number(voucher.minOrderValue || 0)) {
    throw new HttpError(409, "VOUCHER_MIN_ORDER", "Order does not meet the voucher minimum");
  }

  let discountAmount = voucher.discountType === "percentage"
    ? Math.floor(subtotal * Number(voucher.discountValue || 0) / 100)
    : Number(voucher.discountValue || 0);
  if (voucher.maxDiscountAmount) discountAmount = Math.min(discountAmount, Number(voucher.maxDiscountAmount));
  discountAmount = Math.max(0, Math.min(discountAmount, subtotal));
  return {
    discountAmount,
    snapshot: {
      code: voucher.code,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      discountAmount,
      minOrderValue: voucher.minOrderValue || 0,
      maxDiscountAmount: voucher.maxDiscountAmount || null
    }
  };
}
