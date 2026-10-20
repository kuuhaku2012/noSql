import { Router } from "express";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { HttpError } from "../lib/errors.js";
import { validateBody } from "../lib/validation.js";
import { authenticate, publicUser, signSession } from "../middleware/auth.js";

const skinTypes = new Set(["oily", "dry", "sensitive", "combination", "normal"]);
const genericAccepted = { data: { accepted: true, resendAfterSeconds: 60 } };

function normalizedEmail(body) {
  validateBody({ email: { required: true, type: "string", maxLength: 254 } }, body);
  const email = body.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "VALIDATION_ERROR", "email is invalid");
  return email;
}

function validateVerificationCode(code) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    throw new HttpError(400, "VALIDATION_ERROR", "verificationCode must be six digits");
  }
}

function validatePasswordResetBody(body) {
  validateBody({
    email: { required: true, type: "string", maxLength: 254 },
    verificationCode: { required: true, type: "string", maxLength: 6 },
    newPassword: { required: true, type: "string", maxLength: 200 }
  }, body);
  const email = normalizedEmail(body);
  validateVerificationCode(body.verificationCode);
  if (body.newPassword.length < 6) throw new HttpError(400, "VALIDATION_ERROR", "newPassword must be at least 6 characters");
  return { email, verificationCode: body.verificationCode, newPassword: body.newPassword };
}

function duplicateUserError() {
  return new HttpError(409, "DUPLICATE_USER", "Email or phone already exists");
}

function setSessionCookie(res, user, config) {
  res.cookie("mb_token", signSession(user, config.jwtSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies === true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

export function authRouter({ db, config, authEmailCodes }) {
  const router = Router();
  const users = db.collection("users");
  const sendCodeIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (req, res) => res.status(429).json({
      error: { code: "RATE_LIMITED", message: "Too many email code requests. Please try again later." },
      requestId: req.requestId
    })
  });

  router.post("/register/send-code", sendCodeIpLimiter, async (req, res) => {
    const email = normalizedEmail(req.body);
    authEmailCodes.assertSendConfigured();
    if (await users.findOne({ email })) throw duplicateUserError();
    await authEmailCodes.sendCode({ email, purpose: "register" });
    res.status(202).json(genericAccepted);
  });

  router.post("/password-reset/send-code", sendCodeIpLimiter, async (req, res) => {
    const email = normalizedEmail(req.body);
    authEmailCodes.assertSendConfigured();
    const user = await users.findOne({ email, isActive: true });
    if (user) {
      try {
        await authEmailCodes.sendCode({ email, purpose: "password_reset" });
      } catch (error) {
        if (error.code !== "EMAIL_CODE_RATE_LIMITED" && error.code !== "EMAIL_DELIVERY_FAILED") throw error;
      }
    }
    res.status(202).json(genericAccepted);
  });

  router.post("/register", async (req, res) => {
    validateBody({
      email: { required: true, type: "string", maxLength: 254 },
      fullName: { required: true, type: "string", maxLength: 160 },
      phone: { type: "string", maxLength: 30 },
      password: { required: true, type: "string", maxLength: 200 },
      skinType: { type: "string", maxLength: 60 },
      verificationCode: { required: true, type: "string", maxLength: 6 }
    }, req.body);

    const email = normalizedEmail(req.body);
    validateVerificationCode(req.body.verificationCode);
    const fullName = req.body.fullName.trim();
    const phone = req.body.phone?.trim() || "";
    const skinType = req.body.skinType?.trim() || "";
    if (!fullName) throw new HttpError(400, "VALIDATION_ERROR", "fullName cannot be empty");
    if (req.body.password.length < 6) throw new HttpError(400, "VALIDATION_ERROR", "password must be at least 6 characters");
    if (skinType && !skinTypes.has(skinType)) throw new HttpError(400, "VALIDATION_ERROR", "skinType is invalid");
    if (await users.findOne({ $or: [{ email }, ...(phone ? [{ phone }] : [])] })) throw duplicateUserError();

    authEmailCodes.assertSecretConfigured();
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    await authEmailCodes.consumeCode({ email, purpose: "register", code: req.body.verificationCode });

    const now = new Date();
    const user = {
      _id: new ObjectId(), email, fullName, role: "customer", roleId: null,
      ...(phone ? { phone } : {}), ...(skinType ? { skinType } : {}),
      passwordHash, isActive: true, isDemo: false, emailVerifiedAt: now, createdAt: now, updatedAt: now
    };
    try {
      await users.insertOne(user);
    } catch (error) {
      if (error.code === 11000) throw duplicateUserError();
      throw error;
    }

    setSessionCookie(res, user, config);
    res.status(201).json({ data: publicUser(user) });
  });

  router.post("/password-reset", async (req, res) => {
    const { email, verificationCode, newPassword } = validatePasswordResetBody(req.body);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    authEmailCodes.assertSecretConfigured();
    await authEmailCodes.consumeCode({ email, purpose: "password_reset", code: verificationCode });
    const result = await users.updateOne(
      { email, isActive: true },
      { $set: { passwordHash, updatedAt: new Date() }, $inc: { authVersion: 1 } }
    );
    if (result.matchedCount !== 1) throw new HttpError(400, "CODE_INVALID", "The reset code is invalid or expired");
    res.status(204).end();
  });

  router.post("/login", async (req, res) => {
    validateBody({ email: { required: true, type: "string" }, password: { required: true, type: "string" } }, req.body);
    const user = await users.findOne({ email: req.body.email.trim().toLowerCase(), isActive: true });
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      throw new HttpError(401, "AUTH_CREDENTIALS_INVALID", "Email or password is incorrect");
    }
    setSessionCookie(res, user, config);
    res.json({ data: publicUser(user) });
  });

  router.get("/me", authenticate, (req, res) => res.json({ data: publicUser(req.user) }));
  router.post("/logout", (_req, res) => {
    res.clearCookie("mb_token", { httpOnly: true, sameSite: "lax" });
    res.status(204).end();
  });
  return router;
}
