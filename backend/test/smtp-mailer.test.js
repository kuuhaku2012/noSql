import test from "node:test";
import assert from "node:assert/strict";
import { createSmtpMailer } from "../src/services/smtp-mailer.js";

test("mailer sends a registration code through the injected transport", async () => {
  const messages = [];
  const mailer = createSmtpMailer({ smtpHost: "mail.test", smtpPort: 587, smtpFrom: "shop@test", smtpUser: "test-user", smtpPass: "test-password" }, {
    createTransport: (options) => ({ sendMail: async (message) => messages.push({ options, message }) })
  });
  await mailer.sendAuthCode({ to: "mai@test.local", purpose: "register", code: "123456" });
  assert.equal(mailer.configured, true);
  assert.equal(messages[0].options.host, "mail.test");
  assert.equal(messages[0].options.port, 587);
  assert.deepEqual(messages[0].options.auth, { user: "test-user", pass: "test-password" });
  assert.equal(messages[0].message.from, "shop@test");
  assert.equal(messages[0].message.to, "mai@test.local");
  assert.match(messages[0].message.text, /123456/);
});

test("unconfigured SMTP refuses to claim a code was sent", async () => {
  const mailer = createSmtpMailer({}, { createTransport: () => { throw new Error("must not create transport"); } });
  assert.equal(mailer.configured, false);
  await assert.rejects(mailer.sendAuthCode({ to: "mai@test.local", purpose: "register", code: "123456" }),
    (error) => error.status === 503 && error.code === "EMAIL_NOT_CONFIGURED");
});

test("SMTP transport errors become sanitized retryable errors", async () => {
  const mailer = createSmtpMailer({ smtpHost: "mail.test", smtpPort: 587, smtpFrom: "shop@test", smtpUser: "u", smtpPass: "p" }, {
    createTransport: () => ({ sendMail: async () => { throw new Error("provider details must not escape"); } })
  });
  await assert.rejects(mailer.sendAuthCode({ to: "mai@test.local", purpose: "register", code: "123456" }),
    (error) => error.status === 503 && error.code === "EMAIL_DELIVERY_FAILED" && !error.message.includes("provider details"));
});

test("mailer escapes the code in HTML and rejects unsupported purposes", async () => {
  const messages = [];
  const mailer = createSmtpMailer({ smtpHost: "mail.test", smtpPort: 587, smtpFrom: "shop@test", smtpUser: "u", smtpPass: "p" }, {
    createTransport: () => ({ sendMail: async (message) => messages.push(message) })
  });
  await mailer.sendAuthCode({ to: "mai@test.local", purpose: "password_reset", code: "<script>&\"'" });
  assert.match(messages[0].html, /&lt;script&gt;&amp;&quot;&#39;/);
  assert.doesNotMatch(messages[0].html, /<script>/);
  await assert.rejects(mailer.sendAuthCode({ to: "mai@test.local", purpose: "login", code: "123456" }));
  assert.equal(messages.length, 1);
});
