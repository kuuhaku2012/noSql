import jwt from "jsonwebtoken";
import { HttpError, forbidden } from "../lib/errors.js";
import { toReference } from "../lib/validation.js";

export function publicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    fullName: user.fullName,
    phone: user.phone || null,
    skinType: user.skinType || null,
    role: user.role,
    isActive: user.isActive
  };
}

export function signSession(user, secret) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, secret, { expiresIn: "7d" });
}

export async function authenticate(req, _res, next) {
  try {
    const token = req.cookies?.mb_token;
    if (!token) throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required");
    const payload = jwt.verify(token, req.app.locals.config.jwtSecret);
    const userId = toReference(payload.sub, "userId");
    const user = await req.app.locals.db.collection("users").findOne({ _id: userId, isActive: true });
    if (!user) throw new HttpError(401, "AUTH_INVALID", "Session is invalid or expired");
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof HttpError) return next(error);
    next(new HttpError(401, "AUTH_INVALID", "Session is invalid or expired"));
  }
}

export function requireRoles(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}
