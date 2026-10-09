import { Router } from "express";

function serialize(item) {
  return { ...item, id: String(item._id), _id: undefined };
}

export function catalogRouter({ db }) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const [categories, brands] = await Promise.all([
      db.collection("categories").find({ isActive: { $ne: false } }).sort({ name: 1 }).toArray(),
      db.collection("brands").find({ isActive: { $ne: false } }).sort({ name: 1 }).toArray()
    ]);
    res.json({ data: { categories: categories.map(serialize), brands: brands.map(serialize) } });
  });

  return router;
}
