import test from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../src/config.js";

test("getConfig parses SMTP settings and keeps the code secret independent", () => {
  const config = getConfig({ SMTP_HOST: "mail.test", SMTP_PORT: "587", SMTP_SECURE: "true", SMTP_USER: "user", SMTP_PASS: "pass", SMTP_FROM: "shop@test", AUTH_CODE_SECRET: "a".repeat(32), JWT_SECRET: "jwt-secret", TRUST_PROXY: "1" });
  assert.equal(config.smtpPort, 587);
  assert.equal(config.smtpSecure, true);
  assert.equal(config.authCodeSecret, "a".repeat(32));
  assert.notEqual(config.authCodeSecret, config.jwtSecret);
  assert.equal(config.trustProxy, 1);
  assert.equal(getConfig({}).trustProxy, false);
  assert.equal(getConfig({ SMTP_SECURE: "1" }).smtpSecure, false);
  assert.throws(() => getConfig({ SMTP_PORT: "not-a-port" }), /SMTP_PORT/);
  assert.throws(() => getConfig({ TRUST_PROXY: "true" }), /TRUST_PROXY/);
});

test("getConfig accepts explicit proxy IPs and rejects invalid addresses", () => {
  assert.equal(getConfig({ TRUST_PROXY: "192.0.2.10,2001:db8::1/64" }).trustProxy, "192.0.2.10,2001:db8::1/64");
  assert.throws(() => getConfig({ TRUST_PROXY: "not-an-ip" }), /TRUST_PROXY/);
});
