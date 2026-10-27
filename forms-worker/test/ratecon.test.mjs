import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { parseNew, internalRoute, publicRoute, isToken, TERMS_VERSION } from "../src/ratecon.js";

const logo = readFileSync(new URL("../src/logo-white.png", import.meta.url));
const SITE = "https://www.swiftlinkusa.com";

// node:sqlite behind the small slice of the D1 API the worker uses.
function d1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: db.prepare(sql).run(...args) }),
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec("BEGIN"); try { const out = []; for (const s of list) out.push(await s.run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
}

function setup() {
  const sent = [];
  let clock = Date.parse("2026-10-27T15:00:00Z");
  const env = { RATECONS: d1(), RATECON_KEY: "k".repeat(64), TO_ADDRESS: "info@swiftlinkusa.com" };
  const deps = { logo, now: () => clock, sendMail: async (_env, msg) => sent.push(msg), verifyHuman: async () => null };
  return { env, deps, sent, advance: (ms) => (clock += ms) };
}
const staff = (method, path, body, key = "k".repeat(64)) => new Request("https://forms.swiftlinkusa.com/internal/ratecons" + path, {
  method, headers: { Authorization: "Bearer " + key, "X-Employee-Email": "previn@swiftlinkusa.com", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const sample = { load_no: "sll1005", po: "PO-778", customer: "Acme Foods, Inc.", contact_name: "Dana Lee", email: "Dana@AcmeFoods.com", pickup_zip: "48334", pickup_city: "Farmington Hills", pickup_state: "MI", pickup_date: "2026-10-28", delivery_zip: "30303", delivery_city: "Atlanta", delivery_state: "GA", delivery_date: "2026-10-30", rate: "2,100", equipment: "Dry Van", notes: "Liftgate at delivery" };
const confirm = (token, fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return new Request(`https://forms.swiftlinkusa.com/rate-confirmations/${token}/confirm`, { method: "POST", body: f, headers: { Origin: SITE, "CF-Connecting-IP": "203.0.113.9", "User-Agent": "Test" } }); };
const view = (token) => new Request(`https://forms.swiftlinkusa.com/rate-confirmations/${token}`, { headers: { Origin: SITE } });

test("validates new confirmations", () => {
  const { data } = parseNew(sample);
  assert.equal(data.load_no, "SLL1005");
  assert.equal(data.rate_cents, 210000);
  assert.equal(data.email, "dana@acmefoods.com");
  for (const bad of [{ load_no: "SLL 1005!" }, { email: "nope" }, { pickup_zip: "4833" }, { rate: "0" }, { rate: "abc" }, { delivery_date: "2026-10-01" }, { equipment: "Spaceship" }, { customer: " " }])
    assert.ok(parseNew({ ...sample, ...bad }).errors, JSON.stringify(bad));
});

test("internal API needs the key and a SwiftLink employee", async () => {
  const { env, deps } = setup();
  assert.equal((await internalRoute(staff("GET", "", null, "wrong"), env, deps)).status, 403);
  const noEmployee = new Request("https://forms.swiftlinkusa.com/internal/ratecons", { headers: { Authorization: "Bearer " + env.RATECON_KEY, "X-Employee-Email": "x@evil.com" } });
  assert.equal((await internalRoute(noEmployee, env, deps)).status, 403);
  assert.equal((await internalRoute(staff("GET", "", null), { ...env, RATECON_KEY: "" }, deps)).status, 403);
});

test("create, view, confirm once, email the signed PDF", async () => {
  const { env, deps, sent } = setup();
  const created = await (await internalRoute(staff("POST", "", sample), env, deps)).json();
  const item = created.item;
  assert.match(item.link, /^https:\/\/www\.swiftlinkusa\.com\/rate-confirmation\/#[A-Za-z0-9_-]{32}$/);
  const token = item.link.split("#")[1];
  assert.ok(isToken(token));
  assert.equal(item.token, undefined);

  const page = await publicRoute(view(token), env, deps, SITE);
  assert.equal(page.headers.get("Access-Control-Allow-Origin"), SITE);
  const pub = await page.json();
  assert.equal(pub.rate, "$2,100.00");
  assert.equal(pub.pickup.place, "Farmington Hills, MI 48334");
  for (const hidden of ["id", "token", "created_by", "email", "confirmed_ip"]) assert.equal(pub[hidden], undefined, hidden);
  assert.ok(env.RATECONS.raw.prepare("SELECT viewed_at FROM ratecons").get().viewed_at);

  assert.equal((await publicRoute(confirm(token, { name: "Dana Lee" }), env, deps, SITE)).status, 422);
  assert.equal((await publicRoute(confirm(token, { agree: "on" }), env, deps, SITE)).status, 422);
  assert.equal((await publicRoute(confirm(token, { name: "Dana Lee", email: "", agree: "on" }), env, deps, SITE)).status, 422);
  const ok = await publicRoute(confirm(token, { name: "Dana Lee", email: "Dana.Lee@AcmeFoods.com", agree: "on" }), env, deps, SITE);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, "confirmed");
  assert.equal((await publicRoute(confirm(token, { name: "Someone Else", email: "x@acmefoods.com", agree: "on" }), env, deps, SITE)).status, 409);

  const row = env.RATECONS.raw.prepare("SELECT * FROM ratecons").get();
  assert.equal(row.confirmed_name, "Dana Lee");
  assert.equal(row.confirmed_ip, "203.0.113.9");
  assert.equal(row.confirmed_email, "dana.lee@acmefoods.com");
  assert.equal(row.terms_version, TERMS_VERSION);

  assert.equal(sent.length, 2);
  const [internal, customer] = sent;
  assert.equal(internal.message.attachments[0].name, "SLL1005 - Customer Rate Agreement.pdf");
  assert.deepEqual(internal.message.toRecipients.map((r) => r.emailAddress.address), ["info@swiftlinkusa.com", "previn@swiftlinkusa.com"]);
  assert.ok(internal.message.body.content.includes("Accepted by: Dana Lee (dana.lee@acmefoods.com)   Link sent to: dana@acmefoods.com"));
  assert.deepEqual(customer.message.toRecipients.map((r) => r.emailAddress.address), ["dana.lee@acmefoods.com"]);
  assert.deepEqual(customer.message.ccRecipients.map((r) => r.emailAddress.address), ["dana@acmefoods.com"]);

  const pdf = Buffer.from(internal.message.attachments[0].contentBytes, "base64");
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getTitle(), "SLL1005 - Customer Rate Agreement");
  mkdirSync(new URL("./output/", import.meta.url), { recursive: true });
  writeFileSync(new URL("./output/ratecon.pdf", import.meta.url), pdf);

  const download = await publicRoute(new Request(`https://forms.swiftlinkusa.com/rate-confirmations/${token}/pdf`, { headers: { Origin: SITE } }), env, deps, SITE);
  assert.equal(download.headers.get("Content-Type"), "application/pdf");
  const list = await (await internalRoute(staff("GET", "", null), env, deps)).json();
  assert.equal(list.items[0].status, "confirmed");
  assert.equal((await internalRoute(staff("GET", `/${list.items[0].id}/pdf`, null), env, deps)).headers.get("Content-Type"), "application/pdf");
});

test("expired, cancelled and replaced links cannot be confirmed; email failure is recorded", async () => {
  const { env, deps, advance } = setup();
  const first = (await (await internalRoute(staff("POST", "", sample), env, deps)).json()).item;
  const second = (await (await internalRoute(staff("POST", "", sample), env, deps)).json()).item;
  const t1 = first.link.split("#")[1], t2 = second.link.split("#")[1];
  assert.equal((await (await publicRoute(view(t1), env, deps, SITE)).json()).status, "void");
  assert.equal((await publicRoute(confirm(t1, { name: "Dana Lee", email: "dana@acmefoods.com", agree: "on" }), env, deps, SITE)).status, 409);

  assert.equal((await internalRoute(staff("POST", `/${second.id}/void`, {}), env, deps)).status, 200);
  assert.equal((await publicRoute(confirm(t2, { name: "Dana Lee", email: "dana@acmefoods.com", agree: "on" }), env, deps, SITE)).status, 409);

  const third = (await (await internalRoute(staff("POST", "", { ...sample, load_no: "SLL1006" }), env, deps)).json()).item;
  advance(31 * 86_400_000);
  const t3 = third.link.split("#")[1];
  assert.equal((await (await publicRoute(view(t3), env, deps, SITE)).json()).status, "expired");
  assert.equal((await publicRoute(confirm(t3, { name: "Dana Lee", email: "dana@acmefoods.com", agree: "on" }), env, deps, SITE)).status, 409);

  const older = (await (await internalRoute(staff("POST", "", { ...sample, load_no: "SLL1008" }), env, deps)).json()).item;
  assert.equal((await publicRoute(confirm(older.link.split("#")[1], { name: "Dana Lee", title: "Old page", agree: "on" }), env, deps, SITE)).status, 200);
  const fourth = (await (await internalRoute(staff("POST", "", { ...sample, load_no: "SLL1007" }), env, deps)).json()).item;
  const failing = { ...deps, sendMail: async () => { throw new Error("Graph down"); } };
  assert.equal((await publicRoute(confirm(fourth.link.split("#")[1], { name: "Dana Lee", email: "dana@acmefoods.com", agree: "on" }), env, failing, SITE)).status, 200);
  assert.match(env.RATECONS.raw.prepare("SELECT email_error FROM ratecons WHERE load_no='SLL1007'").get().email_error, /Graph down/);

  assert.equal((await publicRoute(view("not-a-token"), env, deps, SITE)).status, 404);
  assert.equal((await publicRoute(view("A".repeat(32)), env, deps, SITE)).status, 404);
});

test("saves customers and prefills the last signer for their next link", async () => {
  const { env, deps } = setup();
  const first = (await (await internalRoute(staff("POST", "", sample), env, deps)).json()).item;
  let customers = (await (await internalRoute(staff("GET", "/customers", null), env, deps)).json()).customers;
  assert.equal(customers.length, 1);
  assert.equal(customers[0].email, "dana@acmefoods.com");
  assert.equal(customers[0].contact_name, "Dana Lee");
  const t1 = first.link.split("#")[1];
  assert.equal((await (await publicRoute(view(t1), env, deps, SITE)).json()).returning, null);
  assert.equal((await publicRoute(confirm(t1, { name: "Dana Lee", email: "dana.lee@acmefoods.com", agree: "on" }), env, deps, SITE)).status, 200);

  const second = (await (await internalRoute(staff("POST", "", { ...sample, load_no: "SLL2000", customer: "ACME FOODS, INC." }), env, deps)).json()).item;
  const t2 = second.link.split("#")[1];
  assert.deepEqual((await (await publicRoute(view(t2), env, deps, SITE)).json()).returning, { name: "Dana Lee", email: "dana.lee@acmefoods.com" });
  customers = (await (await internalRoute(staff("GET", "/customers", null), env, deps)).json()).customers;
  assert.equal(customers.length, 1);
  assert.equal(customers[0].loads, 2);
  assert.equal((await publicRoute(confirm(t2, { name: "Dana Lee", email: "dana.lee@acmefoods.com", agree: "on", method: "returning" }), env, deps, SITE)).status, 200);
  assert.equal(env.RATECONS.raw.prepare("SELECT confirm_method FROM ratecons WHERE load_no=?").get("SLL2000").confirm_method, "returning");
  assert.equal(env.RATECONS.raw.prepare("SELECT confirm_method FROM ratecons WHERE load_no=?").get("SLL1005").confirm_method, "typed");

  const other = (await (await internalRoute(staff("POST", "", { ...sample, load_no: "SLL3000", customer: "Other Co", email: "ops@other.co" }), env, deps)).json()).item;
  assert.equal((await (await publicRoute(view(other.link.split("#")[1]), env, deps, SITE)).json()).returning, null);

  assert.equal((await internalRoute(staff("POST", "/customers/remove", { name: "acme foods, inc." }), env, deps)).status, 200);
  customers = (await (await internalRoute(staff("GET", "/customers", null), env, deps)).json()).customers;
  assert.deepEqual(customers.map((c) => c.name), ["Other Co"]);
  await internalRoute(staff("POST", "", { ...sample, load_no: "SLL4000" }), env, deps);
  customers = (await (await internalRoute(staff("GET", "/customers", null), env, deps)).json()).customers;
  assert.equal(customers.length, 2);
});

test("capitalizes typed names and keeps the customer copy short", async () => {
  const { env, deps, sent } = setup();
  const item = (await (await internalRoute(staff("POST", "", { ...sample, contact_name: "dana LEE" }), env, deps)).json()).item;
  assert.equal(item.contact_name, "Dana Lee");
  assert.equal((await publicRoute(confirm(item.link.split("#")[1], { name: "mary o'neil", email: "mary@acmefoods.com", agree: "on" }), env, deps, SITE)).status, 200);
  assert.equal(env.RATECONS.raw.prepare("SELECT confirmed_name FROM ratecons").get().confirmed_name, "Mary O'Neil");
  assert.match(sent[1].message.body.content, /^Hello Mary O'Neil,/);
  assert.ok(!sent[1].message.body.content.includes("looks wrong"));
});

test("deletes old confirmations and edits saved customers", async () => {
  const { env, deps } = setup();
  const item = (await (await internalRoute(staff("POST", "", sample), env, deps)).json()).item;
  const token = item.link.split("#")[1];
  assert.equal((await internalRoute(staff("POST", `/${item.id}/delete`, {}), env, deps)).status, 200);
  assert.equal((await (await internalRoute(staff("GET", "", null), env, deps)).json()).items.length, 0);
  assert.equal((await publicRoute(view(token), env, deps, SITE)).status, 404);
  assert.equal(env.RATECONS.raw.prepare("SELECT status FROM ratecons").get().status, "deleted");
  assert.equal((await internalRoute(staff("POST", "/customers/update", { name: "acme foods, inc.", contact_name: "pat smith", email: "Pat@AcmeFoods.com" }), env, deps)).status, 200);
  const c = (await (await internalRoute(staff("GET", "/customers", null), env, deps)).json()).customers[0];
  assert.deepEqual([c.contact_name, c.email], ["Pat Smith", "pat@acmefoods.com"]);
  assert.equal((await internalRoute(staff("POST", "/customers/update", { name: "Acme Foods, Inc.", email: "nope" }), env, deps)).status, 422);
});

test("removing a customer forgets their signer; deleted links never come back as customers", async () => {
  const { env, deps } = setup();
  const a = (await (await internalRoute(staff("POST", "", sample), env, deps)).json()).item;
  await publicRoute(confirm(a.link.split("#")[1], { name: "Previn", email: "previn@swiftlinkusa.com", agree: "on" }), env, deps, SITE);
  await internalRoute(staff("POST", "/customers/remove", { name: "Acme Foods, Inc." }), env, deps);
  const b = (await (await internalRoute(staff("POST", "", { ...sample, load_no: "SLL9" }), env, deps)).json()).item;
  assert.equal((await (await publicRoute(view(b.link.split("#")[1]), env, deps, SITE)).json()).returning, null);
  const { env: env2, deps: deps2 } = setup();
  const c = (await (await internalRoute(staff("POST", "", { ...sample, customer: "Test Co" }), env2, deps2)).json()).item;
  await internalRoute(staff("POST", `/${c.id}/delete`, {}), env2, deps2);
  env2.RATECONS.raw.exec("DELETE FROM ratecon_customers");
  const { ensureSchema } = await import("../src/ratecon.js");
  const fresh = { ...env2.RATECONS };
  await ensureSchema(fresh);
  assert.equal(env2.RATECONS.raw.prepare("SELECT COUNT(*) AS n FROM ratecon_customers").get().n, 0);
});
