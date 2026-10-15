import { ObjectId } from "mongodb";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { createGeminiService } from "../services/gemini.js";

function serialize(article) {
  return {
    ...article,
    id: String(article._id),
    _id: undefined,
    createdBy: article.createdBy ? String(article.createdBy) : null
  };
}

function slugify(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanArticle(body = {}, partial = false) {
  validateBody({
    title: { required: !partial, type: "string", maxLength: 160 },
    slug: { required: false, type: "string", maxLength: 160 },
    category: { required: false, type: "string", maxLength: 80 },
    content: { required: !partial, type: "string", maxLength: 12000 }
  }, body);
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== "string" || tag.length > 40) || body.tags.length > 12)) {
    throw new HttpError(400, "VALIDATION_ERROR", "tags must be an array of at most 12 short strings");
  }
  if (body.isPublished !== undefined && typeof body.isPublished !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isPublished must be boolean");
  if (body.priority !== undefined && (!Number.isInteger(body.priority) || body.priority < 0 || body.priority > 100)) throw new HttpError(400, "VALIDATION_ERROR", "priority must be an integer from 0 to 100");
  const result = {};
  for (const field of ["title", "slug", "category", "content"]) if (body[field] !== undefined) result[field] = String(body[field]).trim();
  if (result.title === "" || result.content === "") throw new HttpError(400, "VALIDATION_ERROR", "title and content cannot be empty");
  if (result.title && !result.slug) result.slug = slugify(result.title);
  if (body.tags !== undefined) result.tags = body.tags.map((tag) => tag.trim()).filter(Boolean);
  if (body.isPublished !== undefined) result.isPublished = body.isPublished;
  if (body.priority !== undefined) result.priority = body.priority;
  return result;
}

async function assertUniqueSlug(collection, slug, excludeId = null) {
  if (!slug) return;
  const filter = { slug };
  if (excludeId) filter._id = { $ne: excludeId };
  if (await collection.findOne(filter, { projection: { _id: 1 } })) throw new HttpError(409, "DUPLICATE_KNOWLEDGE_SLUG", "slug already exists");
}

export function chatRouter({ db, config }) {
  const router = Router();
  const gemini = createGeminiService(config);
  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "Bạn đã gửi quá nhiều câu hỏi. Vui lòng thử lại sau ít phút." }, requestId: req.requestId })
  });
  router.post("/", chatLimiter, async (req, res) => {
    const message = String(req.body?.message || "").trim();
    if (!message) throw new HttpError(400, "VALIDATION_ERROR", "Message is required");
    if (message.length > 1000) throw new HttpError(400, "VALIDATION_ERROR", "Message is too long");
    const articles = await db.collection("knowledge_articles")
      .find({ isPublished: true })
      .sort({ priority: -1, updatedAt: -1 })
      .limit(20)
      .toArray();
    const answer = await gemini.answer({ message, history: req.body?.history, articles });
    res.json({ data: { message: answer, source: "gemini", knowledgeIds: articles.map((article) => String(article._id)) } });
  });
  return router;
}

export function adminKnowledgeRouter({ db }) {
  const router = Router();
  const articles = db.collection("knowledge_articles");
  router.use(authenticate, requireRoles("manager"));

  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const search = req.query.q?.trim() ? escapeRegex(req.query.q.trim()) : "";
    const query = search ? { $or: [
      { title: { $regex: search, $options: "i" } },
      { category: { $regex: search, $options: "i" } },
      { tags: { $regex: search, $options: "i" } }
    ] } : {};
    const [items, total] = await Promise.all([
      articles.find(query).sort({ priority: -1, updatedAt: -1 }).skip(skip).limit(limit).toArray(),
      articles.countDocuments(query)
    ]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.post("/", async (req, res) => {
    const values = cleanArticle(req.body);
    await assertUniqueSlug(articles, values.slug);
    const now = new Date();
    const article = { _id: new ObjectId(), ...values, tags: values.tags || [], isPublished: values.isPublished !== false, priority: values.priority ?? 50, createdBy: req.user._id, createdAt: now, updatedAt: now };
    await articles.insertOne(article);
    res.status(201).json({ data: serialize(article) });
  });

  router.patch("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const values = cleanArticle(req.body, true);
    await assertUniqueSlug(articles, values.slug, id);
    const saved = await articles.findOneAndUpdate({ _id: id }, { $set: { ...values, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!saved) throw notFound("Knowledge article not found");
    res.json({ data: serialize(saved) });
  });

  router.delete("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const saved = await articles.findOneAndUpdate({ _id: id }, { $set: { isPublished: false, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!saved) throw notFound("Knowledge article not found");
    res.json({ data: serialize(saved) });
  });

  return router;
}
