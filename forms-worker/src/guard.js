// Request checks for the public form endpoint, kept apart from index.js so they can be tested in Node.

export const ALLOWED_ORIGINS = ["https://www.swiftlinkusa.com", "https://swiftlinkusa.com", "http://localhost:4321"];
// Turnstile reports the hostname the widget was solved on; only our own pages count.
const TURNSTILE_HOSTS = ["www.swiftlinkusa.com", "swiftlinkusa.com", "localhost"];
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
export const MAX_BODY = 64 * 1024;

export function json(body, status, origin) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (origin) Object.assign(headers, { "Access-Control-Allow-Origin": origin, Vary: "Origin" });
  return new Response(JSON.stringify(body), { status, headers });
}

/** Checks that need no body. Returns { response } to stop, or { allowed } (the CORS origin) to continue. */
export async function preflight(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : null;
  if (url.pathname !== "/customer-application") return { response: json({ error: "Not found" }, 404, allowed) };
  if (url.protocol !== "https:" && !LOCAL_HOSTS.includes(url.hostname)) return { response: json({ error: "HTTPS required" }, 403, null) };
  if (request.method === "OPTIONS") {
    return { response: new Response(null, { status: 204, headers: allowed ? { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {} }) };
  }
  if (request.method !== "POST") return { response: json({ error: "Method not allowed" }, 405, allowed) };
  if (!allowed) return { response: json({ error: "Forbidden" }, 403, null) };
  if (Number(request.headers.get("Content-Length") || MAX_BODY + 1) > MAX_BODY) return { response: json({ error: "Submission too large" }, 413, allowed) };
  // Origin can be faked by scripts, so also cap submissions per IP (Workers rate limiting binding).
  if (env.SUBMIT_LIMIT) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.SUBMIT_LIMIT.limit({ key: ip });
    if (!success) return { response: json({ error: "Too many submissions. Please wait a minute and try again." }, 429, allowed) };
  }
  return { allowed };
}

/** Cloudflare Turnstile check, enforced once the TURNSTILE_SECRET secret is set. Returns an error Response or null. */
export async function verifyHuman(form, request, env, allowed, fetchImpl = fetch) {
  if (!env.TURNSTILE_SECRET) return null;
  const token = String(form.get("cf-turnstile-response") ?? "");
  const fail = json({ error: "Please complete the security check and try again." }, 403, allowed);
  if (!token) return fail;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const result = await res.json();
    return result.success && TURNSTILE_HOSTS.includes(result.hostname) ? null : fail;
  } catch {
    return json({ error: "We could not verify your submission. Please try again." }, 503, allowed);
  }
}
