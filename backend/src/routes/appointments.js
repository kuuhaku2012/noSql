import { Router } from "express";
import { ObjectId } from "mongodb";
import { HttpError, notFound } from "../lib/errors.js";
import { appointmentTransitions, assertTransition } from "../lib/status.js";
import { validateBody, toReference } from "../lib/validation.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

function serializeAppointment(item) {
  return { ...item, id: item._id.toString(), _id: undefined, userId: item.userId?.toString(), employeeId: item.employeeId?.toString(), products: (item.products || []).map((product) => ({ ...product, productId: product.productId?.toString(), variantId: product.variantId?.toString() })) };
}

function appointmentWindow(input) {
  validateBody({ appointmentDate: { required: true, type: "string" }, startTime: { required: true, type: "string" }, endTime: { required: true, type: "string" } }, input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.appointmentDate)) throw new HttpError(400, "VALIDATION_ERROR", "appointmentDate must use YYYY-MM-DD");
  const appointmentDate = new Date(`${input.appointmentDate}T00:00:00.000Z`);
  const startTime = input.startTime;
  const endTime = input.endTime;
  if (Number.isNaN(appointmentDate.valueOf()) || appointmentDate.toISOString().slice(0, 10) !== input.appointmentDate) throw new HttpError(400, "VALIDATION_ERROR", "appointmentDate must be a valid date");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime) {
    throw new HttpError(400, "VALIDATION_ERROR", "Appointment time range is invalid");
  }
  return { appointmentDate, startTime, endTime };
}

async function withDateLock(db, dateKey, work) {
  const locks = db.collection("appointment_locks");
  const token = new ObjectId().toHexString();
  let acquired = false;
  for (let attempt = 0; attempt < 5 && !acquired; attempt += 1) {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + 5000);
    try {
      const lock = await locks.findOneAndUpdate(
        { _id: dateKey, $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }] },
        { $set: { lockedUntil, token } },
        { upsert: true, returnDocument: "after" }
      );
      acquired = lock?.token === token;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!acquired) throw new HttpError(409, "APPOINTMENT_SLOT_UNAVAILABLE", "The selected appointment date is busy; please retry");
  try {
    return await work();
  } finally {
    await locks.deleteOne({ _id: dateKey, token });
  }
}

async function normalizeConsultationProducts(db, input) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new HttpError(400, "VALIDATION_ERROR", "products must be an array");
  const normalized = input.map((item) => {
    validateBody({ productId: { required: true }, variantId: { required: true } }, item);
    return { productId: toReference(item.productId, "productId"), variantId: toReference(item.variantId, "variantId"), note: typeof item.note === "string" ? item.note.trim() : "" };
  });
  const variants = await db.collection("product_variants").find({ _id: { $in: normalized.map((item) => item.variantId) }, isActive: true }).toArray();
  const products = await db.collection("products").find({ _id: { $in: normalized.map((item) => item.productId) }, isActive: true }).toArray();
  const variantsById = new Map(variants.map((item) => [String(item._id), item]));
  const productsById = new Map(products.map((item) => [String(item._id), item]));
  if (variants.length !== normalized.length || products.length !== normalized.length || normalized.some((item) => String(variantsById.get(String(item.variantId))?.productId) !== String(item.productId))) throw new HttpError(404, "PRODUCT_VARIANT_NOT_FOUND", "One or more consultation products are invalid");
  return normalized.map((item) => ({ ...item, productName: productsById.get(String(item.productId)).name, sku: variantsById.get(String(item.variantId)).sku, createdAt: new Date() }));
}

