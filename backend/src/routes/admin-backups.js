import { BSON } from "mongodb";
import express, { Router } from "express";
import { HttpError } from "../lib/errors.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

const FORMAT = "maison-belle-mongodb-backup";
const VERSION = 1;
const { EJSON } = BSON;
const MEDIA_TYPE = "application/octet-stream";
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_DOCUMENTS = 250_000;
const validCollectionName = /^(?!system\.)(?!__proto__$)(?!constructor$)(?!prototype$)[a-zA-Z0-9_.-]{1,120}$/;

function appCollections(db) {
  return db.listCollections({}, { nameOnly: true }).toArray().then((items) =>
    items.filter(({ name, type }) => type === "collection" && validCollectionName.test(name)).map(({ name }) => name).sort()
  );
}

function readBackup(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new HttpError(400, "BACKUP_INVALID", "Tệp sao lưu không có dữ liệu.");
  let backup;
  try { backup = EJSON.parse(buffer.toString("utf8")); }
  catch { throw new HttpError(400, "BACKUP_INVALID", "Tệp sao lưu không đúng định dạng JSON Maison Belle."); }
  if (backup?.format !== FORMAT || backup.version !== VERSION || backup.fullSnapshot !== true || !backup.collections || typeof backup.collections !== "object" || Array.isArray(backup.collections)) {
    throw new HttpError(400, "BACKUP_INVALID", "Tệp không phải bản sao lưu đầy đủ được tạo từ Maison Belle.");
  }
  const entries = Object.entries(backup.collections);
  if (!entries.length || entries.length > 200) throw new HttpError(400, "BACKUP_INVALID", "Số lượng bộ dữ liệu trong tệp sao lưu không hợp lệ.");
  let count = 0;
  for (const [name, documents] of entries) {
    if (!validCollectionName.test(name) || !Array.isArray(documents)) throw new HttpError(400, "BACKUP_INVALID", "Tên bộ dữ liệu hoặc danh sách bản ghi không hợp lệ.");
    count += documents.length;
    if (count > MAX_DOCUMENTS) throw new HttpError(413, "BACKUP_TOO_LARGE", "Tệp sao lưu vượt quá giới hạn 250.000 bản ghi.");
    const ids = new Set();
    for (const document of documents) {
      if (!document || typeof document !== "object" || Array.isArray(document) || document._id === undefined) {
        throw new HttpError(400, "BACKUP_INVALID", `Bản ghi trong bộ dữ liệu ${name} thiếu mã định danh.`);
      }
      const id = EJSON.stringify(document._id, { relaxed: false });
      if (ids.has(id)) throw new HttpError(400, "BACKUP_INVALID", `Bộ dữ liệu ${name} có mã định danh bị trùng.`);
      ids.add(id);
    }
  }
  if (!Array.isArray(backup.collections.users) || !backup.collections.users.some((user) => user.role === "manager" && user.isActive === true)) {
    throw new HttpError(400, "BACKUP_MANAGER_REQUIRED", "Bản sao lưu phải có ít nhất một tài khoản quản trị viên đang hoạt động.");
  }
  return backup;
}

export function adminBackupsRouter({ db }) {
  const router = Router();
  router.use(authenticate, requireRoles("manager"));

  router.get("/summary", async (_req, res) => {
    const collections = await appCollections(db);
    const data = await Promise.all(collections.map(async (name) => ({ name, records: await db.collection(name).countDocuments({}) })));
    res.json({ data, totalRecords: data.reduce((sum, collection) => sum + collection.records, 0) });
  });

  router.get("/download", async (_req, res) => {
    const names = await appCollections(db);
    const collections = {};
    let total = 0;
    for (const name of names) {
      const documents = await db.collection(name).find({}).toArray();
      total += documents.length;
      if (total > MAX_DOCUMENTS) throw new HttpError(413, "BACKUP_TOO_LARGE", "Cơ sở dữ liệu vượt quá giới hạn 250.000 bản ghi cho một tệp sao lưu.");
      Object.defineProperty(collections, name, { value: documents, enumerable: true, configurable: true, writable: true });
    }
    const backup = { format: FORMAT, version: VERSION, fullSnapshot: true, createdAt: new Date(), collections };
    const json = EJSON.stringify(backup, { relaxed: false });
    if (Buffer.byteLength(json) > MAX_BYTES) throw new HttpError(413, "BACKUP_TOO_LARGE", "Tệp sao lưu vượt quá giới hạn 50 MB.");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="maison-belle-backup-${stamp}.json"`);
    res.send(json);
  });

  router.post("/restore", express.raw({ type: MEDIA_TYPE, limit: MAX_BYTES }), async (req, res) => {
    const backup = readBackup(req.body);
    const existingNames = await appCollections(db);
    const names = [...new Set([...existingNames, ...Object.keys(backup.collections)])];

    // Full restore replaces every app collection while retaining its existing indexes.
    for (const name of names) await db.collection(name).deleteMany({});
    const restored = {};
    for (const [name, documents] of Object.entries(backup.collections)) {
      if (documents.length) await db.collection(name).insertMany(documents, { ordered: true });
      restored[name] = documents.length;
    }
    res.json({ data: { restored, totalRecords: Object.values(restored).reduce((sum, count) => sum + count, 0) } });
  });

  return router;
}
