import { Router } from "express";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { HttpError } from "../lib/errors.js";
import { validateBody } from "../lib/validation.js";
import { authenticate, publicUser, signSession } from "../middleware/auth.js";

const skinTypes = new Set(["oily", "dry", "sensitive", "combination", "normal"]);

export function authRouter({ db, config }) {
  const router = Router();
  const users = db.collection("users");

  router.post("/register", async (req, res) => {
    validateBody({
      email: { required: true, type: "string", maxLength: 254 },
      fullName: { required: true, type: "string", maxLength: 160 },
      phone: { type: "string", maxLength: 30 },
      password: { required: true, type: "string", maxLength: 200 },
      skinType: { type: "string", maxLength: 60 }
    }, req.body);

    const email = req.body.email.trim().toLowerCase();
    const fullName = req.body.fullName.trim();
    const phone = req.body.phone?.trim() || "";
    const skinType = req.body.skinType?.trim() || "";
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "VALIDATION_ERROR", "email is invalid");
    if (!fullName) throw new HttpError(400, "VALIDATION_ERROR", "fullName cannot be empty");
    if (req.body.password.length < 6) throw new HttpError(400, "VALIDATION_ERROR", "password must be at least 6 characters");
    if (skinType && !skinTypes.has(skinType)) throw new HttpError(400, "VALIDATION_ERROR", "skinType is invalid");
    if (await users.findOne({ $or: [{ email }, ...(phone ? [{ phone }] : [])] })) {
      throw new HttpError(409, "DUPLICATE_USER", "Email or phone already exists");
    }

    const now = new Date();
    const user = {
      _id: new ObjectId(), email, fullName, role: "customer", roleId: null,
      ...(phone ? { phone } : {}), ...(skinType ? { skinType } : {}),
      passwordHash: await bcrypt.hash(req.body.password, 10), isActive: true,
      isDemo: false, createdAt: now, updatedAt: now
    };
    try {
      await users.insertOne(user);
    } catch (error) {
      if (error.code === 11000) throw new HttpError(409, "DUPLICATE_USER", "Email or phone already exists");
      throw error;
    }

    res.cookie("mb_token", signSession(user, config.jwtSecret), {
      httpOnly: true,
      sameSite: "lax",
      secure: config.secureCookies === true,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.status(201).json({ data: publicUser(user) });
  });

  router.post("/login", async (req, res) => {
    validateBody({ email: { required: true, type: "string" }, password: { required: true, type: "string" } }, req.body);
    const user = await users.findOne({ email: req.body.email.trim().toLowerCase(), isActive: true });
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      throw new HttpError(401, "AUTH_INVALID", "Email or password is incorrect");
    }
    res.cookie("mb_token", signSession(user, config.jwtSecret), {
      httpOnly: true,
      sameSite: "lax",
      secure: config.secureCookies === true,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ data: publicUser(user) });
  });

  router.get("/me", authenticate, (req, res) => res.json({ data: publicUser(req.user) }));
  router.post("/logout", (_req, res) => {
    res.clearCookie("mb_token", { httpOnly: true, sameSite: "lax" });
    res.status(204).end();
  });
  return router;
}
