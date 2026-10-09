import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { validateBody, toReference } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { serializeProduct } from "./products.js";

function validateVariantInput(variant, { partial = false } = {}) {
  validateBody({
    sku: { required: !partial, type: "string", maxLength: 120 },
    retailPrice: { required: !partial, type: "nonNegativeNumber" },
    originalPrice: { type: "nonNegativeNumber" }
  }, variant);
  if (variant.sku !== undefined && !variant.sku.trim()) throw new HttpError(400, "VALIDATION_ERROR", "Variant sku cannot be empty");
  return variant;
}

function assertUniqueSkus(skus) {
  if (new Set(skus).size !== skus.length) throw new HttpError(409, "DUPLICATE_SKU", "Variant sku must be unique");
}

function validateProductPatch(body) {
  validateBody({
    name: { type: "string", maxLength: 160 },
    slug: { type: "string", maxLength: 180 },
    description: { type: "string" },
    ingredients: { type: "string" },
    howToUse: { type: "string" }
  }, body);
  if (body.name !== undefined && !body.name.trim()) throw new HttpError(400, "VALIDATION_ERROR", "Product name cannot be empty");
  if (body.slug !== undefined && !body.slug.trim()) throw new HttpError(400, "VALIDATION_ERROR", "Product slug cannot be empty");
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
  if (body.skinTypes !== undefined && !Array.isArray(body.skinTypes)) throw new HttpError(400, "VALIDATION_ERROR", "skinTypes must be an array");
  if (body.variants !== undefined && !Array.isArray(body.variants)) throw new HttpError(400, "VALIDATION_ERROR", "variants must be an array");
}

