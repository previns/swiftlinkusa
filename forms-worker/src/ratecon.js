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
  // Saved customers: filled in when staff create a link, signer details added when someone confirms.
  `CREATE TABLE IF NOT EXISTS ratecon_customers (
    name TEXT PRIMARY KEY COLLATE NOCASE, contact_name TEXT, email TEXT NOT NULL, signer_name TEXT, signer_email TEXT,
    loads INTEGER NOT NULL DEFAULT 0, last_used TEXT, removed INTEGER NOT NULL DEFAULT 0)`,
];
const ready = new WeakSet();
export async function ensureSchema(db) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  // Tables created before confirmed_email existed get the column added once; "duplicate column" means it is already there.
  try { await db.prepare("ALTER TABLE ratecons ADD COLUMN confirmed_email TEXT").run(); } catch {}
  try { await db.prepare("ALTER TABLE ratecons ADD COLUMN confirm_method TEXT").run(); } catch {}
  try { await db.prepare("ALTER TABLE ratecons ADD COLUMN sent_at TEXT").run(); } catch {}
  try { await db.prepare("ALTER TABLE ratecons ADD COLUMN sent_by TEXT").run(); } catch {}
  try { await db.prepare("ALTER TABLE ratecons ADD COLUMN batch TEXT").run(); } catch {}
  // More than one person per link (cc: the others, JSON) and every saved contact of a customer (contacts, JSON).
  try { await db.prepare("ALTER TABLE ratecons ADD COLUMN cc TEXT").run(); } catch {}
  try { await db.prepare("ALTER TABLE ratecon_customers ADD COLUMN contacts TEXT").run(); } catch {}
  await db.prepare("CREATE INDEX IF NOT EXISTS ratecons_batch ON ratecons(batch)").run();
  // Customers from links made before saved customers existed (INSERT OR IGNORE never revives a removed one).
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO ratecon_customers(name, contact_name, email, loads, last_used) SELECT customer, contact_name, email, COUNT(*), MAX(created) FROM ratecons WHERE status!='deleted' GROUP BY customer COLLATE NOCASE"),
    db.prepare("UPDATE ratecon_customers SET signer_name=(SELECT confirmed_name FROM ratecons r WHERE r.customer=ratecon_customers.name COLLATE NOCASE AND r.status='confirmed' ORDER BY r.confirmed_at DESC LIMIT 1), signer_email=(SELECT COALESCE(confirmed_email, email) FROM ratecons r WHERE r.customer=ratecon_customers.name COLLATE NOCASE AND r.status='confirmed' ORDER BY r.confirmed_at DESC LIMIT 1) WHERE signer_name IS NULL"),
  ]);
  ready.add(db);
}

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// "dana lee" / "DANA LEE" -> "Dana Lee", "o'neil-smith" -> "O'Neil-Smith"; mixed-case words like "McDonald" are kept as typed.
export const properName = (v) => String(v ?? "").split(" ").map((w) => (w === w.toLowerCase() || w === w.toUpperCase() ? w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, p, c) => p + c.toUpperCase()) : w)).join(" ");
const isEmail = (v) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v);
const MAX_CONTACTS = 20;
/** Contacts from the portal: [{name, email}] → cleaned, deduplicated by email. Returns { list } or { error }. */
export function parseContacts(input, max = MAX_CONTACTS) {
  if (input === undefined || input === null) return { list: [] };
  if (!Array.isArray(input) || input.length > max) return { error: `Choose up to ${max} contacts.` };
  const list = [];
  for (const c of input) {
    const email = clean(c?.email, 200).toLowerCase(), name = properName(clean(c?.name, 80));
    if (!isEmail(email)) return { error: `Check the email${name ? ` for ${name}` : ""}.` };
    if (!list.some((x) => x.email === email)) list.push({ name, email, ...(c?.on === false ? { on: false } : {}) });
  }
  return { list };
}
const parseJson = (v) => { try { const x = JSON.parse(v || "null"); return Array.isArray(x) ? x : []; } catch { return []; } };
/** Everyone a link went to: the main contact first, then the others. */
export const recipientsOf = (r) => [{ name: r.contact_name || "", email: r.email }, ...parseJson(r.cc).filter((c) => c.email !== r.email)];
/** A saved customer's contacts; customers saved before contacts existed have just their one contact. on: picked last time. */
export const contactsOf = (c) => { const list = parseJson(c.contacts); return list.length ? list.map((x) => ({ name: x.name || "", email: x.email, on: x.on !== false })) : c.email ? [{ name: c.contact_name || "", email: c.email, on: true }] : []; };
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
    contact_name: properName(clean(input.contact_name, 80)), email: clean(input.email, 200).toLowerCase(),
    pickup_zip: clean(input.pickup_zip, 5), pickup_city: clean(input.pickup_city, 60), pickup_state: clean(input.pickup_state, 2).toUpperCase(), pickup_date: clean(input.pickup_date, 10),
    delivery_zip: clean(input.delivery_zip, 5), delivery_city: clean(input.delivery_city, 60), delivery_state: clean(input.delivery_state, 2).toUpperCase(), delivery_date: clean(input.delivery_date, 10),
    equipment: clean(input.equipment, 40), notes: clean(input.notes, 500),
  };
  if (!/^[A-Z0-9-]{1,20}$/.test(d.load_no)) errors.push("Load number: letters, numbers and dashes only.");
  if (!d.customer) errors.push("Customer company is required.");
  if (!isEmail(d.email)) errors.push("Enter the customer's email address.");
  // Other people the link goes to, besides the main contact.
  const cc = parseContacts(input.cc, MAX_CONTACTS - 1);
  if (cc.error) errors.push(cc.error);
  else { const others = cc.list.filter((c) => c.email !== d.email).map(({ name, email }) => ({ name, email })); d.cc = others.length ? JSON.stringify(others) : null; }
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

