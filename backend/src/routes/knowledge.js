import { ObjectId } from "mongodb";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { createGeminiService } from "../services/gemini.js";
import { getChatbotSettings } from "../services/chatbot-settings.js";

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

function normalizeSearch(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
}

async function findProductContext(db, message) {
  const products = await db.collection("products").find({ isActive: { $ne: false } }).sort({ updatedAt: -1, name: 1 }).limit(80).toArray();
  if (!products.length) return [];
  const normalizedMessage = normalizeSearch(message);
  const tokens = normalizedMessage.split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
  const productSignal = /\b(san pham|gia|mua|ton kho|sku|dau|kem|serum|toner|son|phan|sua|nuoc|my pham|thuong hieu|phan loai|da kho|da dau)\b/i.test(normalizedMessage);
  if (!productSignal) return [];
  const brands = await db.collection("brands").find({ _id: { $in: products.map((item) => item.brandId).filter(Boolean) } }, { projection: { name: 1 } }).toArray();
  const categories = await db.collection("categories").find({ _id: { $in: products.map((item) => item.categoryId).filter(Boolean) } }, { projection: { name: 1 } }).toArray();
  const brandById = new Map(brands.map((item) => [String(item._id), item.name]));
  const categoryById = new Map(categories.map((item) => [String(item._id), item.name]));
  const variants = await db.collection("product_variants").find({ productId: { $in: products.map((item) => item._id) }, isActive: { $ne: false } }).toArray();
  const inventory = await db.collection("inventories").find({ variantId: { $in: variants.map((item) => item._id) } }).toArray();
  const stockByVariant = new Map();
  for (const item of inventory) stockByVariant.set(String(item.variantId), Math.max(0, Number(item.stockQuantity || 0) - Number(item.reservedQuantity || 0)));
  const variantsByProduct = new Map();
  for (const variant of variants) {
    const key = String(variant.productId);
    if (!variantsByProduct.has(key)) variantsByProduct.set(key, []);
    variantsByProduct.get(key).push({ ...variant, availableQuantity: stockByVariant.get(String(variant._id)) ?? 0 });
  }
  const scored = products.map((product) => {
    const searchable = normalizeSearch([product.name, product.slug, product.description, ...(product.skinTypes || []), brandById.get(String(product.brandId)), categoryById.get(String(product.categoryId)), ...(variantsByProduct.get(String(product._id)) || []).map((variant) => variant.sku)].join(" "));
    const score = tokens.reduce((total, token) => total + (searchable.includes(token) ? (normalizeSearch(product.name).includes(token) ? 3 : 1) : 0), 0);
    return { product, score };
  }).sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name)));
  const genericTokens = new Set(["san", "pham", "gia", "mua", "hang", "ton", "kho", "cho", "voi", "cua", "minh", "toi", "ban"]);
  const hasSpecificTokens = tokens.some((token) => token.length >= 4 && !genericTokens.has(token));
  const selected = scored.some((item) => item.score > 0)
    ? scored.filter((item) => item.score > 0).slice(0, 8)
    : hasSpecificTokens ? [] : scored.slice(0, 6);
  return selected.map(({ product }) => ({
    id: String(product._id),
    name: product.name,
    slug: product.slug,
    description: product.description || "",
    brandName: brandById.get(String(product.brandId)) || "",
    categoryName: categoryById.get(String(product.categoryId)) || "",
    imageUrl: (variantsByProduct.get(String(product._id)) || []).find((variant) => variant.imageUrl)?.imageUrl || product.thumbnailUrl || "",
    variants: (variantsByProduct.get(String(product._id)) || []).slice(0, 4).map((variant) => ({
      id: String(variant._id), sku: variant.sku, volume: variant.volume || "", retailPrice: variant.retailPrice, originalPrice: variant.originalPrice, availableQuantity: variant.availableQuantity
    }))
  }));
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
  router.get("/settings", async (_req, res) => {
    const settings = await getChatbotSettings(db, config);
    res.json({ data: { enabled: settings.enabled, greeting: settings.greeting, showProducts: settings.showProducts } });
  });
  router.post("/", chatLimiter, async (req, res) => {
    const message = String(req.body?.message || "").trim();
    if (!message) throw new HttpError(400, "VALIDATION_ERROR", "Message is required");
    if (message.length > 1000) throw new HttpError(400, "VALIDATION_ERROR", "Message is too long");
    const settings = await getChatbotSettings(db, config);
    if (!settings.enabled) throw new HttpError(503, "AI_DISABLED", "Trợ lý chatbot hiện đang tạm tắt.");
    const [articles, products] = await Promise.all([
      db.collection("knowledge_articles").find({ isPublished: true }).sort({ priority: -1, updatedAt: -1 }).limit(20).toArray(),
      settings.showProducts ? findProductContext(db, message) : Promise.resolve([])
    ]);
    const answer = await gemini.answer({ message, history: req.body?.history, articles, products, apiKey: settings.apiKey, model: settings.model });
    res.json({ data: { message: answer, source: "gemini", knowledgeIds: articles.map((article) => String(article._id)), products } });
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
