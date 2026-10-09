import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

export function getConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    port,
    mongoUri: env.MONGODB_URI || "mongodb://127.0.0.1:27017",
    databaseName: env.MONGODB_DB || "maison_belle_dev",
    testDatabaseName: env.MONGODB_TEST_DB || "maison_belle_test",
    jwtSecret: env.JWT_SECRET || "change-me-in-development",
    allowDemoSeed: env.ALLOW_DEMO_SEED === "true",
    frontendRoot: path.resolve(sourceDir, "../..")
  };
}
