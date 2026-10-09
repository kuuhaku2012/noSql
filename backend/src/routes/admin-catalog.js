import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { toReference, validateBody } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

const resources = {
  categories: { collection: "categories", unique: ["slug"], fields: ["name", "slug", "description", "isActive"] },
  brands: { collection: "brands", unique: ["code", "slug"], fields: ["name", "code", "slug", "origin", "isActive"] },
  stores: { collection: "stores", unique: ["code"], fields: ["name", "code", "address", "phone", "isActive"] }
};

function serialize(item) {
  return { ...item, id: String(item._id), _id: undefined };
}

function getResource(kind) {
  const resource = resources[kind];
  if (!resource) throw new HttpError(404, "NOT_FOUND", "Catalog type not found");
  return resource;
}

function normalizeValues(kind, body, { partial = false } = {}) {
  const required = kind === "categories" ? ["name", "slug"] : ["name"];
  const schema = Object.fromEntries(required.map((field) => [field, { required: !partial, type: "string", maxLength: field === "name" ? 120 : 160 }]));
  for (const field of ["code", "slug", "description", "origin"]) schema[field] = { type: "string", maxLength: 160 };
  validateBody(schema, body);
  const result = {};
  for (const field of resources[kind].fields) {
    if (body[field] === undefined) continue;
    if (field === "isActive" && typeof body[field] !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
    if (typeof body[field] === "string") result[field] = body[field].trim();
    else result[field] = body[field];
  }
  if (result.name === "" || result.slug === "") throw new HttpError(400, "VALIDATION_ERROR", "Name and slug cannot be empty");
  if (result.code !== undefined) result.code = result.code.toUpperCase();
  return result;
}

async function assertUnique(collection, resource, values, excludeId = null) {
  for (const field of resource.unique) {
    if (!values[field]) continue;
    const filter = { [field]: values[field] };
    if (excludeId) filter._id = { $ne: excludeId };
    if (await collection.findOne(filter)) throw new HttpError(409, "DUPLICATE_CATALOG_VALUE", `${field} already exists`);
  }
}

export function adminCatalogRouter({ db }) {
  const router = Router();
  router.use(authenticate, requireRoles("sales", "warehouse", "manager"));

  router.get("/", async (_req, res) => {
    const [categories, brands, stores] = await Promise.all([
      db.collection("categories").find({}).sort({ name: 1 }).toArray(),
      db.collection("brands").find({}).sort({ name: 1 }).toArray(),
      db.collection("stores").find({}).sort({ name: 1 }).toArray()
    ]);
    res.json({ data: { categories: categories.map(serialize), brands: brands.map(serialize), stores: stores.map(serialize) } });
  });

  router.get("/:kind", async (req, res) => {
    const resource = getResource(req.params.kind);
    const { page, limit, skip } = parsePagination(req.query);
    const collection = db.collection(resource.collection);
    const [items, total] = await Promise.all([
      collection.find({}).sort({ name: 1 }).skip(skip).limit(limit).toArray(),
      collection.countDocuments({})
    ]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.get("/:kind/:id", async (req, res) => {
    const resource = getResource(req.params.kind);
    const item = await db.collection(resource.collection).findOne({ _id: toReference(req.params.id, "id") });
    if (!item) throw notFound("Catalog item not found");
    res.json({ data: serialize(item) });
  });

  router.post("/:kind", requireRoles("manager"), async (req, res) => {
    const resource = getResource(req.params.kind);
    const values = normalizeValues(req.params.kind, req.body);
    const collection = db.collection(resource.collection);
    await assertUnique(collection, resource, values);
    const item = { _id: new ObjectId(), ...values, isActive: values.isActive !== false, isDemo: false, createdAt: new Date(), updatedAt: new Date() };
    await collection.insertOne(item);
    res.status(201).json({ data: serialize(item) });
  });

  router.patch("/:kind/:id", requireRoles("manager"), async (req, res) => {
    const resource = getResource(req.params.kind);
    const id = toReference(req.params.id, "id");
    const collection = db.collection(resource.collection);
    if (!await collection.findOne({ _id: id })) throw notFound("Catalog item not found");
    const values = normalizeValues(req.params.kind, req.body, { partial: true });
    await assertUnique(collection, resource, values, id);
    const saved = await collection.findOneAndUpdate({ _id: id }, { $set: { ...values, updatedAt: new Date() } }, { returnDocument: "after" });
    res.json({ data: serialize(saved) });
  });

  router.delete("/:kind/:id", requireRoles("manager"), async (req, res) => {
    const resource = getResource(req.params.kind);
    const id = toReference(req.params.id, "id");
    const saved = await db.collection(resource.collection).findOneAndUpdate({ _id: id }, { $set: { isActive: false, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!saved) throw notFound("Catalog item not found");
    res.json({ data: serialize(saved) });
  });

  return router;
}
