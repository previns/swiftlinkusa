import { test } from "node:test";
import assert from "node:assert/strict";
import { preflight, verifyHuman } from "../src/guard.js";

const SITE = "https://www.swiftlinkusa.com";
const req = (url, { method = "POST", origin = SITE, length = "100", ip = "203.0.113.5" } = {}) =>
  new Request(url, { method, headers: { Origin: origin, "Content-Length": length, "CF-Connecting-IP": ip } });

test("rejects plain HTTP, allows HTTPS and local development", async () => {
  assert.equal((await preflight(req("http://forms.swiftlinkusa.com/customer-application"), {})).response.status, 403);
  assert.equal((await preflight(req("https://forms.swiftlinkusa.com/customer-application"), {})).allowed, SITE);
  assert.equal((await preflight(req("http://localhost:8787/customer-application", { origin: "http://localhost:4321" }), {})).allowed, "http://localhost:4321");
});

test("keeps origin, method, path and size checks", async () => {
  const url = "https://forms.swiftlinkusa.com/customer-application";
  assert.equal((await preflight(req(url, { origin: "https://evil.example" }), {})).response.status, 403);
  assert.equal((await preflight(req(url, { method: "GET" }), {})).response.status, 405);
  assert.equal((await preflight(req("https://forms.swiftlinkusa.com/other"), {})).response.status, 404);
  assert.equal((await preflight(req(url, { length: String(65 * 1024) }), {})).response.status, 413);
});

test("rate limits per IP using the binding", async () => {
  const seen = [];
  const env = { SUBMIT_LIMIT: { limit: async ({ key }) => { seen.push(key); return { success: seen.length <= 3 }; } } };
  const url = "https://forms.swiftlinkusa.com/customer-application";
  for (let i = 0; i < 3; i++) assert.equal((await preflight(req(url), env)).response, undefined);
  assert.equal((await preflight(req(url), env)).response.status, 429);
  assert.deepEqual([...new Set(seen)], ["203.0.113.5"]);
});

test("Turnstile is skipped until configured, then required and verified", async () => {
  const request = req("https://forms.swiftlinkusa.com/customer-application");
  const form = new FormData();
  assert.equal(await verifyHuman(form, request, {}, SITE), null);
  const env = { TURNSTILE_SECRET: "secret" };
  assert.equal((await verifyHuman(form, request, env, SITE)).status, 403);
  form.set("cf-turnstile-response", "token");
  let sent;
  const ok = async (_url, init) => { sent = init.body; return Response.json({ success: true, hostname: "www.swiftlinkusa.com" }); };
  assert.equal(await verifyHuman(form, request, env, SITE, ok), null);
  assert.equal(sent.get("secret"), "secret");
  assert.equal(sent.get("remoteip"), "203.0.113.5");
  const otherHost = async () => Response.json({ success: true, hostname: "evil.example" });
  assert.equal((await verifyHuman(form, request, env, SITE, otherHost)).status, 403);
  const down = async () => { throw new Error("network"); };
  assert.equal((await verifyHuman(form, request, env, SITE, down)).status, 503);
});
