import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { parseApplication, fillPdf, buildGraphMessage, REQUIRED_TEXT, TEXT_FIELDS } from "../src/application.js";

const template = readFileSync(new URL("../src/customer-application.pdf", import.meta.url));

function sample(overrides = {}) {
  const form = new FormData();
  const values = Object.fromEntries(TEXT_FIELDS.map((n) => [n, n.includes("email") ? "test@example.com" : `Test ${n}`]));
  Object.assign(values, { company_name: "Acme Freight Café, LLC", svc_ftl: "on", svc_hazmat: "on", load_value: "val_100", pay_ach: "on", q_edi: "q_edi_no", q_invoice: "q_invoice_email", terms_agree: "on" }, overrides);
  for (const [k, v] of Object.entries(values)) if (v !== null) form.set(k, v);
  return form;
}

test("accepts a complete application and dates it", () => {
  const { data, errors } = parseApplication(sample(), new Date("2026-10-16T15:00:00Z"));
  assert.equal(errors, undefined);
  assert.equal(data.text.sig_date, "10/16/2026");
  assert.deepEqual(data.services, ["svc_ftl", "svc_hazmat"]);
});

test("rejects missing required fields, terms, services and bad emails", () => {
  const { errors } = parseApplication(sample({ company_name: "", terms_agree: null, svc_ftl: null, svc_hazmat: null, ap_email: "nope", load_value: "val_999" }));
  assert.ok(errors.includes("company_name is required"));
  assert.ok(errors.includes("You must agree to the Terms and Conditions"));
  assert.ok(errors.includes("Select at least one service"));
  assert.ok(errors.includes("ap_email is not a valid email"));
  assert.ok(errors.includes("Select an estimated maximum load value"));
  assert.ok(REQUIRED_TEXT.every((n) => TEXT_FIELDS.includes(n)));
});

test("fills and flattens the PDF, tolerating characters the PDF font lacks", async () => {
  const { data } = parseApplication(sample({ company_dba: "Émoji 🚚 中文 DBA" }));
  const pdf = await fillPdf(template, data);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getForm().getFields().length, 0);
  assert.equal(doc.getPageCount(), 3);
  mkdirSync(new URL("./output/", import.meta.url), { recursive: true });
  writeFileSync(new URL("./output/filled.pdf", import.meta.url), pdf);
});

test("builds the Graph message with the PDF attached and replies going to the signer", async () => {
  const { data } = parseApplication(sample({ company_name: "Acme / Freight\r\nCo" }));
  const pdf = await fillPdf(template, data);
  const { message } = buildGraphMessage({ to: "info@swiftlinkusa.com", data, pdf });
  assert.equal(message.subject, "Customer Application — Acme / Freight Co");
  assert.equal(message.replyTo[0].emailAddress.address, "test@example.com");
  assert.equal(message.attachments[0].name, "Customer Application - Acme  Freight Co.pdf");
  assert.equal(Buffer.from(message.attachments[0].contentBytes, "base64").subarray(0, 5).toString(), "%PDF-");
  assert.match(message.body.content, /Federal Tax ID \/ EIN: Test federal_tax_id/);
});

test("credit references are optional", () => {
  const blanks = Object.fromEntries([1, 2, 3, 4].flatMap((n) => ["company", "contact", "phone", "email"].map((k) => [`ref${n}_${k}`, ""])));
  const { errors, data } = parseApplication(sample(blanks));
  assert.equal(errors, undefined);
  assert.equal(data.text.ref1_company, "");
});
