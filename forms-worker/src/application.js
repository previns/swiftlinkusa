// Customer application: field rules, PDF filling and the email sent to SwiftLink.
// Form input names match the AcroForm field names in customer-application.pdf.
import { PDFDocument } from "pdf-lib";

const refs = [1, 2, 3, 4].flatMap((n) => [`ref${n}_company`, `ref${n}_contact`, `ref${n}_phone`, `ref${n}_email`]);

export const TEXT_FIELDS = [
  "company_name", "company_phone", "company_dba", "entity_type", "federal_tax_id",
  "phys_address", "phys_city", "phys_state", "phys_zip",
  "bill_address", "bill_city", "bill_state", "bill_zip",
  "year_started", "duns", "payment_terms", "weekly_volume",
  "ops_contact", "ops_phone", "ops_email", "ops_afterhours",
  "ap_contact", "ap_phone", "ap_email", "billing_portal", "pay_other_detail",
  ...refs,
  "bank_name", "bank_contact", "bank_phone",
  "sig_signature", "sig_print", "sig_title", "sig_email", "sig_phone",
];

export const REQUIRED_TEXT = [
  "company_name", "company_phone", "entity_type", "federal_tax_id",
  "phys_address", "phys_city", "phys_state", "phys_zip",
  "ops_contact", "ops_phone", "ops_email",
  "ap_contact", "ap_phone", "ap_email",
  "bank_name", "bank_phone",
  "sig_signature", "sig_print", "sig_title", "sig_email", "sig_phone",
];

const EMAIL_FIELDS = ["ops_email", "ap_email", "sig_email", ...[1, 2, 3, 4].map((n) => `ref${n}_email`)];

export const SERVICES = { svc_ftl: "Full Truckload", svc_ltl: "LTL", svc_drayage: "Drayage", svc_heavyhaul: "Heavy Haul", svc_expedited: "Expedited", svc_hazmat: "Hazmat" };
export const LOAD_VALUES = { val_50: "$0 – $50k", val_100: "$51k – $100k", val_250: "$101k – $250k", val_500: "$251k – $500k", val_501: "$501k+" };
export const PAYMENT = { pay_check: "Check", pay_ach: "ACH / Wire", pay_other: "Other" };
export const QUESTIONS = {
  q_edi: ["Do you require EDI transmission?", { q_edi_yes: "Yes", q_edi_no: "No" }],
  q_invoice: ["How do you prefer your invoice communications?", { q_invoice_email: "Email", q_invoice_fax: "Fax" }],
  q_po: ["Do you require your PO # on your invoices?", { q_po_yes: "Yes", q_po_no: "No" }],
  q_ratecon: ["Do you require a copy of your Rate Con with the Freight Bill?", { q_ratecon_yes: "Yes", q_ratecon_no: "No" }],
  q_pallet: ["Are your loads pallet exchanges?", { q_pallet_yes: "Yes", q_pallet_no: "No" }],
  q_lumpers: ["Does your company pay for lumpers?", { q_lumpers_yes: "Yes", q_lumpers_no: "No" }],
};

const MAX_LENGTH = 300;
const isEmail = (v) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v);

/** Validates submitted FormData. Returns { data } or { errors }. */
export function parseApplication(form, now = new Date()) {
  const errors = [];
  const text = {};
  for (const name of TEXT_FIELDS) {
    const value = String(form.get(name) ?? "").replace(/\s+/g, " ").trim();
    if (value.length > MAX_LENGTH) errors.push(`${name} is too long`);
    text[name] = value;
  }
  for (const name of REQUIRED_TEXT) if (!text[name]) errors.push(`${name} is required`);
  for (const name of EMAIL_FIELDS) if (text[name] && !isEmail(text[name])) errors.push(`${name} is not a valid email`);

  const services = Object.keys(SERVICES).filter((k) => form.get(k) === "on");
  if (!services.length) errors.push("Select at least one service");
  const loadValue = String(form.get("load_value") ?? "");
  if (!(loadValue in LOAD_VALUES)) errors.push("Select an estimated maximum load value");
  const payment = Object.keys(PAYMENT).filter((k) => form.get(k) === "on");
  const answers = {};
  for (const [group, [, options]] of Object.entries(QUESTIONS)) {
    const value = String(form.get(group) ?? "");
    if (value && !(value in options)) errors.push(`${group} is invalid`);
    answers[group] = value in options ? value : "";
  }
  if (form.get("terms_agree") !== "on") errors.push("You must agree to the Terms and Conditions");

  if (errors.length) return { errors };
  const date = now.toLocaleDateString("en-US", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" });
  return { data: { text: { ...text, sig_date: date }, services, loadValue, payment, answers } };
}

// The PDF's standard font only covers Windows-1252; drop anything else so filling never fails.
const pdfSafe = (v) => v.normalize("NFKC").replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, "");

