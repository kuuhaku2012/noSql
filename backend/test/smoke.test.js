import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";

const stubDb = { collection: () => ({}) };
const app = createApp({ db: stubDb, config: { jwtSecret: "test-secret", frontendRoot: new URL("../../frontend/", import.meta.url) } });

test("health and static frontend are served", async () => {
  const health = await request(app).get("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.data.status, "ok");

  const page = await request(app).get("/index.html");
  assert.equal(page.status, 200);
  assert.match(page.text, /<html/i);
});

test("unknown API returns a JSON error with request id", async () => {
  const response = await request(app).get("/api/does-not-exist");
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "NOT_FOUND");
  assert.ok(response.body.requestId);
});

test("invalid login returns the common validation error shape", async () => {
  const response = await request(app).post("/api/auth/login").send({});
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
  assert.ok(response.body.requestId);
});
