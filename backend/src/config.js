import path from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

function parseSmtpPort(value) {
  if (value == null || String(value).trim() === "") return undefined;

  const portText = String(value).trim();
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function isIpOrCidr(value) {
  const parts = value.split("/");
  if (parts.length > 2) return false;

  const family = isIP(parts[0]);
  if (!family) return false;
  if (parts.length === 1) return true;

  const [prefixText] = parts.slice(1);
  if (!/^\d+$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  return prefix <= (family === 4 ? 32 : 128);
}

function parseTrustProxy(value) {
  if (value == null || String(value).trim() === "") return false;

  const trustProxy = String(value).trim();
  if (trustProxy === "true") {
    throw new Error("TRUST_PROXY must be an explicit hop count or IP/CIDR, not true");
  }

  if (/^\d+$/.test(trustProxy)) {
    const hops = Number(trustProxy);
    if (!Number.isSafeInteger(hops)) throw new Error("TRUST_PROXY must be a valid hop count or IP/CIDR");
    return hops;
  }

  const addresses = trustProxy.split(",").map((address) => address.trim());
  if (addresses.some((address) => !address || !isIpOrCidr(address))) {
    throw new Error("TRUST_PROXY must be a valid hop count or IP/CIDR");
  }
  return addresses.join(",");
}

export function getConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const smtpPort = parseSmtpPort(env.SMTP_PORT);
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);

  return {
    port,
    mongoUri: env.MONGODB_URI || "mongodb://127.0.0.1:27017",
    databaseName: env.MONGODB_DB || "maison_belle_dev",
    testDatabaseName: env.MONGODB_TEST_DB || "maison_belle_test",
    jwtSecret: env.JWT_SECRET || "change-me-in-development",
    smtpHost: env.SMTP_HOST || "",
    smtpPort,
    smtpSecure: env.SMTP_SECURE === "true",
    smtpUser: env.SMTP_USER || "",
    smtpPass: env.SMTP_PASS || "",
    smtpFrom: env.SMTP_FROM || "",
    authCodeSecret: env.AUTH_CODE_SECRET || "",
    trustProxy,
    allowDemoSeed: env.ALLOW_DEMO_SEED === "true",
    frontendRoot: path.resolve(sourceDir, "../..")
  };
}
