// Public form endpoint for www.swiftlinkusa.com (GitHub Pages cannot run server code).
import template from "./customer-application.pdf";
import { parseApplication, fillPdf, buildGraphMessage } from "./application.js";
import { sendMail } from "./graph.js";
import { json, preflight, verifyHuman } from "./guard.js";

export default {
  async fetch(request, env) {
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
