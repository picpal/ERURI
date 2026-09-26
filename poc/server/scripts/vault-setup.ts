// cron이 워커를 부를 때 쓰는 vault 값(worker_url, service_role_key)을 등록·갱신한다. 값은 출력하지 않는다.
// supabase link 후, db push 전에 1회 실행: deno run --allow-net --allow-env --allow-read --env-file=.env scripts/vault-setup.ts
import postgres from "npm:postgres@3";
const u = new URL((await Deno.readTextFile(new URL("../supabase/.temp/pooler-url", import.meta.url))).trim());
const sql = postgres({
  host: u.hostname, port: Number(u.port || 5432), database: u.pathname.slice(1) || "postgres",
  username: decodeURIComponent(u.username), password: Deno.env.get("SUPABASE_DB_PASSWORD")!,
  ssl: "require", prepare: false, onnotice: () => {},
});
const values: Record<string, string> = {
  worker_url: Deno.env.get("SUPABASE_URL")! + "/functions/v1/worker",
  service_role_key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
};
try {
  for (const [name, v] of Object.entries(values)) {
    const [row] = await sql`select id from vault.secrets where name = ${name}`;
    if (row) await sql`select vault.update_secret(${row.id}, ${v})`;
    else await sql`select vault.create_secret(${v}, ${name})`;
  }
  console.log(JSON.stringify(await sql`select name, length(decrypted_secret) as len from vault.decrypted_secrets
    where name in ('worker_url', 'service_role_key') order by name`));
} finally {
  await sql.end();
}
