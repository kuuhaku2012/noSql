import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { collections } from "../collections.js";
import { HttpError } from "../lib/errors.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const invalidCodeError = () => new HttpError(400, "EMAIL_CODE_INVALID", "Email code is invalid, expired, used, or has too many attempts");
const notConfiguredError = () => new HttpError(503, "EMAIL_NOT_CONFIGURED", "Email delivery is not configured");
const supersededCodeError = () => new HttpError(409, "EMAIL_CODE_SUPERSEDED", "A newer email code request has superseded this one");

export function createAuthEmailCodeService({ db, mailer, secret, now = () => new Date() }) {
  const codes = collections(db).authEmailVerifications;

  function assertSecretConfigured() {
    if (typeof secret !== "string" || secret.length < 32) throw notConfiguredError();
  }

  function assertSendConfigured() {
    assertSecretConfigured();
    if (!mailer?.configured || typeof mailer.sendAuthCode !== "function") throw notConfiguredError();
  }

  function identity(email, purpose) {
    if (purpose !== "register" && purpose !== "password_reset") {
      throw new HttpError(400, "VALIDATION_ERROR", "Email purpose is invalid");
    }
    if (typeof email !== "string" || !email.trim()) {
      throw new HttpError(400, "VALIDATION_ERROR", "Email is invalid");
    }
    return { email: email.trim().toLowerCase(), purpose };
  }

  function digest({ email, purpose }, code) {
    return createHmac("sha256", secret).update(`${purpose}:${email}:${code}`).digest("hex");
  }

  async function reserveSend(email, purpose, time) {
    // A purpose-less record shares limits across both auth purposes. Its stable
    // _id makes initialization safe even before the additive indexes are run.
    const _id = `send-window:${email}`;
    const purgeAt = new Date(time.getTime() + 24 * HOUR);
    try {
      await codes.updateOne({ _id }, { $setOnInsert: { email, sends: 0, issuanceGenerations: {}, windowStartedAt: time, purgeAt } }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    const windowCutoff = new Date(time.getTime() - HOUR);
    const reset = { $lte: ["$windowStartedAt", windowCutoff] };
    const reserved = await codes.findOneAndUpdate({
      _id,
      $and: [
        { $or: [{ lastSentAt: { $exists: false } }, { lastSentAt: { $lte: new Date(time.getTime() - MINUTE) } }] },
        { $or: [{ windowStartedAt: { $lte: windowCutoff } }, { sends: { $lt: 5 } }] }
      ]
    }, [{ $set: {
      sends: { $cond: [reset, 1, { $add: ["$sends", 1] }] },
      windowStartedAt: { $cond: [reset, time, "$windowStartedAt"] },
      issuanceGenerations: { $mergeObjects: [
        { $ifNull: ["$issuanceGenerations", {}] },
        { [purpose]: { $add: [{ $ifNull: [`$issuanceGenerations.${purpose}`, 0] }, 1] } }
      ] },
      lastSentAt: time,
      purgeAt
    } }], { returnDocument: "after" });
    const reservation = reserved?.value ?? reserved;
    if (!reservation) {
      throw new HttpError(429, "EMAIL_CODE_RATE_LIMITED", "Email code send limit reached. Please try again later.");
    }
    return reservation.issuanceGenerations?.[purpose];
  }

  async function isCurrentReservation(email, purpose, issuanceGeneration) {
    const reservation = await codes.findOne({ _id: `send-window:${email}` }, { projection: { issuanceGenerations: 1 } });
    return reservation?.issuanceGenerations?.[purpose] === issuanceGeneration;
  }

  async function sendCode({ email, purpose }) {
    assertSendConfigured();
    const key = identity(email, purpose);
    const time = now();
    const issuanceGeneration = await reserveSend(key.email, key.purpose, time);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const codeHash = digest(key, code);
    const expiresAt = new Date(time.getTime() + 10 * MINUTE);
    const challengeId = `challenge:${key.purpose}:${key.email}`;
    await codes.updateOne({ _id: challengeId }, {
      $max: { issuanceGeneration },
      $setOnInsert: { ...key, purgeAt: new Date(time.getTime() + 24 * HOUR) }
    }, { upsert: true });
    if (!await isCurrentReservation(key.email, key.purpose, issuanceGeneration)) throw supersededCodeError();
    const replacement = await codes.updateOne({ _id: challengeId, issuanceGeneration }, {
      $set: { ...key, codeHash, attempts: 0, codeExpiresAt: expiresAt, purgeAt: new Date(time.getTime() + 24 * HOUR) },
      $unset: { usedAt: "" }
    });
    if (replacement.matchedCount !== 1) throw supersededCodeError();
    if (!await isCurrentReservation(key.email, key.purpose, issuanceGeneration)) {
      await codes.updateOne({ _id: challengeId, issuanceGeneration, codeHash, codeExpiresAt: expiresAt }, { $set: { codeExpiresAt: now() } });
      throw supersededCodeError();
    }
    try {
      // Task 1 currently reads `to`; `email` preserves the service contract.
      await mailer.sendAuthCode({ ...key, to: key.email, code, expiresAt });
    } catch {
      // Do not expire a newer challenge if a slow, older delivery fails.
      await codes.updateOne({ _id: challengeId, issuanceGeneration, codeHash, codeExpiresAt: expiresAt }, { $set: { codeExpiresAt: now() } });
      throw new HttpError(503, "EMAIL_DELIVERY_FAILED", "Email could not be sent. Please try again later.");
    }
    return { expiresAt };
  }

  async function consumeCode({ email, purpose, code }) {
    assertSecretConfigured();
    const key = identity(email, purpose);
    const time = now();
    const active = { ...key, usedAt: { $exists: false }, codeExpiresAt: { $gt: time }, attempts: { $lt: 5 } };
    const stored = await codes.findOne(active);
    if (!stored) throw invalidCodeError();
    const codeHash = digest(key, typeof code === "string" ? code : "");
    const expected = Buffer.from(codeHash, "hex");
    const storedHash = typeof stored.codeHash === "string" ? stored.codeHash : "";
    const actual = Buffer.from(storedHash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)
      || !/^[a-f0-9]{64}$/.test(storedHash) || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      await codes.updateOne({ ...active, codeHash: stored.codeHash }, { $inc: { attempts: 1 } });
      throw invalidCodeError();
    }
    const consumed = await codes.updateOne({ ...active, codeHash }, { $set: { usedAt: time }, $inc: { attempts: 1 } });
    if (consumed.modifiedCount !== 1) throw invalidCodeError();
    return true;
  }

  return { assertSendConfigured, assertSecretConfigured, sendCode, consumeCode };
}
