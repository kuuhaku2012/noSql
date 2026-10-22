import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { Router } from "express";
import { HttpError, notFound } from "../lib/errors.js";
import { parsePagination } from "../lib/pagination.js";
import { validateBody, toReference } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

const roles = new Set(["customer", "sales", "warehouse", "manager"]);

function serialize(user) {
  const { passwordHash: _passwordHash, ...safe } = user;
  return {
    ...safe,
    id: user._id.toString(),
    _id: undefined,
    roleId: user.roleId?.toString()
  };
}

function validateRole(role) {
  if (typeof role !== "string" || !roles.has(role)) throw new HttpError(400, "VALIDATION_ERROR", "role is invalid");
}

function validateProfile(body, partial = false) {
  validateBody({
    email: { required: !partial, type: "string", maxLength: 254 },
    password: { required: !partial, type: "string", maxLength: 200 },
    fullName: { required: !partial, type: "string", maxLength: 160 },
    phone: { type: "string", maxLength: 30 },
    skinType: { type: "string", maxLength: 60 }
  }, body);
  if (body.email !== undefined && !/^\S+@\S+\.\S+$/.test(body.email.trim())) throw new HttpError(400, "VALIDATION_ERROR", "email is invalid");
  if (body.password !== undefined && body.password.length < 6) throw new HttpError(400, "VALIDATION_ERROR", "password must be at least 6 characters");
  if (body.fullName !== undefined && !body.fullName.trim()) throw new HttpError(400, "VALIDATION_ERROR", "fullName cannot be empty");
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
}

export function adminUsersRouter({ db }) {
  const router = Router();
  const users = db.collection("users");
  router.use(authenticate, requireRoles("manager"));

  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.staff === "true") filter.role = { $in: ["manager", "sales", "warehouse"] };
    if (req.query.role) {
      validateRole(req.query.role);
      if (req.query.staff === "true" && req.query.role === "customer") {
        throw new HttpError(400, "VALIDATION_ERROR", "customer is not a staff role");
      }
      filter.role = req.query.role;
    }
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      const query = req.query.q.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [{ email: { $regex: query, $options: "i" } }, { fullName: { $regex: query, $options: "i" } }];
    }
    const [items, total] = await Promise.all([
      users.find(filter).sort({ fullName: 1, email: 1 }).skip(skip).limit(limit).toArray(),
      users.countDocuments(filter)
    ]);
    res.json({ data: items.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.get("/:id", async (req, res) => {
    const user = await users.findOne({ _id: toReference(req.params.id, "id") });
    if (!user) throw notFound("User not found");
    res.json({ data: serialize(user) });
  });

  router.post("/", async (req, res) => {
    validateProfile(req.body);
    validateRole(req.body.role);
    const email = req.body.email.trim().toLowerCase();
    if (await users.findOne({ email })) throw new HttpError(409, "DUPLICATE_USER", "Email already exists");
    if (req.body.phone?.trim() && await users.findOne({ phone: req.body.phone.trim() })) throw new HttpError(409, "DUPLICATE_USER", "Phone already exists");
    const now = new Date();
    const user = {
      _id: new ObjectId(), email, fullName: req.body.fullName.trim(), role: req.body.role,
      roleId: null, phone: req.body.phone?.trim() || undefined, skinType: req.body.skinType?.trim() || undefined,
      passwordHash: await bcrypt.hash(req.body.password, 10), isActive: req.body.isActive !== false, authVersion: 0,
      isDemo: false, createdAt: now, updatedAt: now
    };
    await users.insertOne(user);
    res.status(201).json({ data: serialize(user) });
  });

  router.patch("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    const current = await users.findOne({ _id: id });
    if (!current) throw notFound("User not found");
    validateProfile(req.body, true);
    const update = { updatedAt: new Date() };
    const unset = {};
    if (req.body.email !== undefined) {
      const email = req.body.email.trim().toLowerCase();
      if (await users.findOne({ email, _id: { $ne: id } })) throw new HttpError(409, "DUPLICATE_USER", "Email already exists");
      update.email = email;
    }
    if (req.body.fullName !== undefined) update.fullName = req.body.fullName.trim();
    if (req.body.skinType !== undefined) update.skinType = req.body.skinType.trim();
    if (req.body.phone !== undefined) {
      const phone = req.body.phone.trim();
      if (phone && await users.findOne({ phone, _id: { $ne: id } })) throw new HttpError(409, "DUPLICATE_USER", "Phone already exists");
      if (phone) update.phone = phone;
      else unset.phone = "";
    }
    if (req.body.password !== undefined) update.passwordHash = await bcrypt.hash(req.body.password, 10);
    if (req.body.role !== undefined) {
      validateRole(req.body.role);
      update.role = req.body.role;
    }
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", "isActive must be boolean");
      update.isActive = req.body.isActive;
    }
    const nextRole = update.role ?? current.role;
    const nextActive = update.isActive ?? current.isActive;
    const losingManagerAccess = current.role === "manager" && current.isActive === true && (nextRole !== "manager" || nextActive === false);
    if (String(id) === String(req.user._id) && (nextRole !== "manager" || nextActive === false)) {
      throw new HttpError(409, "SELF_PERMISSION_CHANGE", "You cannot remove your own manager access");
    }
    if (losingManagerAccess && await users.countDocuments({ role: "manager", isActive: true }) <= 1) {
      throw new HttpError(409, "LAST_MANAGER", "At least one active manager is required");
    }
    const operation = { $set: update };
    if (Object.keys(unset).length) operation.$unset = unset;
    if (req.body.password !== undefined || (update.role !== undefined && update.role !== current.role) || (update.isActive !== undefined && update.isActive !== current.isActive)) {
      operation.$inc = { authVersion: 1 };
    }
    const saved = await users.findOneAndUpdate({ _id: id }, operation, { returnDocument: "after" });
    if (!saved) throw notFound("User not found");
    res.json({ data: serialize(saved) });
  });

  router.delete("/:id", async (req, res) => {
    const id = toReference(req.params.id, "id");
    if (String(id) === String(req.user._id)) throw new HttpError(409, "SELF_DEACTIVATION", "You cannot deactivate your own account");
    const target = await users.findOne({ _id: id });
    if (!target) throw notFound("User not found");
    if (target.role === "manager" && target.isActive === true && await users.countDocuments({ role: "manager", isActive: true }) <= 1) {
      throw new HttpError(409, "LAST_MANAGER", "At least one active manager is required");
    }
    const saved = await users.findOneAndUpdate({ _id: id }, { $set: { isActive: false, updatedAt: new Date() }, $inc: { authVersion: 1 } }, { returnDocument: "after" });
    if (!saved) throw notFound("User not found");
    res.json({ data: serialize(saved) });
  });

  return router;
}
