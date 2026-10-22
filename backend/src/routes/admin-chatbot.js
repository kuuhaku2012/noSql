import { Router } from "express";
import { HttpError } from "../lib/errors.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { encryptApiKey, getChatbotSettings, publicChatbotSettings, SETTINGS_ID } from "../services/chatbot-settings.js";

export function adminChatbotRouter({ db, config }) {
  const router = Router();
  router.use(authenticate, requireRoles("manager"));

  router.get("/", async (_req, res) => {
    res.json({ data: publicChatbotSettings(await getChatbotSettings(db, config)) });
  });

  router.patch("/", async (req, res) => {
    const body = req.body || {};
    const update = {};
    if (body.model !== undefined) {
      if (typeof body.model !== "string" || !body.model.trim() || body.model.trim().length > 120) {
        throw new HttpError(400, "VALIDATION_ERROR", "Tên model không hợp lệ.");
      }
      update.model = body.model.trim();
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "Trạng thái chatbot không hợp lệ.");
      update.enabled = body.enabled;
    }
    if (body.showProducts !== undefined) {
      if (typeof body.showProducts !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "Tùy chọn sản phẩm không hợp lệ.");
      update.showProducts = body.showProducts;
    }
    if (body.greeting !== undefined) {
      if (typeof body.greeting !== "string" || body.greeting.trim().length > 280) throw new HttpError(400, "VALIDATION_ERROR", "Lời chào không hợp lệ.");
      update.greeting = body.greeting.trim();
    }
    if (body.apiKey !== undefined) {
      if (typeof body.apiKey !== "string" || body.apiKey.trim().length > 300) throw new HttpError(400, "VALIDATION_ERROR", "API key không hợp lệ.");
      const apiKey = body.apiKey.trim();
      update.apiKeyEncrypted = encryptApiKey(apiKey, config.jwtSecret);
      update.disableEnvKey = !apiKey;
    }
    if (body.clearApiKey === true) {
      update.apiKeyEncrypted = null;
      update.disableEnvKey = true;
    }
    if (!Object.keys(update).length) throw new HttpError(400, "VALIDATION_ERROR", "Chưa có thông tin cần cập nhật.");
    update.updatedAt = new Date();
    update.updatedBy = req.user._id;
    await db.collection("chatbot_settings").updateOne({ _id: SETTINGS_ID }, { $set: update }, { upsert: true });
    res.json({ data: publicChatbotSettings(await getChatbotSettings(db, config)) });
  });

  return router;
}
