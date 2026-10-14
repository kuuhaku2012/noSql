import "dotenv/config";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { closeDatabase, connectDatabase } from "./db.js";
import { migrateModel } from "../scripts/migrate-model.js";

const config = getConfig();
const { client, db } = await connectDatabase(config);
await migrateModel(db);
const app = createApp({ db, config });
app.set("trust proxy", config.trustProxy);
const server = app.listen(config.port, () => {
  console.log(`Maison Belle backend listening on http://localhost:${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(async () => {
    await closeDatabase(client);
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
