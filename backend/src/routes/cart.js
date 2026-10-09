import { Router } from "express";
import { HttpError } from "../lib/errors.js";
import { validateBody, toReference } from "../lib/validation.js";
import { authenticate } from "../middleware/auth.js";

function serializeCart(cart) {
  return {
    ...cart,
    id: cart?._id?.toString(),
    _id: undefined,
    userId: cart?.userId?.toString(),
    items: (cart?.items || []).map((item) => ({ ...item, variantId: item.variantId?.toString() }))
  };
}

export function cartRouter({ db }) {
  const router = Router();
  const carts = db.collection("carts");
  const variants = db.collection("product_variants");
  router.use(authenticate);

  router.get("/", async (req, res) => {
    const userId = req.user._id;
    const cart = await carts.findOne({ userId });
    res.json({ data: serializeCart(cart || { items: [], userId }) });
  });

  router.put("/", async (req, res) => {
    if (!Array.isArray(req.body.items)) throw new HttpError(400, "VALIDATION_ERROR", "items must be an array");
    const items = req.body.items.map((item) => {
      validateBody({ variantId: { required: true }, quantity: { required: true, type: "positiveInteger" } }, item);
      return { variantId: toReference(item.variantId, "variantId"), quantity: item.quantity, size: item.size || null };
    });
    const variantIds = items.map((item) => item.variantId);
    const count = await variants.countDocuments({ _id: { $in: variantIds }, isActive: true });
    if (count !== items.length) throw new HttpError(409, "VARIANT_NOT_FOUND", "One or more variants are unavailable");
    const now = new Date();
    const cart = { userId: req.user._id, items, updatedAt: now, createdAt: now };
    await carts.replaceOne({ userId: req.user._id }, cart, { upsert: true });
    const saved = await carts.findOne({ userId: req.user._id });
    res.json({ data: serializeCart(saved) });
  });
  return router;
}
