import { Router } from "express";
import { HttpError, validationError } from "../lib/errors.js";
import { validateBody } from "../lib/validation.js";

function publicRate(rate) {
  return {
    regionCode: rate.code,
    regionName: rate.regionName,
    fee: rate.fee,
    currency: "VND",
    isDemo: true
  };
}

export function shippingRouter({ db }) {
  const router = Router();
  const shippingRates = db.collection("shipping_rates");

  router.get("/rates", async (_req, res) => {
    const rates = await shippingRates.find({ isActive: true }).sort({ code: 1 }).toArray();
    res.json({ data: rates.map(publicRate) });
  });

  router.post("/quote", async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw validationError();
    validateBody({ regionCode: { required: true, type: "string" } }, req.body);
    const regionCode = req.body.regionCode.trim().toLowerCase();
    if (!regionCode) throw validationError(undefined, [{ field: "regionCode", message: "Field is required" }]);
    const rate = await shippingRates.findOne({ code: regionCode, isActive: true });
    if (!rate) throw new HttpError(409, "SHIPPING_UNAVAILABLE", "This delivery region is not supported");
    res.json({ data: publicRate(rate) });
  });

  return router;
}
