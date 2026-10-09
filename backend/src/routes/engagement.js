import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

const actionTypes = new Set(["view", "search", "favorite", "cart", "purchase", "consultation"]);

function serialize(value) {
  return { ...value, id: String(value._id), _id: undefined, userId: value.userId ? String(value.userId) : undefined, productId: value.productId ? String(value.productId) : undefined, recommendedProductId: value.recommendedProductId ? String(value.recommendedProductId) : undefined };
}

export function engagementRouter({ db }) {
  const router = Router();
  const recommendations = db.collection("product_recommendations");
  const views = db.collection("product_views");
  const behaviors = db.collection("user_behaviors");

  router.get("/products/:productId/recommendations", async (req, res) => {
    const productId = toReference(req.params.productId, "productId");
    if (!await db.collection("products").findOne({ _id: productId, isActive: true })) throw notFound("Product not found");
    const items = await recommendations.find({ productId, isActive: { $ne: false } }).sort({ rank: 1, createdAt: -1 }).toArray();
    res.json({ data: items.map(serialize), pagination: { page: 1, limit: items.length, total: items.length, totalPages: items.length ? 1 : 0 } });
  });

  router.post("/products/:productId/views", authenticate, async (req, res) => {
    const productId = toReference(req.params.productId, "productId");
    if (!await db.collection("products").findOne({ _id: productId, isActive: true })) throw notFound("Product not found");
    const view = { _id: new ObjectId(), userId: req.user._id, productId, viewedAt: new Date(), source: typeof req.body.source === "string" ? req.body.source.trim() : "product-detail" };
    await views.insertOne(view);
    res.status(201).json({ data: serialize(view) });
  });

  router.post("/behaviors", authenticate, async (req, res) => {
    validateBody({ actionType: { required: true, type: "string" } }, req.body);
    if (!actionTypes.has(req.body.actionType)) throw new HttpError(400, "VALIDATION_ERROR", "actionType is invalid");
    const productId = req.body.productId ? toReference(req.body.productId, "productId") : null;
    if (productId && !await db.collection("products").findOne({ _id: productId, isActive: true })) throw notFound("Product not found");
    if (req.body.metadata !== undefined && (!req.body.metadata || typeof req.body.metadata !== "object" || Array.isArray(req.body.metadata))) throw new HttpError(400, "VALIDATION_ERROR", "metadata must be an object");
    const behavior = { _id: new ObjectId(), userId: req.user._id, productId, actionType: req.body.actionType, metadata: req.body.metadata || {}, createdAt: new Date() };
    await behaviors.insertOne(behavior);
    res.status(201).json({ data: serialize(behavior) });
  });

  router.post("/admin/recommendations", authenticate, requireRoles("manager"), async (req, res) => {
    validateBody({ productId: { required: true }, recommendedProductId: { required: true } }, req.body);
    const productId = toReference(req.body.productId, "productId");
    const recommendedProductId = toReference(req.body.recommendedProductId, "recommendedProductId");
    if (String(productId) === String(recommendedProductId)) throw new HttpError(400, "VALIDATION_ERROR", "A product cannot recommend itself");
    const products = await db.collection("products").countDocuments({ _id: { $in: [productId, recommendedProductId] }, isActive: true });
    if (products !== 2) throw notFound("Product not found");
    if (await recommendations.findOne({ productId, recommendedProductId })) throw new HttpError(409, "RECOMMENDATION_EXISTS", "Recommendation already exists");
    const recommendation = { _id: new ObjectId(), productId, recommendedProductId, rank: Number.isInteger(req.body.rank) && req.body.rank > 0 ? req.body.rank : 1, reason: req.body.reason || "", isActive: req.body.isActive !== false, createdAt: new Date(), updatedAt: new Date(), createdByUserId: req.user._id };
    await recommendations.insertOne(recommendation);
    res.status(201).json({ data: serialize(recommendation) });
  });

  router.patch("/admin/recommendations/:id", authenticate, requireRoles("manager"), async (req, res) => {
    const id = toReference(req.params.id, "id");
    const update = { updatedAt: new Date() };
    if (req.body.rank !== undefined && (!Number.isInteger(req.body.rank) || req.body.rank < 1)) throw new HttpError(400, "VALIDATION_ERROR", "rank must be a positive integer");
    if (req.body.rank !== undefined) update.rank = req.body.rank;
    if (req.body.reason !== undefined) update.reason = String(req.body.reason);
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
      update.isActive = req.body.isActive;
    }
    const saved = await recommendations.findOneAndUpdate({ _id: id }, { $set: update }, { returnDocument: "after" });
    if (!saved) throw notFound("Recommendation not found");
    res.json({ data: serialize(saved) });
  });

  router.delete("/admin/recommendations/:id", authenticate, requireRoles("manager"), async (req, res) => {
    const saved = await recommendations.findOneAndUpdate({ _id: toReference(req.params.id, "id") }, { $set: { isActive: false, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!saved) throw notFound("Recommendation not found");
    res.json({ data: serialize(saved) });
  });

  router.get("/admin/behaviors", authenticate, requireRoles("manager"), async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = req.query.userId ? { userId: toReference(req.query.userId, "userId") } : {};
    const [items, total] = await Promise.all([behaviors.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(), behaviors.countDocuments(filter)]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  return router;
}