/** Returns the filled, flattened application PDF as bytes. */
export async function fillPdf(templateBytes, data) {
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(data.text)) {
    if (!value) continue;
    const field = form.getTextField(name);
    const max = field.getMaxLength();
    const safe = pdfSafe(value);
    field.setText(max ? safe.slice(0, max) : safe);
  }
  const checked = [...data.services, data.loadValue, ...data.payment, ...Object.values(data.answers).filter(Boolean), "terms_agree"];
  for (const name of checked) form.getCheckBox(name).check();
  doc.setTitle(`Customer Application — ${pdfSafe(data.text.company_name)}`);
  form.flatten();
  return doc.save();
}

/** Plain-text summary of the application for the email body. */
export function summarize(d) {
  const t = d.text;
  const line = (label, value) => `${label}: ${value || "—"}`;
  const address = (a, c, s, z) => [t[a], [t[c], t[s]].filter(Boolean).join(", "), t[z]].filter(Boolean).join(" ");
  const out = [
    "New customer application submitted at swiftlinkusa.com. The completed PDF is attached.",
    "",
    "COMPANY INFORMATION",
    line("Company legal name", t.company_name),
    line("Phone", t.company_phone),
    line("DBA", t.company_dba),
    line("Entity type", t.entity_type),
    line("Federal Tax ID / EIN", t.federal_tax_id),
    line("Physical address", address("phys_address", "phys_city", "phys_state", "phys_zip")),
    line("Billing address", address("bill_address", "bill_city", "bill_state", "bill_zip") || "Same as physical"),
    "",
    "COMPANY CLASSIFICATION",
    line("Year business started", t.year_started),
    line("D&B / DUNS", t.duns),
    line("Requested payment terms", t.payment_terms),
    line("Avg. weekly shipment volume", t.weekly_volume),
    line("Services required", d.services.map((k) => SERVICES[k]).join(", ")),
    line("Estimated maximum load value", LOAD_VALUES[d.loadValue]),
    "",
    "OPERATIONS CONTACT",
    line("Name", t.ops_contact), line("Phone", t.ops_phone), line("Email", t.ops_email), line("After-hours phone", t.ops_afterhours),
    "",
    "ACCOUNTS PAYABLE",
    line("Name", t.ap_contact), line("Phone", t.ap_phone), line("Email", t.ap_email), line("Billing portal", t.billing_portal),
    line("Payment method", d.payment.map((k) => (k === "pay_other" && t.pay_other_detail ? `Other: ${t.pay_other_detail}` : PAYMENT[k])).join(", ")),
    "",
    "CREDIT REFERENCES",
    ...[1, 2, 3, 4].map((n) => `${n}. ${[t[`ref${n}_company`], t[`ref${n}_contact`], t[`ref${n}_phone`], t[`ref${n}_email`]].filter(Boolean).join(" | ")}`),
    "",
    "BANK REFERENCE",
    line("Bank", t.bank_name), line("Contact / officer", t.bank_contact), line("Phone", t.bank_phone),
    "",
    "QUESTIONNAIRE",
    ...Object.entries(QUESTIONS).map(([g, [q, options]]) => line(q, options[d.answers[g]])),
    "",
    "AUTHORIZED REPRESENTATIVE",
    "Agreed to the Terms and Conditions: Yes",
    line("Signature (typed)", t.sig_signature), line("Date", t.sig_date), line("Printed name", t.sig_print),
    line("Title", t.sig_title), line("Email", t.sig_email), line("Phone", t.sig_phone),
  ];
  return out.join("\r\n");
}

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Builds the Microsoft Graph sendMail payload: text summary plus the PDF attachment. */
export function buildGraphMessage({ to, data, pdf }) {
  const company = data.text.company_name;
  const fileName = `Customer Application - ${company}`.replace(/[^\w .,&()-]/g, "").slice(0, 120) + ".pdf";
  return {
    message: {
      subject: `Customer Application — ${company}`,
      body: { contentType: "Text", content: summarize(data) },
      toRecipients: [{ emailAddress: { address: to } }],
      replyTo: [{ emailAddress: { address: data.text.sig_email, name: data.text.sig_print } }],
      attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: fileName, contentType: "application/pdf", contentBytes: base64(pdf) }],
    },
    saveToSentItems: false,
  };
}
