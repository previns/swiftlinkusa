// Customer rate confirmations: SwiftLink staff create a link from the employee portal (through the
// key-protected /internal API), the customer approves the load and rate on www.swiftlinkusa.com, and
// SwiftLink gets an email with the signed PDF ("SLL1005 - Customer Rate Agreement.pdf") for OTR.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { json } from "./guard.js";

// The terms the customer accepts. Bump TERMS_VERSION whenever the wording changes; every confirmation
// stores the version it was accepted under and its PDF prints that exact wording.
export const TERMS_VERSION = "2026-10-27";
export const TERMS = [
  "Customer agrees to pay SwiftLink Logistics, LLC (\"SwiftLink\"), or its designated factoring company, the rate shown above for the shipment described in this agreement.",
  "Accessorial charges not included above (such as detention, layover, lumper fees, truck ordered not used, extra stops or redelivery) are billed only when incurred and supported by documentation or approved by Customer.",
  "Invoices are due NET 30 from the invoice date unless other terms are approved in writing by SwiftLink. Accounts thirty (30) days or more past due accrue a finance charge of 1.5% per month (18% per annum), and Customer agrees to pay reasonable collection costs and attorney fees.",
  "SwiftLink acts as a property broker and arranges transportation with independent, licensed motor carriers. Carriers maintain cargo insurance of $100,000 per shipment; Customer must notify SwiftLink in writing before tender if the cargo value exceeds $100,000.",
  "This shipment is also subject to SwiftLink's Terms & Conditions at www.swiftlinkusa.com/terms and is governed by the laws of the State of Michigan.",
  "By typing their name and selecting Confirm, the person accepting represents that they are authorized to approve this rate for Customer and agrees that this electronic acceptance has the same effect as a handwritten signature.",
];

