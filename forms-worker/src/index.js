// Public form endpoint for www.swiftlinkusa.com (GitHub Pages cannot run server code).
import template from "./customer-application.pdf";
import { parseApplication, fillPdf, buildGraphMessage } from "./application.js";
import { sendMail } from "./graph.js";

const ALLOWED_ORIGINS = ["https://www.swiftlinkusa.com", "https://swiftlinkusa.com", "http://localhost:4321"];
const MAX_BODY = 64 * 1024;

function json(body, status, origin) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (origin) Object.assign(headers, { "Access-Control-Allow-Origin": origin, Vary: "Origin" });
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : null;
    if (url.pathname !== "/customer-application") return json({ error: "Not found" }, 404, allowed);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: allowed ? { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {} });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, allowed);
    if (!allowed) return json({ error: "Forbidden" }, 403, null);
    if (Number(request.headers.get("Content-Length") || MAX_BODY + 1) > MAX_BODY) return json({ error: "Submission too large" }, 413, allowed);

    let form;
    try { form = await request.formData(); } catch { return json({ error: "Invalid submission" }, 400, allowed); }
    // Honeypot: hidden from people, filled by bots. Pretend success so bots don't adapt.
    if (String(form.get("website") ?? "")) return json({ ok: true }, 200, allowed);

    const { data, errors } = parseApplication(form);
    if (errors) return json({ error: "Please complete the required fields.", details: errors }, 422, allowed);

    try {
      const pdf = await fillPdf(template, data);
      await sendMail(env, buildGraphMessage({ to: env.TO_ADDRESS, data, pdf }));
    } catch (error) {
      console.error("Customer application failed", error);
      return json({ error: "We could not send your application. Please try again or email info@swiftlinkusa.com." }, 500, allowed);
    }
    return json({ ok: true }, 200, allowed);
  },
};
