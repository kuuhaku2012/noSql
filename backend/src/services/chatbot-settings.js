import crypto from "node:crypto";

const SETTINGS_ID = "global";

function encryptionKey(secret = "") {
  return crypto.createHash("sha256").update(String(secret || "chatbot-dev-key")).digest();
}

export function encryptApiKey(value, secret) {
  const text = String(value || "").trim();
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptApiKey(value, secret) {
  if (!value || typeof value !== "string") return "";
  try {
    const [ivText, tagText, encryptedText] = value.split(".");
    if (!ivText || !tagText || !encryptedText) return "";
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export async function getChatbotSettings(db, config) {
  const saved = await db.collection("chatbot_settings").findOne({ _id: SETTINGS_ID });
  const savedKey = saved?.apiKeyEncrypted ? decryptApiKey(saved.apiKeyEncrypted, config.jwtSecret) : "";
  const apiKey = saved?.disableEnvKey ? "" : savedKey || String(config.geminiApiKey || "").trim();
  return {
    enabled: saved?.enabled !== false,
    model: String(saved?.model || config.geminiModel || "gemini-3-flash-preview").trim(),
    apiKey,
    hasApiKey: Boolean(apiKey),
    showProducts: saved?.showProducts !== false,
    greeting: String(saved?.greeting || "Xin chào! Mình có thể giúp bạn tìm thông tin sản phẩm và chính sách Maison Belle.").trim(),
    updatedAt: saved?.updatedAt || null
  };
}

export function publicChatbotSettings(settings) {
  return {
    enabled: settings.enabled,
    model: settings.model,
    hasApiKey: settings.hasApiKey,
    showProducts: settings.showProducts,
    greeting: settings.greeting,
    updatedAt: settings.updatedAt
  };
}

export { SETTINGS_ID };