const LINK_BASE = "https://www.swiftlinkusa.com/rate-confirmation/#";
const DAY = 86_400_000;
export const EXPIRY_DAYS = 30;
export const EQUIPMENT = ["", "Dry Van", "Reefer", "Flatbed", "Step Deck", "Conestoga", "Straight Truck", "Sprinter / Cargo Van", "Power Only", "Other"];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ratecons (
    id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, load_no TEXT NOT NULL, po TEXT, customer TEXT NOT NULL,
    contact_name TEXT, email TEXT NOT NULL, pickup_zip TEXT NOT NULL, pickup_city TEXT, pickup_state TEXT, pickup_date TEXT NOT NULL,
    delivery_zip TEXT NOT NULL, delivery_city TEXT, delivery_state TEXT, delivery_date TEXT NOT NULL, rate_cents INTEGER NOT NULL,
    equipment TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'open', created_by TEXT NOT NULL, created TEXT NOT NULL,
    expires TEXT NOT NULL, viewed_at TEXT, confirmed_at TEXT, confirmed_name TEXT, confirmed_title TEXT, confirmed_ip TEXT,
    confirmed_ua TEXT, terms_version TEXT, email_error TEXT, voided_by TEXT, confirmed_email TEXT)`,
  "CREATE INDEX IF NOT EXISTS ratecons_created ON ratecons(created)",
  "CREATE INDEX IF NOT EXISTS ratecons_load ON ratecons(load_no)",
];
const ready = new WeakSet();
export async function ensureSchema(db) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  // Tables created before confirmed_email existed get the column added once; "duplicate column" means it is already there.
  try { await db.prepare("ALTER TABLE ratecons ADD COLUMN confirmed_email TEXT").run(); } catch {}
  ready.add(db);
}

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const isEmail = (v) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const newId = () => hex(crypto.getRandomValues(new Uint8Array(8)));
// 192 random bits: the link itself is the customer's only credential, so it must be unguessable.
export const newToken = () => base64url(crypto.getRandomValues(new Uint8Array(24)));
export const isToken = (t) => /^[A-Za-z0-9_-]{32}$/.test(t);

/** Validates a new confirmation from the portal. Returns { data } or { errors }. */
export function parseNew(input) {
  const errors = [];
  if (!input || typeof input !== "object") return { errors: ["Invalid request"] };
  const d = {
    load_no: clean(input.load_no, 20).toUpperCase(), po: clean(input.po, 40), customer: clean(input.customer, 120),
    contact_name: clean(input.contact_name, 80), email: clean(input.email, 200).toLowerCase(),
    pickup_zip: clean(input.pickup_zip, 5), pickup_city: clean(input.pickup_city, 60), pickup_state: clean(input.pickup_state, 2).toUpperCase(), pickup_date: clean(input.pickup_date, 10),
    delivery_zip: clean(input.delivery_zip, 5), delivery_city: clean(input.delivery_city, 60), delivery_state: clean(input.delivery_state, 2).toUpperCase(), delivery_date: clean(input.delivery_date, 10),
    equipment: clean(input.equipment, 40), notes: clean(input.notes, 500),
  };
  if (!/^[A-Z0-9-]{1,20}$/.test(d.load_no)) errors.push("Load number: letters, numbers and dashes only.");
  if (!d.customer) errors.push("Customer company is required.");
  if (!isEmail(d.email)) errors.push("Enter the customer's email address.");
  for (const leg of ["pickup", "delivery"]) {
    if (!/^\d{5}$/.test(d[leg + "_zip"])) errors.push(`Enter a 5-digit ${leg} ZIP.`);
    if (!isDate(d[leg + "_date"])) errors.push(`Enter the ${leg} date.`);
    if (d[leg + "_state"] && !/^[A-Z]{2}$/.test(d[leg + "_state"])) errors.push(`Invalid ${leg} state.`);
  }
  if (isDate(d.pickup_date) && isDate(d.delivery_date) && d.delivery_date < d.pickup_date) errors.push("Delivery date is before the pickup date.");
  if (!EQUIPMENT.includes(d.equipment)) errors.push("Choose equipment from the list.");
  const rate = Number(String(input.rate ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) errors.push("Enter the rate in dollars.");
  else d.rate_cents = Math.round(rate * 100);
  return errors.length ? { errors } : { data: d };
}

export const money = (cents) => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const place = (r, leg) => [[r[leg + "_city"], r[leg + "_state"]].filter(Boolean).join(", "), r[leg + "_zip"]].filter(Boolean).join(" ");
export const dateText = (ymd) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
export const stampText = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Detroit", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

export function statusOf(r, now = Date.now()) {
  if (r.status === "open" && Date.parse(r.expires) < now) return "expired";
  return r.status;
}

/** What the customer page may see: no internal IDs, creator, IP or other confirmations. */
export function publicView(r, now = Date.now()) {
  return {
    load_no: r.load_no, po: r.po || "", customer: r.customer, contact_name: r.contact_name || "",
    pickup: { place: place(r, "pickup"), date: r.pickup_date }, delivery: { place: place(r, "delivery"), date: r.delivery_date },
    rate: money(r.rate_cents), equipment: r.equipment || "", notes: r.notes || "", status: statusOf(r, now),
    confirmed: r.status === "confirmed" ? { name: r.confirmed_name, at: r.confirmed_at } : null,
    terms: r.status === "confirmed" ? termsFor(r.terms_version) : TERMS, terms_version: r.terms_version || TERMS_VERSION,
  };
}
// Only one version exists so far; older versions get added here when the wording changes.
const termsFor = () => TERMS;

const staffView = (r, now) => ({ ...r, status: statusOf(r, now), rate: money(r.rate_cents), link: LINK_BASE + r.token, token: undefined, confirmed_ua: undefined });

// ---------- PDF

const NAVY = rgb(0x1b / 255, 0x2a / 255, 0x4a / 255), GOLD = rgb(0xc9 / 255, 0xa2 / 255, 0x27 / 255), INK = rgb(0.13, 0.16, 0.22), MUTED = rgb(0.4, 0.44, 0.52), LINE = rgb(0.85, 0.87, 0.91);
const pdfSafe = (v) => String(v ?? "").normalize("NFKC").replace(/→/g, "->").replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, "");

function wrap(text, font, size, width) {
  const lines = [];
  for (const para of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Builds the branded Customer Rate Agreement PDF for a confirmed (or, for previews, open) record. */
export async function buildPdf(r, logoPng) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = logoPng ? await doc.embedPng(logoPng) : null;
  const W = 612, H = 792, M = 54;
  let page, y;
  const footer = () => {
    page.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.6, color: LINE });
    page.drawText("SwiftLink Logistics, LLC  |  MC 1813814  |  USDOT 4562842  |  31500 W 13 Mile Rd, Suite 219, Farmington Hills, MI 48334", { x: M, y: 33, size: 7.2, font, color: MUTED });
    page.drawText("(248) 987-6776  |  info@swiftlinkusa.com  |  www.swiftlinkusa.com", { x: M, y: 23, size: 7.2, font, color: MUTED });
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 84, width: W, height: 84, color: NAVY });
    page.drawRectangle({ x: 0, y: H - 88, width: W, height: 4, color: GOLD });
    if (logo) { const w = 156, h = w * logo.height / logo.width; page.drawImage(logo, { x: M, y: H - 42 - h / 2, width: w, height: h }); }
    const title = "CUSTOMER RATE AGREEMENT", ts = 13;
    page.drawText(title, { x: W - M - bold.widthOfTextAtSize(title, ts), y: H - 38, size: ts, font: bold, color: GOLD });
    const sub = pdfSafe(`Load ${r.load_no}`);
    page.drawText(sub, { x: W - M - font.widthOfTextAtSize(sub, 11), y: H - 56, size: 11, font, color: rgb(1, 1, 1) });
    footer();
    y = H - 116;
  };
  const ensure = (need) => { if (y - need < 70) newPage(); };
  const heading = (text) => { ensure(34); page.drawText(text.toUpperCase(), { x: M, y, size: 9, font: bold, color: GOLD }); y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE }); y -= 16; };
  const row = (label, value) => {
    const lines = wrap(value || "—", font, 10, W - M * 2 - 130);
    ensure(lines.length * 13 + 4);
    page.drawText(label, { x: M, y, size: 9, font: bold, color: MUTED });
    lines.forEach((l, i) => page.drawText(l, { x: M + 130, y: y - i * 13, size: 10, font, color: INK }));
    y -= lines.length * 13 + 5;
  };
  newPage();
  heading("Shipment");
  row("Load number", r.load_no);
  if (r.po) row("PO number", r.po);
  row("Customer", r.customer);
  if (r.contact_name) row("Customer contact", r.contact_name);
  row("Pickup", `${place(r, "pickup")}  -  ${dateText(r.pickup_date)}`);
  row("Delivery", `${place(r, "delivery")}  -  ${dateText(r.delivery_date)}`);
  if (r.equipment) row("Equipment", r.equipment);
  if (r.notes) row("Notes", r.notes);
  y -= 2; ensure(60);
  page.drawRectangle({ x: M, y: y - 38, width: W - M * 2, height: 50, color: rgb(0.97, 0.95, 0.88), borderColor: GOLD, borderWidth: 1 });
  page.drawText("AGREED RATE (USD)", { x: M + 16, y: y - 8, size: 9, font: bold, color: MUTED });
  page.drawText(money(r.rate_cents), { x: M + 16, y: y - 30, size: 20, font: bold, color: NAVY });
  y -= 62;
  heading("Terms");
  (r.status === "confirmed" ? termsFor(r.terms_version) : TERMS).forEach((t, i) => {
    const lines = wrap(t, font, 8.8, W - M * 2 - 16);
    ensure(lines.length * 11.6 + 4);
    page.drawText(`${i + 1}.`, { x: M, y, size: 8.8, font: bold, color: INK });
    lines.forEach((l, k) => page.drawText(l, { x: M + 16, y: y - k * 11.6, size: 8.8, font, color: INK }));
    y -= lines.length * 11.6 + 4;
  });
  y -= 4;
  ensure(120); // keep the acceptance record together on one page
  heading("Acceptance");
  if (r.status === "confirmed") {
    row("Accepted by", `${[r.confirmed_name, r.confirmed_title].filter(Boolean).join(", ")}, for ${r.customer}`);
    row("Accepted by email", r.confirmed_email || r.email);
    if (r.confirmed_email && r.confirmed_email !== r.email) row("Link sent to", r.email);
    row("Date and time", `${stampText(r.confirmed_at)}   |   IP address ${r.confirmed_ip || "not recorded"}`);
    row("Method", "Typed name, terms checkbox and Confirm button at www.swiftlinkusa.com");
    row("Agreement ID", `${r.id}   |   Terms version ${r.terms_version}`);
  } else {
    row("Status", "Not yet accepted by the customer");
  }
  doc.setTitle(pdfSafe(`${r.load_no} - Customer Rate Agreement`));
  doc.setAuthor("SwiftLink Logistics, LLC");
  return doc.save();
}

export const pdfName = (r) => `${r.load_no} - Customer Rate Agreement.pdf`;

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Graph messages after a confirmation: one to SwiftLink (and the employee who sent the link), one copy to the customer. */
export function confirmationMessages(env, r, pdf) {
  const attachment = { "@odata.type": "#microsoft.graph.fileAttachment", name: pdfName(r), contentType: "application/pdf", contentBytes: base64(pdf) };
  const lane = `${place(r, "pickup")} -> ${place(r, "delivery")}`;
  const internal = [
    `${r.customer} approved the rate for load ${r.load_no}. The signed Customer Rate Agreement is attached for the invoice packet.`,
    "",
    `Load: ${r.load_no}${r.po ? `   PO: ${r.po}` : ""}`,
    `Lane: ${lane}`,
    `Pickup: ${dateText(r.pickup_date)}   Delivery: ${dateText(r.delivery_date)}`,
    `Rate: ${money(r.rate_cents)}`,
    "",
    `Accepted by: ${[r.confirmed_name, r.confirmed_title].filter(Boolean).join(", ")} (${r.confirmed_email || r.email})${r.confirmed_email && r.confirmed_email !== r.email ? `   Link sent to: ${r.email}` : ""}`,
    `When: ${stampText(r.confirmed_at)}   IP: ${r.confirmed_ip || "not recorded"}`,
    `Agreement ID: ${r.id}   Terms version: ${r.terms_version}`,
  ].join("\r\n");
  const to = [env.TO_ADDRESS, r.created_by].filter((v, i, a) => v && a.indexOf(v) === i).map((address) => ({ emailAddress: { address } }));
  const customer = [
    `Hello ${r.confirmed_name || r.contact_name || ""},`.replace(/ ,$/, ","),
    "",
    `Thank you for confirming the rate for load ${r.load_no} (${lane}, ${money(r.rate_cents)}). Your copy of the Customer Rate Agreement is attached.`,
    "",
    "If anything looks wrong, reply to this email or call (248) 987-6776.",
    "",
    "SwiftLink Logistics, LLC",
    "www.swiftlinkusa.com",
  ].join("\r\n");
  return [
    { message: { subject: `${r.load_no} - Customer Rate Agreement - confirmed by ${r.customer}`, body: { contentType: "Text", content: internal }, toRecipients: to, replyTo: [{ emailAddress: { address: r.email } }], attachments: [attachment] }, saveToSentItems: false },
    { message: { subject: `Load ${r.load_no} - your rate confirmation`, body: { contentType: "Text", content: customer }, toRecipients: [{ emailAddress: { address: r.confirmed_email || r.email } }], ccRecipients: r.confirmed_email && r.confirmed_email !== r.email ? [{ emailAddress: { address: r.email } }] : [], replyTo: [{ emailAddress: { address: env.TO_ADDRESS } }], attachments: [attachment] }, saveToSentItems: true },
  ];
}

// ---------- HTTP

const LIST_LIMIT = 300;

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const pdfResponse = (bytes, r) => new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdfName(r).replace(/"/g, "")}"`, "Cache-Control": "no-store" } });

