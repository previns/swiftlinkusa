// Sends mail through SwiftLink's Microsoft 365 using an Entra app registration (client credentials).
let cached = null;

async function token(env) {
  if (cached && cached.expires > Date.now() + 60_000) return cached.value;
  const res = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Token request failed: ${body.error} ${body.error_description ?? ""}`);
  cached = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return cached.value;
}

export async function sendMail(env, payload) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.SENDER_ADDRESS)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`sendMail failed: ${res.status} ${await res.text()}`);
}
