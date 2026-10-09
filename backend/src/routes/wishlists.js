import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate } from "../middleware/auth.js";

function serialize(wishlist) {
  return { ...wishlist, id: String(wishlist._id), _id: undefined, userId: String(wishlist.userId), items: (wishlist.items || []).map((item) => ({ ...item, productId: String(item.productId) })) };
}

export function wishlistsRouter({ db }) {
  const router = Router();
  const wishlists = db.collection("wishlists");

  router.get("/wishlist", authenticate, async (req, res) => {
    const wishlist = await wishlists.findOne({ userId: req.user._id });
    res.json({ data: serialize(wishlist || { _id: new ObjectId(), userId: req.user._id, items: [] }) });
  });

  router.put("/wishlist", authenticate, async (req, res) => {
    if (!Array.isArray(req.body.items)) throw new HttpError(400, "VALIDATION_ERROR", "items must be an array");
    const productIds = req.body.items.map((item) => {
      validateBody({ productId: { required: true } }, item);
      return toReference(item.productId, "productId");
    });
    if (new Set(productIds.map(String)).size !== productIds.length) throw new HttpError(409, "DUPLICATE_WISHLIST_ITEM", "A product may appear only once in a wishlist");
    if (productIds.length && await db.collection("products").countDocuments({ _id: { $in: productIds }, isActive: true }) !== productIds.length) throw new HttpError(404, "PRODUCT_NOT_FOUND", "One or more products were not found");
    const now = new Date();
    const current = await wishlists.findOne({ userId: req.user._id });
    const oldDates = new Map((current?.items || []).map((item) => [String(item.productId), item.addedAt]));
    const wishlist = { _id: current?._id || new ObjectId(), userId: req.user._id, items: productIds.map((productId) => ({ productId, addedAt: oldDates.get(String(productId)) || now })), createdAt: current?.createdAt || now, updatedAt: now };
    await wishlists.replaceOne({ userId: req.user._id }, wishlist, { upsert: true });
    res.json({ data: serialize(wishlist) });
  });

  router.delete("/wishlist/items/:productId", authenticate, async (req, res) => {
    const productId = toReference(req.params.productId, "productId");
    const current = await wishlists.findOne({ userId: req.user._id });
    if (!current) throw notFound("Wishlist not found");
    const items = (current.items || []).filter((item) => String(item.productId) !== String(productId));
    const saved = await wishlists.findOneAndUpdate({ _id: current._id, userId: req.user._id }, { $set: { items, updatedAt: new Date() } }, { returnDocument: "after" });
    res.json({ data: serialize(saved) });
  });

  return router;
}
