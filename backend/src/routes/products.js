import { Router } from "express";
import { ObjectId } from "mongodb";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference } from "../lib/validation.js";
import { isDateRangeActive } from "../lib/dates.js";

function serialize(value) {
  return value && typeof value.toHexString === "function" ? value.toHexString() : value;
}

function serializeProduct(product, variants = []) {
  return {
    ...product,
    id: serialize(product._id),
    _id: undefined,
    brandId: serialize(product.brandId),
    categoryId: serialize(product.categoryId),
    variants: variants.map((variant) => ({
      ...variant,
      id: serialize(variant._id),
      _id: undefined,
      productId: serialize(variant.productId)
    }))
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveFilterReference(collection, value, fields) {
  if (!value) return undefined;
  const direct = await collection.findOne({ _id: value }, { projection: { _id: 1 } });
  if (direct) return direct._id;
  const alternatives = [];
  if (fields.includes("_id") && ObjectId.isValid(value)) alternatives.push({ _id: new ObjectId(value) });
  for (const field of fields) {
    if (field === "_id") continue;
    alternatives.push({ [field]: { $regex: `^${escapeRegex(value)}$`, $options: "i" } });
  }
  const match = alternatives.length ? await collection.findOne({ $or: alternatives }, { projection: { _id: 1 } }) : null;
  return match?._id;
}

async function addPromotionPrice(db, variant) {
  const now = new Date();
  const candidates = await db.collection("promotions").find({ isActive: true, startDate: { $lte: now }, "items.variantId": variant._id }).toArray();
  const promotions = candidates.filter((promotion) => isDateRangeActive(promotion.startDate, promotion.endDate, now));
  const offers = promotions.flatMap((promotion) => (promotion.items || [])
    .filter((item) => String(item.variantId) === String(variant._id) && Number(item.promotionPrice) < Number(variant.retailPrice))
    .map((item) => ({ name: promotion.name, id: promotion._id, price: Number(item.promotionPrice) })));
  if (!offers.length) return variant;
  const best = offers.sort((a, b) => a.price - b.price)[0];
  return { ...variant, promotionPrice: best.price, promotionName: best.name, promotionId: serialize(best.id) };
}

function queryFilter(query, variantIds, categoryId, brandId) {
  const filter = { isActive: true };
  if (query.q?.trim()) {
    const escaped = escapeRegex(query.q.trim());
    filter.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { description: { $regex: escaped, $options: "i" } }
    ];
  }
  if (query.category) filter.categoryId = categoryId;
  if (query.brand) filter.brandId = brandId;
  if (query.skinType) filter.skinTypes = query.skinType;
  if (variantIds) filter._id = { $in: variantIds };
  return filter;
}

export function productsRouter({ db }) {
  const router = Router();
  const products = db.collection("products");
  const variants = db.collection("product_variants");
  const inventories = db.collection("inventories");

  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const minPrice = req.query.minPrice === undefined || req.query.minPrice === "" ? null : Number(req.query.minPrice);
    const maxPrice = req.query.maxPrice === undefined || req.query.maxPrice === "" ? null : Number(req.query.maxPrice);
    if ((minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) || (minPrice !== null && maxPrice !== null && minPrice > maxPrice)) {
      throw new HttpError(400, "VALIDATION_ERROR", "Price range is invalid");
    }
    const [categoryId, brandId] = await Promise.all([
      resolveFilterReference(db.collection("categories"), req.query.category, ["_id", "slug", "name"]),
      resolveFilterReference(db.collection("brands"), req.query.brand, ["_id", "code", "slug", "name"])
    ]);
    if ((req.query.category && !categoryId) || (req.query.brand && !brandId)) {
      return res.json({ data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
    }
    const productIdSets = [];
    if (minPrice !== null || maxPrice !== null) {
      const price = {};
      if (minPrice !== null) price.$gte = minPrice;
      if (maxPrice !== null) price.$lte = maxPrice;
      const matches = await variants.find({ retailPrice: price, isActive: true }).project({ productId: 1 }).toArray();
      productIdSets.push(new Set(matches.map((item) => String(item.productId))));
    }
    if (["true", "1"].includes(String(req.query.sale).toLowerCase())) {
      const now = new Date();
      const candidates = await db.collection("promotions").find({ isActive: true, startDate: { $lte: now } }).project({ items: 1, startDate: 1, endDate: 1 }).toArray();
      const promotions = candidates.filter((promotion) => isDateRangeActive(promotion.startDate, promotion.endDate, now));
      const variantRefs = promotions.flatMap((promotion) => (promotion.items || [])
        .filter((item) => Number(item.promotionPrice) > 0)
        .map((item) => item.variantId));
      const saleVariants = variantRefs.length
        ? await variants.find({ _id: { $in: variantRefs }, isActive: true }).project({ productId: 1, _id: 1, retailPrice: 1 }).toArray()
        : [];
      const variantById = new Map(saleVariants.map((variant) => [String(variant._id), variant]));
      const saleProductIds = new Set();
      for (const promotion of promotions) for (const offer of promotion.items || []) {
        const variant = variantById.get(String(offer.variantId));
        if (variant && Number(offer.promotionPrice) < Number(variant.retailPrice)) saleProductIds.add(String(variant.productId));
      }
      productIdSets.push(saleProductIds);
    }
    const productIds = productIdSets.length
      ? [...productIdSets[0]].filter((id) => productIdSets.every((set) => set.has(id))).map((id) => new ObjectId(id))
      : undefined;
    if (productIds && !productIds.length) return res.json({ data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
    const filter = queryFilter(req.query, productIds, categoryId, brandId);
    const priceSort = req.query.sort === "priceAsc" || req.query.sort === "priceDesc";
    const sort = req.query.sort === "nameDesc" ? { name: -1 } : req.query.sort === "nameAsc" ? { name: 1 } : { createdAt: -1, name: 1 };
    const [items, total] = await Promise.all([
      priceSort
        ? products.aggregate([
          { $match: filter },
          { $lookup: { from: "product_variants", let: { productId: "$_id" }, pipeline: [{ $match: { $expr: { $eq: ["$productId", "$$productId"] }, isActive: true } }], as: "_variants" } },
          { $addFields: { _sortPrice: { $min: "$_variants.retailPrice" } } },
          { $sort: { _sortPrice: req.query.sort === "priceAsc" ? 1 : -1, name: 1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { _variants: 0, _sortPrice: 0 } }
        ]).toArray()
        : products.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
      products.countDocuments(filter)
    ]);
    const data = await Promise.all(items.map(async (product) => {
      const [productVariants, brand, category] = await Promise.all([
        variants.find({ productId: product._id, isActive: true }).toArray(),
        db.collection("brands").findOne({ _id: product.brandId }, { projection: { name: 1 } }),
        db.collection("categories").findOne({ _id: product.categoryId }, { projection: { name: 1 } })
      ]);
      const pricedVariants = await Promise.all(productVariants.map((variant) => addPromotionPrice(db, variant)));
      return { ...serializeProduct(product, pricedVariants), brandName: brand?.name || "", categoryName: category?.name || "" };
    }));
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.get("/:id", async (req, res) => {
    const reference = toReference(req.params.id, "id");
    const product = await products.findOne({ $or: [{ _id: reference }, { slug: req.params.id }], isActive: true });
    if (!product) throw notFound("Product not found");
    const productVariants = await variants.find({ productId: product._id, isActive: true }).toArray();
    const inventory = await inventories.find({ variantId: { $in: productVariants.map((variant) => variant._id) } }).toArray();
    const stockByVariant = new Map(inventory.map((item) => [String(item.variantId), Math.max(0, item.stockQuantity - item.reservedQuantity)]));
    const withStock = await Promise.all(productVariants.map(async (variant) => addPromotionPrice(db, { ...variant, availableQuantity: stockByVariant.get(String(variant._id)) || 0 })));
    const [brand, category] = await Promise.all([
      db.collection("brands").findOne({ _id: product.brandId }, { projection: { name: 1 } }),
      db.collection("categories").findOne({ _id: product.categoryId }, { projection: { name: 1 } })
    ]);
    res.json({ data: { ...serializeProduct(product, withStock), brandName: brand?.name || "", categoryName: category?.name || "" } });
  });
  return router;
}

export { serializeProduct };
