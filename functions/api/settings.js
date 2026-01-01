export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;

  if (request.method === "GET") {
    const { results } = await db.prepare("SELECT * FROM settings").all();
    return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
  }

  if (request.method === "POST") {
    const { id, value } = await request.json();
    await db.prepare("INSERT OR REPLACE INTO settings (id, value) VALUES (?, ?)").bind(id, value).run();
    return new Response(JSON.stringify({ success: true }));
  }

  return new Response("Method not allowed", { status: 405 });
}