/** What the customer page may see: no internal IDs, creator, IP or other confirmations.
 *  returning: the last person at this customer who confirmed a rate, so their details can be prefilled. */
export function publicView(r, now = Date.now(), returning = null) {
  return {
    load_no: r.load_no, po: r.po || "", customer: r.customer, contact_name: r.contact_name || "",
    pickup: { place: place(r, "pickup"), date: r.pickup_date }, delivery: { place: place(r, "delivery"), date: r.delivery_date },
    rate: money(r.rate_cents), equipment: r.equipment || "", notes: r.notes || "", status: statusOf(r, now),
    confirmed: r.status === "confirmed" ? { name: r.confirmed_name, at: r.confirmed_at } : null,
    terms: r.status === "confirmed" ? termsFor(r.terms_version) : TERMS, terms_version: r.terms_version || TERMS_VERSION,
    returning: statusOf(r, now) === "open" && returning?.signer_name && returning?.signer_email ? { name: properName(returning.signer_name), email: returning.signer_email } : null,
  };
}
// Only one version exists so far; older versions get added here when the wording changes.
const termsFor = () => TERMS;

const staffView = (r, now) => ({ ...r, status: statusOf(r, now), rate: money(r.rate_cents), link: LINK_BASE + r.token, token: undefined, confirmed_ua: undefined, cc: undefined, recipients: recipientsOf(r) });

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
    row("Accepted by", `${[properName(r.confirmed_name), r.confirmed_title].filter(Boolean).join(", ")}, for ${r.customer}`);
    row("Accepted by email", r.confirmed_email || r.email);
    const sentTo = recipientsOf(r).map((c) => c.email);
    if (sentTo.length > 1 || (r.confirmed_email && r.confirmed_email !== r.email)) row("Link sent to", sentTo.join(", "));
    row("Date and time", `${stampText(r.confirmed_at)}   |   IP address ${r.confirmed_ip || "not recorded"}`);
    row("Method", r.confirm_method === "returning" ? "Saved signer details, then Agree & Confirm button at www.swiftlinkusa.com" : "Typed name, terms checkbox and Confirm button at www.swiftlinkusa.com");
    row("Agreement ID", `${r.id}   |   Terms version ${r.terms_version}`);
  } else {
    row("Status", "Not yet accepted by the customer");
  }
  doc.setTitle(pdfSafe(`${r.load_no} - Customer Rate Agreement`));
  doc.setAuthor("SwiftLink Logistics, LLC");
  return doc.save();
}

export const pdfName = (r) => `${r.load_no} - Customer Rate Agreement.pdf`;

// ---------- invitation email (what the customer receives with their link)

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LOGO_URL = "https://www.swiftlinkusa.com/img/swiftlink-logo-email.png";

/** The invitation email: a big button, a hyperlink and the plain link to copy. Table layout and inline styles for Outlook.
 *  Takes one load or every waiting load of a multi-load link (they share one link). */
