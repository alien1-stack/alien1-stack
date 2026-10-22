// Private aggregate counters (needs key). Returns totals and per-day counts.
const H = "dae513d2615fc5f19f6aa76209a52cf3dafdb0e60124ba330df0e3c43ae20d28";
async function sha(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
export async function onRequestGet({ request, env }) {
  const k = new URL(request.url).searchParams.get("k") || "";
  if (await sha(k) !== H) return new Response("not found", { status: 404 });
  let rows = [];
  try { rows = (await env.DB.prepare("SELECT day,name,n FROM ev ORDER BY day,name").all()).results || []; } catch (e) {}
  const total = {}, byDay = {};
  for (const r of rows) { total[r.name] = (total[r.name] || 0) + r.n; (byDay[r.day] = byDay[r.day] || {})[r.name] = r.n; }
  return new Response(JSON.stringify({ total, byDay }, null, 1), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
