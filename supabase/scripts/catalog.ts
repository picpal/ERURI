// 스키마 카탈로그를 정규화해 출력한다(M1-①b squash 대조). 행 값은 읽지 않는다 — 이름·시그니처·정책·인덱스·cron·버킷·권한만.
// 사용: deno run --allow-net --allow-env --allow-read --env-file=<env> supabase/scripts/catalog.ts [--pooler <pooler-url 파일>] > out.txt
//   PoC: --env-file=poc/server/.env --pooler poc/server/supabase/.temp/pooler-url, 제품: --env-file=supabase/.env (기본 pooler = supabase/.temp)
import postgres from "npm:postgres@3";

const i = Deno.args.indexOf("--pooler");
const poolerFile = i >= 0 ? Deno.args[i + 1] : new URL("../.temp/pooler-url", import.meta.url);
const u = new URL((await Deno.readTextFile(poolerFile)).trim());
const sql = postgres({ host: u.hostname, port: Number(u.port || 5432), database: u.pathname.slice(1) || "postgres",
  username: decodeURIComponent(u.username), password: Deno.env.get("SUPABASE_DB_PASSWORD")!, ssl: "require", prepare: false, onnotice: () => {} });
try {
  const out: string[] = [];
  for (const r of await sql`select table_name t, column_name c, data_type d, is_nullable n, column_default df from information_schema.columns
                            where table_schema = 'public' order by 1, ordinal_position`) out.push(`column ${r.t}.${r.c} ${r.d} null=${r.n} default=${r.df ?? "-"}`);
  for (const r of await sql`select p.proname n, pg_get_function_identity_arguments(p.oid) a, pg_get_function_result(p.oid) res, p.prosecdef s,
                                   has_function_privilege('anon', p.oid, 'execute') an, has_function_privilege('authenticated', p.oid, 'execute') au
                            from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' order by 1, 2`)
    out.push(`function ${r.n}(${r.a}) -> ${r.res} secdef=${r.s} anon=${r.an} authenticated=${r.au}`);
  for (const r of await sql`select tablename t, policyname p, cmd, roles::text ro, qual, with_check wc from pg_policies where schemaname = 'public' order by 1, 2`)
    out.push(`policy ${r.t}.${r.p} ${r.cmd} ${r.ro} using=${r.qual ?? "-"} check=${r.wc ?? "-"}`);
  for (const r of await sql`select indexdef from pg_indexes where schemaname = 'public' order by indexname`) out.push(`index ${r.indexdef}`);
  for (const r of await sql`select tgname, tgrelid::regclass::text rel from pg_trigger where not tgisinternal and tgrelid::regclass::text not like '%.%' order by 1`)
    out.push(`trigger ${r.rel}.${r.tgname}`);
  for (const r of await sql`select jobname, schedule from cron.job order by 1`) out.push(`cron ${r.jobname} ${r.schedule}`);
  for (const r of await sql`select id, public, file_size_limit l, allowed_mime_types::text m from storage.buckets order by 1`)
    out.push(`bucket ${r.id} public=${r.public} limit=${r.l} mime=${r.m}`);
  console.log(out.join("\n"));
} finally {
  await sql.end();
}