export function inviteEmail(input) {
  const list = Array.isArray(input) ? input : [input], r = list[0], multi = list.length > 1;
  const link = LINK_BASE + (r.batch || r.token);
  const loadNos = list.map((x) => x.load_no);
  const subject = multi ? `Rate confirmation – ${list.length} loads (${loadNos.slice(0, 4).join(", ")}${list.length > 4 ? ", …" : ""})` : `Rate confirmation – Load ${r.load_no}`;
  // "Hi Dana," for one person, "Hi Dana and Mike," for two, "Hello," otherwise or when a name is missing.
  const people = recipientsOf(r), firsts = people.map((c) => properName(c.name).split(" ")[0]).filter(Boolean);
  const hi = firsts.length === people.length && people.length <= 2 ? `Hi ${firsts.join(" and ")},` : "Hello,";
  const font = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;";
  const cell = (i, extra = "") => `padding:9px 12px;${i ? "border-top:1px solid #e6eaf0;" : ""}${font}font-size:13px;color:#1b2a4a;${extra}`;
  const total = list.reduce((t, x) => t + x.rate_cents, 0);
  let details;
  if (multi) {
    details = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #dce2eb;background:#f8f9fc">
<tr><td style="${cell(0, "color:#626e83;font-size:12px;font-weight:600")}">Load</td><td style="${cell(0, "color:#626e83;font-size:12px;font-weight:600")}">Lane</td><td style="${cell(0, "color:#626e83;font-size:12px;font-weight:600")}">Pickup</td><td align="right" style="${cell(0, "color:#626e83;font-size:12px;font-weight:600;text-align:right")}">Rate</td></tr>
${list.map((x) => `<tr><td style="${cell(1, "font-weight:600;white-space:nowrap")}">${esc(x.load_no)}${x.po ? `<br><span style="color:#626e83;font-weight:400;font-size:12px">PO ${esc(x.po)}</span>` : ""}</td><td style="${cell(1)}">${esc(place(x, "pickup"))} → ${esc(place(x, "delivery"))}</td><td style="${cell(1, "white-space:nowrap")}">${esc(dateText(x.pickup_date))}</td><td align="right" style="${cell(1, "font-weight:700;text-align:right;white-space:nowrap")}">${esc(money(x.rate_cents))}</td></tr>`).join("\n")}
<tr><td colspan="3" style="${cell(1, "font-weight:700")}">Total (${list.length} loads)</td><td align="right" style="${cell(1, "font-weight:700;font-size:15px;text-align:right;white-space:nowrap")}">${esc(money(total))}</td></tr>
</table>`;
  } else {
    const rows = [["Load", r.load_no + (r.po ? `  ·  PO ${r.po}` : "")], ["Lane", `${place(r, "pickup")} → ${place(r, "delivery")}`], ["Pickup", dateText(r.pickup_date)], ["Delivery", dateText(r.delivery_date)], ...(r.equipment ? [["Equipment", r.equipment]] : []), ["Rate", money(r.rate_cents)]];
    details = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #dce2eb;background:#f8f9fc">
${rows.map(([k, v], i) => `<tr><td style="padding:9px 14px;${i ? "border-top:1px solid #e6eaf0;" : ""}${font}font-size:13px;color:#626e83;width:110px">${esc(k)}</td><td style="padding:9px 14px;${i ? "border-top:1px solid #e6eaf0;" : ""}${font}font-size:14px;color:#1b2a4a;${k === "Rate" ? "font-weight:700;font-size:16px;" : ""}">${esc(v)}</td></tr>`).join("\n")}
</table>`;
  }
  const intro = multi ? `Please review and confirm the rates for these <b>${list.length} loads</b>. You can approve them all at once, and it only takes a few seconds.` : `Please review and confirm the rate for load <b>${esc(r.load_no)}</b>. It only takes a few seconds.`;
  const button = multi ? `Review &amp; confirm ${list.length} loads` : "Review &amp; confirm rate";
  const linkText = multi ? `Open the rate confirmation for ${list.length} loads` : `Open the rate confirmation for load ${esc(r.load_no)}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f2f4f8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f4f8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #dce2eb;${font}color:#1b2a4a">
<tr><td style="padding:22px 28px 18px 28px;border-bottom:4px solid #c9a227"><img src="${LOGO_URL}" width="170" alt="SwiftLink Logistics" style="display:block;border:0;width:170px;height:auto"></td></tr>
<tr><td style="padding:28px 28px 8px 28px;${font}font-size:15px;line-height:22px;color:#1b2a4a">
<p style="margin:0 0 14px 0">${esc(hi)}</p>
<p style="margin:0 0 18px 0">${intro}</p>
${details}
</td></tr>
<tr><td align="center" style="padding:24px 28px 8px 28px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#c9a227" style="background:#c9a227;border-radius:8px">
<a href="${esc(link)}" target="_blank" style="display:inline-block;padding:15px 34px;${font}font-size:16px;font-weight:700;color:#1b2a4a;text-decoration:none;border-radius:8px">${button}</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:14px 28px 26px 28px;${font}font-size:13px;line-height:20px;color:#626e83">
<p style="margin:0 0 10px 0">Or click here: <a href="${esc(link)}" target="_blank" style="color:#2c5d8f;text-decoration:underline">${linkText}</a></p>
<p style="margin:0">If the button and link don't work, copy and paste this into your browser:<br><span style="font-family:Consolas,'Courier New',monospace;font-size:12px;color:#1b2a4a;word-break:break-all">${esc(link)}</span></p>
</td></tr>
<tr><td style="padding:14px 28px;background:#f8f9fc;border-top:1px solid #e6eaf0;${font}font-size:12px;color:#626e83">SwiftLink Logistics, LLC &nbsp;·&nbsp; <a href="https://www.swiftlinkusa.com" style="color:#626e83">www.swiftlinkusa.com</a></td></tr>
</table></td></tr></table></body></html>`;
  const lines = multi ? [...list.map((x) => `${x.load_no}: ${place(x, "pickup")} -> ${place(x, "delivery")}, pickup ${dateText(x.pickup_date)}, ${money(x.rate_cents)}`), `Total (${list.length} loads): ${money(total)}`] : [`Load: ${r.load_no}${r.po ? `  PO ${r.po}` : ""}`, `Lane: ${place(r, "pickup")} -> ${place(r, "delivery")}`, `Pickup: ${dateText(r.pickup_date)}`, `Delivery: ${dateText(r.delivery_date)}`, `Rate: ${money(r.rate_cents)}`];
  const text = [hi, "", multi ? `Please review and confirm the rates for these ${list.length} loads. You can approve them all at once.` : `Please review and confirm the rate for load ${r.load_no}. It only takes a few seconds.`, "", ...lines, "", `${multi ? `Review & confirm ${list.length} loads` : "Review & confirm rate"}: ${link}`, "", "Thank you,"].join("\n");
  return { subject, html, text, to: people.map((c) => c.email).join(","), recipients: people };
}

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Graph messages after a confirmation: one to SwiftLink (and whoever sent the link), one copy to the customer.
 *  rows/pdfs: every load confirmed in this one action (one for a single-load link). Each PDF is attached separately. */
export function confirmationMessages(env, rowsIn, pdfsIn) {
  const rows = Array.isArray(rowsIn) ? rowsIn : [rowsIn], pdfs = Array.isArray(pdfsIn) ? pdfsIn : [pdfsIn], r = rows[0], multi = rows.length > 1;
  const attachments = rows.map((x, i) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: pdfName(x), contentType: "application/pdf", contentBytes: base64(pdfs[i]) }));
  const lane = (x) => `${place(x, "pickup")} -> ${place(x, "delivery")}`;
  const signer = r.confirmed_email || r.email, sentTo = recipientsOf(r).map((c) => c.email);
  const total = rows.reduce((t, x) => t + x.rate_cents, 0);
  const loadLines = rows.flatMap((x) => [`Load: ${x.load_no}${x.po ? `   PO: ${x.po}` : ""}`, `Lane: ${lane(x)}`, `Pickup: ${dateText(x.pickup_date)}   Delivery: ${dateText(x.delivery_date)}`, `Rate: ${money(x.rate_cents)}`, ...(multi ? [`Agreement ID: ${x.id}`, ""] : [])]);
  const internal = [
    multi ? `${r.customer} approved the rates for ${rows.length} loads (${rows.map((x) => x.load_no).join(", ")}). A signed Customer Rate Agreement for each load is attached for the invoice packets.` : `${r.customer} approved the rate for load ${r.load_no}. The signed Customer Rate Agreement is attached for the invoice packet.`,
    "",
    ...loadLines,
    ...(multi ? [`Total: ${money(total)}`, ""] : [""]),
    `Accepted by: ${[r.confirmed_name, r.confirmed_title].filter(Boolean).join(", ")} (${r.confirmed_email || r.email})${sentTo.length > 1 || (r.confirmed_email && r.confirmed_email !== r.email) ? `   Link sent to: ${sentTo.join(", ")}` : ""}`,
    `When: ${stampText(r.confirmed_at)}   IP: ${r.confirmed_ip || "not recorded"}`,
    multi ? `Terms version: ${r.terms_version}` : `Agreement ID: ${r.id}   Terms version: ${r.terms_version}`,
  ].join("\r\n");
  const to = [env.TO_ADDRESS, ...rows.map((x) => x.created_by)].filter((v, i, a) => v && a.indexOf(v) === i).map((address) => ({ emailAddress: { address } }));
  const customer = [
    `Hello ${r.confirmed_name || r.contact_name || ""},`.replace(/ ,$/, ","),
    "",
    multi ? `Thank you for confirming the rates for ${rows.length} loads. Your copies of the Customer Rate Agreements (one per load) are attached.` : `Thank you for confirming the rate for load ${r.load_no} (${lane(r)}, ${money(r.rate_cents)}). Your copy of the Customer Rate Agreement is attached.`,
    ...(multi ? ["", ...rows.map((x) => `${x.load_no}: ${lane(x)}, ${money(x.rate_cents)}`), `Total: ${money(total)}`] : []),
    "",
    "SwiftLink Logistics, LLC",
    "www.swiftlinkusa.com",
  ].join("\r\n");
  const subjectInternal = multi ? `${rows.length} loads - Customer Rate Agreements - confirmed by ${r.customer}` : `${r.load_no} - Customer Rate Agreement - confirmed by ${r.customer}`;
  const subjectCustomer = multi ? `${rows.length} loads - your rate confirmations` : `Load ${r.load_no} - your rate confirmation`;
  return [
    { message: { subject: subjectInternal, body: { contentType: "Text", content: internal }, toRecipients: to, replyTo: [{ emailAddress: { address: r.email } }], attachments }, saveToSentItems: false },
    { message: { subject: subjectCustomer, body: { contentType: "Text", content: customer }, toRecipients: [{ emailAddress: { address: signer } }], ccRecipients: sentTo.filter((e) => e !== signer).map((address) => ({ emailAddress: { address } })), replyTo: [{ emailAddress: { address: env.TO_ADDRESS } }], attachments }, saveToSentItems: true },
  ];
}

// ---------- HTTP

const LIST_LIMIT = 300, MAX_LOADS = 25;

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const pdfResponse = (bytes, name) => new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`, "Cache-Control": "no-store" } });
// Every load of a multi-load link shares one "batch" token; a single-load link is a group of one.
const groupLink = (r) => LINK_BASE + (r.batch || r.token);
async function groupRows(db, r) {
  if (!r.batch) return [r];
  return (await db.prepare("SELECT * FROM ratecons WHERE batch=? AND status!='deleted' ORDER BY rowid").bind(r.batch).all()).results;
}
/** One PDF holding every confirmed agreement of a multi-load link, in load order. */
export async function combinedPdf(rows, logo) {
  const out = await PDFDocument.create();
  for (const r of rows) { const doc = await PDFDocument.load(await buildPdf(r, logo)); for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page); }
  out.setTitle(pdfSafe(`${rows.map((r) => r.load_no).join(", ")} - Customer Rate Agreements`));
  out.setAuthor("SwiftLink Logistics, LLC");
  return out.save();
}
const combinedName = (rows) => `${rows.length > 3 ? `${rows[0].load_no}-${rows.at(-1).load_no} (${rows.length} loads)` : rows.map((r) => r.load_no).join(", ")} - Customer Rate Agreements.pdf`;

