import { MongoClient } from "mongodb";

export async function connectDatabase(config) {
  const client = new MongoClient(config.mongoUri);
  await client.connect();
  return { client, db: client.db(config.databaseName) };
}

export async function closeDatabase(client) {
  if (client) await client.close();
}
