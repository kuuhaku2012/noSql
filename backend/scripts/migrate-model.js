import { closeDatabase, connectDatabase } from "../src/db.js";
import { getConfig } from "../src/config.js";
import { collections } from "../src/collections.js";
import { createIndexes } from "./create-indexes.js";

export async function migrateModel(db) {
  const c = collections(db);
  const operations = [
    [c.brands, { logoUrl: { $exists: false } }, { $set: { logoUrl: null } }],
    [c.categories, { parentCategoryId: { $exists: false } }, { $set: { parentCategoryId: null } }],
    [c.stores, { latitude: { $exists: false } }, { $set: { latitude: null } }],
    [c.stores, { longitude: { $exists: false } }, { $set: { longitude: null } }],
    [c.users, { avatarUrl: { $exists: false } }, { $set: { avatarUrl: null } }],
    [c.variants, { colorCode: { $exists: false } }, { $set: { colorCode: null } }],
    [c.orders, { district: { $exists: false } }, { $set: { district: null } }],
    [c.orders, { ward: { $exists: false } }, { $set: { ward: null } }],
    [c.appointments, { products: { $exists: false } }, { $set: { products: [] } }]
  ];
  for (const [collection, filter, update] of operations) await collection.updateMany(filter, update);
  await createIndexes(db);
  return { migratedCollections: 9 };
}

async function main() {
  const config = getConfig();
  const { client, db } = await connectDatabase(config);
  try {
    console.log(JSON.stringify(await migrateModel(db)));
  } finally {
    await closeDatabase(client);
  }
}

if (process.argv[1]?.endsWith("migrate-model.js")) await main();