export function adminProductsRouter({ db }) {
  const router = Router();
  const products = db.collection("products");
  const variants = db.collection("product_variants");

  router.use(authenticate, requireRoles("sales", "warehouse", "manager"));
  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = req.query.q ? { name: { $regex: req.query.q, $options: "i" } } : {};
    const [items, total] = await Promise.all([
      products.find(filter).sort({ updatedAt: -1, name: 1 }).skip(skip).limit(limit).toArray(),
      products.countDocuments(filter)
    ]);
    const data = await Promise.all(items.map(async (product) => serializeProduct(product, await variants.find({ productId: product._id }).toArray())));
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.post("/", requireRoles("sales", "manager"), async (req, res) => {
    validateBody({ name: { required: true, type: "string", maxLength: 160 }, slug: { required: true, type: "string", maxLength: 180 }, brandId: { required: true }, categoryId: { required: true } }, req.body);
    const brandId = toReference(req.body.brandId, "brandId");
    const categoryId = toReference(req.body.categoryId, "categoryId");
    const [brand, category] = await Promise.all([
      db.collection("brands").findOne({ _id: brandId }),
      db.collection("categories").findOne({ _id: categoryId })
    ]);
    if (!brand || !category) throw notFound("Brand or category not found");
    if (req.body.isActive !== undefined && typeof req.body.isActive !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
    if (req.body.skinTypes !== undefined && !Array.isArray(req.body.skinTypes)) throw new HttpError(400, "VALIDATION_ERROR", "skinTypes must be an array");
    const inputVariants = Array.isArray(req.body.variants) ? req.body.variants : [];
    if (!inputVariants.length) throw new HttpError(400, "VALIDATION_ERROR", "At least one variant is required");
    inputVariants.forEach((variant) => validateVariantInput(variant));
    assertUniqueSkus(inputVariants.map((variant) => variant.sku.trim()));
    if (await variants.countDocuments({ sku: { $in: inputVariants.map((variant) => variant.sku.trim()) } })) {
      throw new HttpError(409, "DUPLICATE_SKU", "Variant sku must be unique");
    }
    const now = new Date();
    const product = { name: req.body.name.trim(), slug: req.body.slug.trim(), brandId, categoryId, description: req.body.description || "", ingredients: req.body.ingredients || "", howToUse: req.body.howToUse || "", skinTypes: req.body.skinTypes || [], isActive: req.body.isActive !== false, isDemo: false, createdAt: now, updatedAt: now };
    const variantDocs = inputVariants.map((variant) => ({ _id: new ObjectId(), productId: null, sku: variant.sku.trim(), barcode: variant.barcode || null, colorName: variant.colorName || null, volume: variant.volume || null, originalPrice: variant.originalPrice ?? variant.retailPrice, retailPrice: variant.retailPrice, imageUrl: variant.imageUrl || null, isActive: true, isDemo: false }));
    let inserted;
    try {
      inserted = await products.insertOne(product);
      for (const variant of variantDocs) variant.productId = inserted.insertedId;
      await variants.insertMany(variantDocs);
    } catch (error) {
      if (inserted?.insertedId) {
        await variants.deleteMany({ productId: inserted.insertedId });
        await products.deleteOne({ _id: inserted.insertedId });
      }
      if (error.code === 11000) throw new HttpError(409, "DUPLICATE_PRODUCT", "Product slug or variant sku already exists");
      throw error;
    }
    res.status(201).json({ data: serializeProduct({ ...product, _id: inserted.insertedId }, variantDocs) });
  });

  router.patch("/:id", requireRoles("sales", "manager"), async (req, res) => {
    const id = toReference(req.params.id, "id");
    const original = await products.findOne({ _id: id });
    if (!original) throw notFound("Product not found");
    validateProductPatch(req.body);
    const update = {};
    for (const field of ["name", "slug", "description", "ingredients", "howToUse", "skinTypes", "isActive"]) {
      if (req.body[field] !== undefined) update[field] = typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field];
    }
    update.updatedAt = new Date();
    let originalVariants;
    let operations = [];
    if (Array.isArray(req.body.variants)) {
      originalVariants = await variants.find({ productId: id }).toArray();
      const existing = originalVariants;
      const existingById = new Map(existing.map((variant) => [String(variant._id), variant]));
      const requestedSkus = [];
      const touchedVariantIds = new Set();
      for (const input of req.body.variants) {
        const variantId = input.id ? toReference(input.id, "variantId") : null;
        const current = variantId ? existingById.get(String(variantId)) : null;
        validateVariantInput(input, { partial: Boolean(current) });
        if (variantId && !current) throw notFound("Variant not found for product");
        if (current) touchedVariantIds.add(String(current._id));
        const sku = input.sku?.trim() || current?.sku;
        requestedSkus.push(sku);
        const fields = {};
        for (const field of ["sku", "barcode", "colorName", "volume", "originalPrice", "retailPrice", "imageUrl", "isActive"]) {
          if (input[field] !== undefined) fields[field] = field === "sku" ? input[field].trim() : input[field];
        }
        if (!variantId) operations.push({ insertOne: { document: { _id: new ObjectId(), productId: id, sku, barcode: input.barcode || null, colorName: input.colorName || null, volume: input.volume || null, originalPrice: input.originalPrice ?? input.retailPrice, retailPrice: input.retailPrice, imageUrl: input.imageUrl || null, isActive: input.isActive !== false, isDemo: false } } });
        else if (Object.keys(fields).length) operations.push({ updateOne: { filter: { _id: variantId, productId: id }, update: { $set: fields } } });
      }
      assertUniqueSkus(requestedSkus);
      const existingOtherSkus = existing.filter((variant) => !touchedVariantIds.has(String(variant._id))).map((variant) => variant.sku);
      const conflictSkus = [...requestedSkus, ...existingOtherSkus];
      assertUniqueSkus(conflictSkus);
      if (await variants.countDocuments({ sku: { $in: requestedSkus }, productId: { $ne: id } })) throw new HttpError(409, "DUPLICATE_SKU", "Variant sku must be unique");
    }
    try {
      const result = await products.updateOne({ _id: id }, { $set: update });
      if (!result.matchedCount) throw notFound("Product not found");
      if (operations.length) await variants.bulkWrite(operations);
    } catch (error) {
      await products.replaceOne({ _id: id }, original);
      if (originalVariants) {
        await variants.deleteMany({ productId: id });
        if (originalVariants.length) await variants.insertMany(originalVariants);
      }
      if (error.code === 11000) throw new HttpError(409, "DUPLICATE_PRODUCT", "Product slug or variant sku already exists");
      throw error;
    }
    const saved = await products.findOne({ _id: id });
    const productVariants = await variants.find({ productId: id }).toArray();
    res.json({ data: serializeProduct(saved, productVariants) });
  });

  router.delete("/:id", requireRoles("sales", "manager"), async (req, res) => {
    const id = toReference(req.params.id, "id");
    const updatedAt = new Date();
    const original = await products.findOne({ _id: id });
    if (!original) throw notFound("Product not found");
    const result = await products.updateOne({ _id: id }, { $set: { isActive: false, updatedAt } });
    if (!result.matchedCount) throw notFound("Product not found");
    try {
      await variants.updateMany({ productId: id }, { $set: { isActive: false, updatedAt } });
    } catch (error) {
      await products.replaceOne({ _id: id }, original);
      throw error;
    }
    const product = await products.findOne({ _id: id });
    const productVariants = await variants.find({ productId: id }).toArray();
    res.json({ data: serializeProduct(product, productVariants) });
  });
  return router;
}
