import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

const statuses = new Set(["pending", "approved", "rejected", "hidden"]);

function serialize(review) {
  return {
    ...review,
    id: String(review._id),
    _id: undefined,
    userId: review.userId ? String(review.userId) : undefined,
    productId: review.productId ? String(review.productId) : undefined
  };
}

function validateReview(body, partial = false) {
  validateBody({ rating: { required: !partial }, comment: { required: !partial, type: "string", maxLength: 2000 } }, body);
  if (body.rating !== undefined && (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5)) throw new HttpError(400, "VALIDATION_ERROR", "rating must be an integer from 1 to 5");
  if (body.comment !== undefined && !body.comment.trim()) throw new HttpError(400, "VALIDATION_ERROR", "comment cannot be empty");
}

export function reviewsRouter({ db }) {
  const router = Router();
  const reviews = db.collection("reviews");

  router.get("/products/:productId/reviews", async (req, res) => {
    const productId = toReference(req.params.productId, "productId");
    if (!await db.collection("products").findOne({ _id: productId, isActive: true })) throw notFound("Product not found");
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { productId, status: "approved", isHidden: { $ne: true } };
    const [items, total] = await Promise.all([
      reviews.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      reviews.countDocuments(filter)
    ]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.post("/products/:productId/reviews", authenticate, async (req, res) => {
    const productId = toReference(req.params.productId, "productId");
    if (!await db.collection("products").findOne({ _id: productId, isActive: true })) throw notFound("Product not found");
    validateReview(req.body);
    if (await reviews.findOne({ userId: req.user._id, productId, status: { $in: ["pending", "approved"] } })) throw new HttpError(409, "REVIEW_EXISTS", "You already reviewed this product");
    const now = new Date();
    const review = { _id: new ObjectId(), userId: req.user._id, productId, rating: req.body.rating, comment: req.body.comment.trim(), status: "pending", isApproved: false, isHidden: false, createdAt: now, updatedAt: now };
    await reviews.insertOne(review);
    res.status(201).json({ data: serialize(review) });
  });

  router.patch("/reviews/:id", authenticate, async (req, res) => {
    const id = toReference(req.params.id, "id");
    const current = await reviews.findOne({ _id: id });
    if (!current) throw notFound("Review not found");
    const manager = ["sales", "manager"].includes(req.user.role);
    if (!manager && String(current.userId) !== String(req.user._id)) throw notFound("Review not found");
    if (!manager && current.status !== "pending") throw new HttpError(409, "REVIEW_LOCKED", "Only pending reviews can be edited");
    validateReview(req.body, true);
    const update = { updatedAt: new Date() };
    if (req.body.rating !== undefined) update.rating = req.body.rating;
    if (req.body.comment !== undefined) update.comment = req.body.comment.trim();
    if (manager && req.body.status !== undefined) {
      if (!statuses.has(req.body.status)) throw new HttpError(400, "VALIDATION_ERROR", "Review status is invalid");
      update.status = req.body.status;
      update.isApproved = req.body.status === "approved";
      update.isHidden = req.body.status === "hidden";
      update.moderatedByUserId = req.user._id;
      update.moderatedAt = update.updatedAt;
    } else if (!manager && req.body.status !== undefined) {
      throw new HttpError(403, "FORBIDDEN", "Customers cannot moderate reviews");
    }
    const saved = await reviews.findOneAndUpdate({ _id: id }, { $set: update }, { returnDocument: "after" });
    res.json({ data: serialize(saved) });
  });

  router.get("/admin/reviews", authenticate, requireRoles("sales", "manager"), async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = req.query.status ? { status: req.query.status } : {};
    const [items, total] = await Promise.all([
      reviews.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      reviews.countDocuments(filter)
    ]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  return router;
}