const INSERT_COLS = ["id", "token", "batch", "load_no", "po", "customer", "contact_name", "email", "pickup_zip", "pickup_city", "pickup_state", "pickup_date", "delivery_zip", "delivery_city", "delivery_state", "delivery_date", "rate_cents", "equipment", "notes", "cc", "status", "created_by", "created", "expires"];

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
    const rows = (await db.prepare(`SELECT * FROM ratecons WHERE status!='deleted' ORDER BY created DESC, rowid ASC LIMIT ${LIST_LIMIT}`).all()).results;
    const sizes = new Map((await db.prepare("SELECT batch, COUNT(*) AS n FROM ratecons WHERE batch IS NOT NULL AND status!='deleted' GROUP BY batch").all()).results.map((b) => [b.batch, b.n]));
    return json({ items: rows.map((r) => ({ ...staffView(r, now), link: groupLink(r), batch: undefined, batch_id: r.batch ? r.batch.slice(0, 8) : null, batch_size: r.batch ? sizes.get(r.batch) || 1 : 1 })) }, 200);
  }
  if (path === "/" && request.method === "POST") {
    let input;
    try { const raw = await request.text(); if (raw.length > 60000) throw Error(); input = JSON.parse(raw); } catch { return json({ error: "Invalid request" }, 400); }
    // One load, or several loads for the same customer sharing one link ({customer, contact_name, email, cc, loads: [...]}).
    // contact_name/email is the main contact; cc is everyone else picked to receive the link.
    const many = Array.isArray(input?.loads);
    if (many && (input.loads.length < 1 || input.loads.length > MAX_LOADS)) return json({ error: `Send between 1 and ${MAX_LOADS} loads at a time.` }, 422);
    const shared = many ? { customer: input.customer, contact_name: input.contact_name, email: input.email, cc: input.cc } : {};
    const parsed = (many ? input.loads : [input]).map((load) => parseNew({ ...(load && typeof load === "object" ? load : {}), ...shared }));
    const errors = parsed.flatMap((p, i) => (p.errors || []).map((e) => (parsed.length > 1 ? `Load ${i + 1}: ${e}` : e)));
    const dupes = parsed.map((p) => p.data?.load_no).filter((n, i, a) => n && a.indexOf(n) !== i);
    if (dupes.length) errors.push(`Load ${dupes[0]} is listed twice.`);
    if (errors.length) return json({ error: errors.join(" ") }, 422);
    const base = { status: "open", created_by: staff, created: new Date(now).toISOString(), expires: new Date(now + EXPIRY_DAYS * DAY).toISOString(), batch: parsed.length > 1 ? newToken() : null };
    const rows = parsed.map((p) => ({ ...p.data, ...base, id: newId(), token: newToken() }));
    const first = rows[0];
    // The customer's saved contacts: everyone picked this time is marked on (picked by default next time), the rest off;
    // new people are added after the ones already saved.
    const saved = await db.prepare("SELECT name, contact_name, email, contacts, removed FROM ratecon_customers WHERE name=?").bind(first.customer).first();
    const picked = recipientsOf(first), known = saved && !saved.removed ? contactsOf(saved) : [];
    const contacts = [...known.map((c) => { const p = picked.find((x) => x.email === c.email); return { name: p?.name || c.name, email: c.email, on: !!p }; }), ...picked.filter((p) => !known.some((c) => c.email === p.email)).map((p) => ({ ...p, on: true }))].slice(-MAX_CONTACTS);
    await db.batch([
      // A new link for the same load replaces any earlier link that was never confirmed.
      ...rows.map((r) => db.prepare("UPDATE ratecons SET status='void', voided_by=? WHERE load_no=? AND status='open'").bind("Replaced by a newer link", r.load_no)),
      ...rows.map((r) => db.prepare(`INSERT INTO ratecons(${INSERT_COLS.join(",")}) VALUES(${INSERT_COLS.map(() => "?").join(",")})`).bind(...INSERT_COLS.map((c) => r[c] === "" || r[c] === undefined ? null : r[c]))),
      db.prepare(`INSERT INTO ratecon_customers(name, contact_name, email, contacts, loads, last_used) VALUES(?,?,?,?,?,?)
        ON CONFLICT(name) DO UPDATE SET contact_name=excluded.contact_name, email=excluded.email, contacts=excluded.contacts,
        loads=ratecon_customers.loads+excluded.loads, last_used=excluded.last_used, removed=0`).bind(first.customer, first.contact_name || null, first.email, JSON.stringify(contacts), rows.length, first.created),
    ]);
    const items = rows.map((r) => ({ ...staffView(r, now), link: groupLink(r), batch: undefined, batch_id: r.batch ? r.batch.slice(0, 8) : null, batch_size: rows.length }));
    return json(many ? { items, link: items[0].link } : { item: items[0] }, 200);
  }
  if (path === "/customers" && request.method === "GET") {
    const rows = (await db.prepare("SELECT name, contact_name, email, contacts, signer_name, signer_email, loads, last_used FROM ratecon_customers WHERE removed=0 ORDER BY last_used DESC LIMIT 500").all()).results;
    return json({ customers: rows.map((c) => ({ ...c, contacts: contactsOf(c) })) }, 200);
  }
  if (path === "/customers/update" && request.method === "POST") {
    let input;
    try { input = JSON.parse(await request.text()); } catch { return json({ error: "Invalid request" }, 400); }
    const name = clean(input?.name, 120);
    // The whole contact list ({contacts: [...]}); the first one picked becomes the main contact. Older pages send one contact_name/email.
    const parsed = Array.isArray(input?.contacts) ? parseContacts(input.contacts) : parseContacts([{ name: input?.contact_name, email: input?.email }]);
    if (!name) return json({ error: "Invalid request" }, 400);
    if (parsed.error) return json({ error: parsed.error }, 422);
    if (!parsed.list.length) return json({ error: "Keep at least one contact for this customer." }, 422);
    const contacts = parsed.list.map((c) => ({ ...c, on: c.on !== false })), main = contacts.find((c) => c.on) || contacts[0];
    const res = await db.prepare("UPDATE ratecon_customers SET contact_name=?, email=?, contacts=? WHERE name=?").bind(main.name || null, main.email, JSON.stringify(contacts), name).run();
    return res.meta.changes ? json({ ok: true, contact_name: main.name, email: main.email, contacts }, 200) : json({ error: "Customer not found" }, 404);
  }
  if (path === "/customers/remove" && request.method === "POST") {
    let input;
    try { input = JSON.parse(await request.text()); } catch { return json({ error: "Invalid request" }, 400); }
    const name = clean(input?.name, 120);
    if (!name) return json({ error: "Invalid request" }, 400);
    // Removing also forgets who signed for them, so a later link never opens with a "Welcome back" for that person.
    await db.prepare("UPDATE ratecon_customers SET removed=1, signer_name=NULL, signer_email=NULL WHERE name=?").bind(name).run();
    return json({ ok: true }, 200);
  }
  const m = path.match(/^\/([0-9a-f]{16})(\/void|\/pdf|\/delete|\/email|\/send)?$/);
  if (!m) return json({ error: "Not found" }, 404);
  const r = await db.prepare("SELECT * FROM ratecons WHERE id=?").bind(m[1]).first();
  if (!r) return json({ error: "Not found" }, 404);
  if (m[2] === "/void" && request.method === "POST") {
    if (r.status !== "open") return json({ error: "Only links that are still waiting can be cancelled." }, 409);
    await db.prepare("UPDATE ratecons SET status='void', voided_by=? WHERE id=? AND status='open'").bind(staff, r.id).run();
    return json({ ok: true }, 200);
  }
  if (m[2] === "/pdf" && request.method === "GET") return pdfResponse(await buildPdf(r, deps.logo), pdfName(r));
  // The invitation covers every load on the link that is still waiting.
  const waiting = async () => (await groupRows(db, r)).filter((x) => statusOf(x, now) === "open");
  if (m[2] === "/email" && request.method === "GET") {
    const list = await waiting();
    return json(inviteEmail(list.length ? list : [r]), 200);
  }
  // Sends the invitation from SwiftLink's mailbox; the employee is copied and replies go to them.
  if (m[2] === "/send" && request.method === "POST") {
    const list = await waiting();
    if (!list.length) return json({ error: "Only links that are still waiting can be emailed." }, 409);
    const mail = inviteEmail(list);
    try {
      await deps.sendMail(env, { message: { subject: mail.subject, body: { contentType: "HTML", content: mail.html }, toRecipients: mail.recipients.map((c) => ({ emailAddress: { address: c.email, ...(c.name ? { name: c.name } : {}) } })), ccRecipients: [{ emailAddress: { address: staff } }], replyTo: [{ emailAddress: { address: staff } }] }, saveToSentItems: true });
    } catch (error) {
      console.error("Rate confirmation invite failed", error);
      return json({ error: "The email could not be sent. Try again, or use Open in Outlook." }, 502);
    }
    const at = new Date(now).toISOString();
    await db.batch(list.map((x) => db.prepare("UPDATE ratecons SET sent_at=?, sent_by=? WHERE id=?").bind(at, staff, x.id)));
    return json({ ok: true, sent_at: at, sent_by: staff, ids: list.map((x) => x.id), to: mail.recipients.map((c) => c.email) }, 200);
  }
  // Deleting hides the record from staff and turns its link off; the row stays in the database as a record.
  if (m[2] === "/delete" && request.method === "POST") {
    await db.prepare("UPDATE ratecons SET status='deleted', voided_by=? WHERE id=?").bind(staff, r.id).run();
    return json({ ok: true }, 200);
  }
  return json({ error: "Not found" }, 404);
}

