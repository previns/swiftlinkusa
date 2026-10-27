// Public endpoints for www.swiftlinkusa.com (GitHub Pages cannot run server code):
//   POST /customer-application           customer credit application → PDF emailed to SwiftLink
//   GET|POST /rate-confirmations/<token>  customer rate confirmation page data, confirm, signed PDF
//   /internal/ratecons/*                  employee portal only (shared key; see ratecon.js)
import template from "./customer-application.pdf";
import logo from "./logo-white.png";
import { parseApplication, fillPdf, buildGraphMessage } from "./application.js";
import { internalRoute, publicRoute } from "./ratecon.js";
import { sendMail } from "./graph.js";
import { json, preflight, verifyHuman } from "./guard.js";

const deps = { logo, sendMail, verifyHuman, now: () => Date.now() };

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/internal/ratecons")) return internalRoute(request, env, deps);
    if (path.startsWith("/rate-confirmations/")) {
      const { response, allowed } = await preflight(request, env, { path: null, methods: ["GET", "POST"] });
      return response || publicRoute(request, env, deps, allowed);
    }

    const { response, allowed } = await preflight(request, env);
    if (response) return response;

    let form;
    try { form = await request.formData(); } catch { return json({ error: "Invalid submission" }, 400, allowed); }
    // Honeypot: hidden from people, filled by bots. Pretend success so bots don't adapt.
    if (String(form.get("website") ?? "")) return json({ ok: true }, 200, allowed);

    const notHuman = await verifyHuman(form, request, env, allowed);
    if (notHuman) return notHuman;

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