export function appointmentsRouter({ db }) {
  const router = Router();
  const appointments = db.collection("appointments");
  router.use(authenticate);

  router.get("/availability", async (req, res) => {
    const { appointmentDate, startTime, endTime } = appointmentWindow(req.query);
    const conflict = await appointments.findOne({
      appointmentDate,
      status: { $in: ["requested", "confirmed"] },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime }
    }, { projection: { _id: 1 } });
    res.json({ data: { available: !conflict } });
  });

  router.get("/", async (req, res) => {
    const staff = ["sales", "manager"].includes(req.user.role);
    const filter = staff ? {} : { userId: req.user._id };
    const records = await appointments.find(filter).sort({ appointmentDate: 1, startTime: 1 }).toArray();
    let data = records.map(serializeAppointment);
    if (staff && records.length) {
      const userIds = [...new Map(records.filter((item) => item.userId).map((item) => [String(item.userId), item.userId])).values()];
      const customers = await db.collection("users").find({ _id: { $in: userIds } }, { projection: { fullName: 1, email: 1, phone: 1 } }).toArray();
      const byId = new Map(customers.map((customer) => [String(customer._id), { id: String(customer._id), fullName: customer.fullName, email: customer.email, phone: customer.phone || null }]));
      data = data.map((item) => ({ ...item, customer: byId.get(item.userId) || null }));
    }
    res.json({ data, pagination: { page: 1, limit: data.length, total: data.length, totalPages: data.length ? 1 : 0 } });
  });

  router.get("/:id", async (req, res) => {
    const filter = { _id: toReference(req.params.id, "id") };
    if (!["sales", "manager"].includes(req.user.role)) filter.userId = req.user._id;
    const appointment = await appointments.findOne(filter);
    if (!appointment) throw notFound("Appointment not found");
    res.json({ data: serializeAppointment(appointment) });
  });

  router.post("/", async (req, res) => {
    validateBody({ consultationType: { required: true, type: "string" } }, req.body);
    const { appointmentDate, startTime, endTime } = appointmentWindow(req.body);
    const products = await normalizeConsultationProducts(db, req.body.products);
    const dateKey = appointmentDate.toISOString().slice(0, 10);
    const appointment = await withDateLock(db, dateKey, async () => {
      const conflict = await appointments.findOne({ appointmentDate, status: { $in: ["requested", "confirmed"] }, startTime: { $lt: endTime }, endTime: { $gt: startTime } }, { projection: { _id: 1 } });
      if (conflict) throw new HttpError(409, "APPOINTMENT_SLOT_UNAVAILABLE", "The selected appointment time is no longer available");
      const now = new Date();
      const record = { _id: new ObjectId(), userId: req.user._id, employeeId: req.body.employeeId ? toReference(req.body.employeeId, "employeeId") : null, consultationType: req.body.consultationType, appointmentDate, startTime, endTime, status: "requested", customerNote: req.body.customerNote || "", employeeNote: "", consultationResult: "", products, createdAt: now, updatedAt: now };
      await appointments.insertOne(record);
      return record;
    });
    res.status(201).json({ data: serializeAppointment(appointment) });
  });

  router.patch("/:id", requireRoles("sales", "manager", "customer"), async (req, res) => {
    const id = toReference(req.params.id, "id");
    const appointment = await appointments.findOne({ _id: id });
    if (!appointment) throw notFound("Appointment not found");
    if (req.user.role === "customer" && String(appointment.userId) !== String(req.user._id)) throw notFound("Appointment not found");
    if (!req.body.status) throw new HttpError(400, "VALIDATION_ERROR", "status is required");
    if (req.user.role === "customer" && req.body.status !== "cancelled") throw new HttpError(403, "FORBIDDEN", "Customers can only cancel appointments");
    if (req.user.role === "customer" && (req.body.employeeNote !== undefined || req.body.consultationResult !== undefined)) throw new HttpError(403, "FORBIDDEN", "Customers cannot change staff consultation fields");
    const editingCompletedConsultation = ["sales", "manager"].includes(req.user.role)
      && appointment.status === "completed"
      && req.body.status === appointment.status
      && (req.body.employeeNote !== undefined || req.body.consultationResult !== undefined);
    if (!editingCompletedConsultation) assertTransition(appointmentTransitions, appointment.status, req.body.status);
    const update = { status: req.body.status, updatedAt: new Date() };
    if (req.body.employeeNote !== undefined) update.employeeNote = req.body.employeeNote;
    if (req.body.consultationResult !== undefined) update.consultationResult = req.body.consultationResult;
    const saved = await appointments.findOneAndUpdate({ _id: id, status: appointment.status }, { $set: update }, { returnDocument: "after" });
    if (!saved) throw new HttpError(409, "CONCURRENT_UPDATE", "Appointment was changed by another request");
    res.json({ data: serializeAppointment(saved) });
  });

  router.post("/:id/reviews", requireRoles("customer"), async (req, res) => {
    const id = toReference(req.params.id, "id");
    const appointment = await appointments.findOne({ _id: id, userId: req.user._id });
    if (!appointment) throw notFound("Appointment not found");
    if (appointment.status !== "completed") throw new HttpError(409, "CONSULTATION_NOT_COMPLETED", "Consultation must be completed before review");
    validateBody({ rating: { required: true }, comment: { required: true, type: "string", maxLength: 2000 } }, req.body);
    if (!Number.isInteger(req.body.rating) || req.body.rating < 1 || req.body.rating > 5 || !req.body.comment.trim()) throw new HttpError(400, "VALIDATION_ERROR", "rating and comment are invalid");
    const reviews = db.collection("consultation_reviews");
    if (await reviews.findOne({ consultationId: id, userId: req.user._id })) throw new HttpError(409, "CONSULTATION_REVIEW_EXISTS", "Consultation already reviewed");
    const review = { _id: new ObjectId(), consultationId: id, userId: req.user._id, rating: req.body.rating, comment: req.body.comment.trim(), createdAt: new Date() };
    await reviews.insertOne(review);
    res.status(201).json({ data: { ...review, id: String(review._id), _id: undefined, consultationId: String(review.consultationId), userId: String(review.userId) } });
  });

  router.delete("/:id", requireRoles("sales", "manager", "customer"), async (req, res) => {
    const id = toReference(req.params.id, "id");
    const filter = { _id: id };
    if (req.user.role === "customer") filter.userId = req.user._id;
    const appointment = await appointments.findOne(filter);
    if (!appointment) throw notFound("Appointment not found");
    assertTransition(appointmentTransitions, appointment.status, "cancelled");
    const saved = await appointments.findOneAndUpdate({ _id: id, status: appointment.status }, { $set: { status: "cancelled", updatedAt: new Date() } }, { returnDocument: "after" });
    if (!saved) throw new HttpError(409, "CONCURRENT_UPDATE", "Appointment was changed by another request");
    res.json({ data: serializeAppointment(saved) });
  });
  return router;
}