/** Customer-facing view of a multi-load link. status: open while any load is still waiting. */
export function groupView(rows, now = Date.now(), returning = null) {
  const states = rows.map((r) => statusOf(r, now)), first = rows[0];
  const status = states.includes("open") ? "open" : states.includes("confirmed") ? "confirmed" : states.includes("expired") ? "expired" : "void";
  const shown = rows.filter((r, i) => states[i] === "open" || states[i] === "confirmed");
  const last = rows.filter((r) => r.status === "confirmed").sort((a, b) => String(b.confirmed_at).localeCompare(String(a.confirmed_at)))[0];
  return {
    multi: true, customer: first.customer, contact_name: first.contact_name || "", status,
    loads: shown.map((r) => ({ id: r.id, load_no: r.load_no, po: r.po || "", pickup: { place: place(r, "pickup"), date: r.pickup_date }, delivery: { place: place(r, "delivery"), date: r.delivery_date }, rate: money(r.rate_cents), equipment: r.equipment || "", notes: r.notes || "", status: statusOf(r, now) })),
    total: money(shown.reduce((t, r) => t + r.rate_cents, 0)), open_count: states.filter((s) => s === "open").length,
    confirmed: last ? { name: last.confirmed_name, at: last.confirmed_at } : null,
    terms: TERMS, terms_version: TERMS_VERSION,
    returning: status === "open" && returning?.signer_name && returning?.signer_email ? { name: properName(returning.signer_name), email: returning.signer_email } : null,
  };
}

