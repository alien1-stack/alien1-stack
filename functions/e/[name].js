// Anonymous event counter for Día Uno. Stores only (day, event name, count). No IP, no cookies, no personal data.
const OK = /^(view|visitor|copy|copyu|copyall|prompt|wa|pro|prou|src)_[a-z0-9]{1,16}$|^(visitor|prou)$/;
const SQL_UP = "INSERT INTO ev(day,name,n) VALUES(?1,?2,1) ON CONFLICT(day,name) DO UPDATE SET n=n+1";
export async function onRequestPost({ params, env }) {
  const name = String(params.name || "");
  const res = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (!OK.test(name) || !env.DB) return res;
  const day = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10); // Mexico City day
  try {
    await env.DB.prepare(SQL_UP).bind(day, name).run();
  } catch (e) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS ev(day TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,name))").run();
    await env.DB.prepare(SQL_UP).bind(day, name).run();
  }
  return res;
}
export async function onRequestGet() { return new Response(null, { status: 204 }); }