/** /internal/ratecons/* — called only by the employee portal, which authenticates staff with Cloudflare Access. */
export async function internalRoute(request, env, deps) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.RATECON_KEY || !timingSafeEqual(auth, "Bearer " + env.RATECON_KEY)) return json({ error: "Forbidden" }, 403);
  const staff = clean(request.headers.get("X-Employee-Email"), 200).toLowerCase();
  if (!/^[^@\s]+@swiftlinkusa\.com$/.test(staff)) return json({ error: "Employee identity required" }, 403);
  const db = env.RATECONS;
  await ensureSchema(db);
  const path = new URL(request.url).pathname.replace(/^\/internal\/ratecons/, "") || "/";
  const now = deps.now();
  if (path === "/" && request.method === "GET") {
    const rows = (await db.prepare(`SELECT * FROM ratecons ORDER BY created DESC LIMIT ${LIST_LIMIT}`).all()).results;
    return json({ items: rows.map((r) => staffView(r, now)) }, 200);
  }
  if (path === "/" && request.method === "POST") {
    let input;
    try { const raw = await request.text(); if (raw.length > 8000) throw Error(); input = JSON.parse(raw); } catch { return json({ error: "Invalid request" }, 400); }
    const { data, errors } = parseNew(input);
    if (errors) return json({ error: errors.join(" ") }, 422);
    const r = { ...data, id: newId(), token: newToken(), status: "open", created_by: staff, created: new Date(now).toISOString(), expires: new Date(now + EXPIRY_DAYS * DAY).toISOString() };
    const cols = ["id", "token", "load_no", "po", "customer", "contact_name", "email", "pickup_zip", "pickup_city", "pickup_state", "pickup_date", "delivery_zip", "delivery_city", "delivery_state", "delivery_date", "rate_cents", "equipment", "notes", "status", "created_by", "created", "expires"];
    // A new link for the same load replaces any earlier link that was never confirmed.
    await db.batch([
      db.prepare("UPDATE ratecons SET status='void', voided_by=? WHERE load_no=? AND status='open'").bind("Replaced by a newer link", r.load_no),
      db.prepare(`INSERT INTO ratecons(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).bind(...cols.map((c) => r[c] === "" ? null : r[c])),
    ]);
    return json({ item: staffView(r, now) }, 200);
  }
  const m = path.match(/^\/([0-9a-f]{16})(\/void|\/pdf)?$/);
  if (!m) return json({ error: "Not found" }, 404);
  const r = await db.prepare("SELECT * FROM ratecons WHERE id=?").bind(m[1]).first();
  if (!r) return json({ error: "Not found" }, 404);
  if (m[2] === "/void" && request.method === "POST") {
    if (r.status !== "open") return json({ error: "Only links that are still waiting can be cancelled." }, 409);
    await db.prepare("UPDATE ratecons SET status='void', voided_by=? WHERE id=? AND status='open'").bind(staff, r.id).run();
    return json({ ok: true }, 200);
  }
  if (m[2] === "/pdf" && request.method === "GET") return pdfResponse(await buildPdf(r, deps.logo), r);
  return json({ error: "Not found" }, 404);
}

/** /rate-confirmations/<token>[/confirm|/pdf] — the public customer side, called from www.swiftlinkusa.com. */
export async function publicRoute(request, env, deps, allowed) {
  const m = new URL(request.url).pathname.match(/^\/rate-confirmations\/([^/]+)(\/confirm|\/pdf)?$/);
  if (!m || !isToken(m[1])) return json({ error: "This link is not valid." }, 404, allowed);
  const db = env.RATECONS;
  await ensureSchema(db);
  const r = await db.prepare("SELECT * FROM ratecons WHERE token=?").bind(m[1]).first();
  if (!r) return json({ error: "This link is not valid. Ask SwiftLink to send a new one." }, 404, allowed);
  const now = deps.now();
  if (!m[2] && request.method === "GET") {
    if (!r.viewed_at && r.status === "open") await db.prepare("UPDATE ratecons SET viewed_at=? WHERE id=? AND viewed_at IS NULL").bind(new Date(now).toISOString(), r.id).run();
    return json(publicView(r, now), 200, allowed);
  }
  if (m[2] === "/pdf" && request.method === "GET") {
    if (r.status !== "confirmed") return json({ error: "Not confirmed yet" }, 409, allowed);
    const res = pdfResponse(await buildPdf(r, deps.logo), r);
    if (allowed) { res.headers.set("Access-Control-Allow-Origin", allowed); res.headers.set("Vary", "Origin"); }
    return res;
  }
  if (m[2] !== "/confirm" || request.method !== "POST") return json({ error: "Method not allowed" }, 405, allowed);
  let form;
  try { form = await request.formData(); } catch { return json({ error: "Invalid submission" }, 400, allowed); }
  const notHuman = await deps.verifyHuman(form, request, env, allowed);
  if (notHuman) return notHuman;
  const name = clean(form.get("name"), 80), email = clean(form.get("email"), 200).toLowerCase();
  if (name.length < 2) return json({ error: "Type your full name to sign." }, 422, allowed);
  if (!isEmail(email)) return json({ error: "Enter your email so we can send your copy." }, 422, allowed);
  if (form.get("agree") !== "on") return json({ error: "Check the box to agree to the rate and terms." }, 422, allowed);
  const state = statusOf(r, now);
  if (state !== "open") return json({ error: state === "confirmed" ? "This rate was already confirmed." : state === "expired" ? "This link has expired. Ask SwiftLink to send a new one." : "This link was cancelled. Ask SwiftLink to send a new one." }, 409, allowed);
  const at = new Date(now).toISOString(), ip = clean(request.headers.get("CF-Connecting-IP"), 64), ua = clean(request.headers.get("User-Agent"), 300);
  // Only one confirmation can win, even if the button is pressed twice.
  const result = await db.prepare("UPDATE ratecons SET status='confirmed', confirmed_at=?, confirmed_name=?, confirmed_email=?, confirmed_ip=?, confirmed_ua=?, terms_version=? WHERE id=? AND status='open'")
    .bind(at, name, email, ip || null, ua || null, TERMS_VERSION, r.id).run();
  if (!result.meta.changes) return json({ error: "This rate was already confirmed." }, 409, allowed);
  const done = { ...r, status: "confirmed", confirmed_at: at, confirmed_name: name, confirmed_email: email, confirmed_ip: ip || null, terms_version: TERMS_VERSION };
  try {
    const pdf = await buildPdf(done, deps.logo);
    for (const message of confirmationMessages(env, done, pdf)) await deps.sendMail(env, message);
  } catch (error) {
    // The confirmation still counts; staff see the flag in the portal and can download the PDF there.
    console.error("Rate confirmation email failed", error);
    await db.prepare("UPDATE ratecons SET email_error=? WHERE id=?").bind(String(error.message || error).slice(0, 300), r.id).run();
  }
  return json(publicView(done, now), 200, allowed);
}