/** /rate-confirmations/<token>[/confirm|/pdf] — the public customer side, called from www.swiftlinkusa.com. */
export async function publicRoute(request, env, deps, allowed) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/rate-confirmations\/([^/]+)(\/confirm|\/pdf)?$/);
  if (!m || !isToken(m[1])) return json({ error: "This link is not valid." }, 404, allowed);
  const db = env.RATECONS;
  await ensureSchema(db);
  const single = await db.prepare("SELECT * FROM ratecons WHERE token=? AND batch IS NULL").bind(m[1]).first();
  const rows = single ? [single] : (await db.prepare("SELECT * FROM ratecons WHERE batch=? AND status!='deleted' ORDER BY rowid").bind(m[1]).all()).results;
  if (!rows.length || rows[0].status === "deleted") return json({ error: "This link is not valid. Ask SwiftLink to send a new one." }, 404, allowed);
  const multi = !single, r = rows[0];
  const now = deps.now();
  const view = async (list) => {
    const returning = await db.prepare("SELECT signer_name, signer_email FROM ratecon_customers WHERE name=?").bind(r.customer).first();
    return multi ? groupView(list, now, returning) : publicView(list[0], now, returning);
  };
  if (!m[2] && request.method === "GET") {
    const unseen = rows.filter((x) => !x.viewed_at && x.status === "open");
    if (unseen.length) await db.batch(unseen.map((x) => db.prepare("UPDATE ratecons SET viewed_at=? WHERE id=? AND viewed_at IS NULL").bind(new Date(now).toISOString(), x.id)));
    return json(await view(rows), 200, allowed);
  }
  if (m[2] === "/pdf" && request.method === "GET") {
    // ?load=<id> for one agreement; otherwise every confirmed agreement on the link (one combined PDF for multi-load links).
    const confirmed = rows.filter((x) => x.status === "confirmed");
    const pick = url.searchParams.get("load");
    const target = pick ? confirmed.filter((x) => x.id === pick) : confirmed;
    if (!target.length) return json({ error: "Not confirmed yet" }, 409, allowed);
    const res = target.length === 1 ? pdfResponse(await buildPdf(target[0], deps.logo), pdfName(target[0])) : pdfResponse(await combinedPdf(target, deps.logo), combinedName(target));
    if (allowed) { res.headers.set("Access-Control-Allow-Origin", allowed); res.headers.set("Vary", "Origin"); res.headers.set("Access-Control-Expose-Headers", "Content-Disposition"); }
    return res;
  }
  if (m[2] !== "/confirm" || request.method !== "POST") return json({ error: "Method not allowed" }, 405, allowed);
  let form;
  try { form = await request.formData(); } catch { return json({ error: "Invalid submission" }, 400, allowed); }
  const notHuman = await deps.verifyHuman(form, request, env, allowed);
  if (notHuman) return notHuman;
  // Pages cached from before the email field existed send no "email" at all; fall back to the address the link went to.
  const name = properName(clean(form.get("name"), 80)), email = form.has("email") ? clean(form.get("email"), 200).toLowerCase() : r.email;
  if (name.length < 2) return json({ error: "Type your full name to sign." }, 422, allowed);
  if (!isEmail(email)) return json({ error: "Enter your email so we can send your copy." }, 422, allowed);
  if (form.get("agree") !== "on") return json({ error: "Check the box to agree to the rate and terms." }, 422, allowed);
  const open = rows.filter((x) => statusOf(x, now) === "open");
  if (!open.length) {
    const state = multi ? groupView(rows, now).status : statusOf(r, now);
    return json({ error: state === "confirmed" ? (multi ? "These rates were already confirmed." : "This rate was already confirmed.") : state === "expired" ? "This link has expired. Ask SwiftLink to send a new one." : "This link was cancelled. Ask SwiftLink to send a new one." }, 409, allowed);
  }
  const at = new Date(now).toISOString(), ip = clean(request.headers.get("CF-Connecting-IP"), 64), ua = clean(request.headers.get("User-Agent"), 300);
  const method = form.get("method") === "returning" ? "returning" : "typed";
  // Every waiting load is confirmed together; each row can only be confirmed once, even if the button is pressed twice.
  const results = await db.batch(open.map((x) => db.prepare("UPDATE ratecons SET status='confirmed', confirmed_at=?, confirmed_name=?, confirmed_email=?, confirmed_ip=?, confirmed_ua=?, terms_version=?, confirm_method=? WHERE id=? AND status='open'")
    .bind(at, name, email, ip || null, ua || null, TERMS_VERSION, method, x.id)));
  const done = open.filter((x, i) => results[i].meta.changes).map((x) => ({ ...x, status: "confirmed", confirmed_at: at, confirmed_name: name, confirmed_email: email, confirmed_ip: ip || null, terms_version: TERMS_VERSION, confirm_method: method }));
  if (!done.length) return json({ error: multi ? "These rates were already confirmed." : "This rate was already confirmed." }, 409, allowed);
  // Next time this customer gets a link, these details are filled in for them.
  await db.prepare(`INSERT INTO ratecon_customers(name, email, signer_name, signer_email, last_used) VALUES(?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET signer_name=excluded.signer_name, signer_email=excluded.signer_email`).bind(r.customer, r.email, name, email, at).run();
  try {
    const pdfs = [];
    for (const x of done) pdfs.push(await buildPdf(x, deps.logo));
    for (const message of confirmationMessages(env, done, pdfs)) await deps.sendMail(env, message);
  } catch (error) {
    // The confirmation still counts; staff see the flag in the portal and can download the PDFs there.
    console.error("Rate confirmation email failed", error);
    await db.batch(done.map((x) => db.prepare("UPDATE ratecons SET email_error=? WHERE id=?").bind(String(error.message || error).slice(0, 300), x.id)));
  }
  const updated = rows.map((x) => done.find((d) => d.id === x.id) || x);
  return json(multi ? groupView(updated, now) : publicView(updated[0], now), 200, allowed);
}
