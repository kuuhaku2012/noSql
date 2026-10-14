import { createRequire } from "node:module";
import { HttpError } from "../lib/errors.js";

const require = createRequire(import.meta.url);

const purposeCopy = Object.freeze({
  register: {
    subject: "Verify your Maison Belle email",
    text: (code) => `Your Maison Belle registration verification code is ${code}.`,
    html: (code) => `<p>Your Maison Belle registration verification code is <strong>${escapeHtml(code)}</strong>.</p>`
  },
  password_reset: {
    subject: "Reset your Maison Belle password",
    text: (code) => `Your Maison Belle password reset code is ${code}.`,
    html: (code) => `<p>Your Maison Belle password reset code is <strong>${escapeHtml(code)}</strong>.</p>`
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function copyFor(purpose) {
  if (!Object.hasOwn(purposeCopy, purpose)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Email purpose is invalid");
  }
  return purposeCopy[purpose];
}

function createDefaultTransport(options) {
  return require("nodemailer").createTransport(options);
}

export function createSmtpMailer(config, { createTransport = createDefaultTransport } = {}) {
  const configured = Boolean(
    config
      && typeof config.smtpHost === "string" && config.smtpHost.trim()
      && Number.isInteger(config.smtpPort) && config.smtpPort >= 1 && config.smtpPort <= 65535
      && typeof config.smtpFrom === "string" && config.smtpFrom.trim()
      && typeof config.smtpUser === "string" && config.smtpUser.trim()
      && typeof config.smtpPass === "string" && config.smtpPass.trim()
  );
  const transport = configured ? createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure === true,
    auth: { user: config.smtpUser, pass: config.smtpPass }
  }) : null;

  return {
    configured,
    async sendAuthCode({ to, purpose, code }) {
      if (!transport) {
        throw new HttpError(503, "EMAIL_NOT_CONFIGURED", "Email delivery is not configured");
      }

      const copy = copyFor(purpose);
      try {
        await transport.sendMail({
          from: config.smtpFrom,
          to,
          subject: copy.subject,
          text: copy.text(code),
          html: copy.html(code)
        });
      } catch {
        throw new HttpError(503, "EMAIL_DELIVERY_FAILED", "Email could not be sent. Please try again later.");
      }
    }
  };
}
