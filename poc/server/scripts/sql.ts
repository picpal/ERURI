// 호스팅 DB에 SQL 한 문장을 실행한다(psql 대체). 연결 정보는 supabase link의 pooler-url + .env의 DB 비밀번호.
// 개인정보 규칙(AGENTS.md §7): content_enc·ocr_text_enc를 조회하지 않는다. id·상태·오류 코드만 본다.
// 사용: deno run --allow-net --allow-env --allow-read --env-file=.env scripts/sql.ts "select ..." [param...]
import postgres from "npm:postgres@3";
const base = (await Deno.readTextFile(new URL("../supabase/.temp/pooler-url", import.meta.url))).trim();
const url = new URL(base);
const sql = postgres({
  host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1) || "postgres",
  username: decodeURIComponent(url.username), password: Deno.env.get("SUPABASE_DB_PASSWORD")!,
  ssl: "require", prepare: false, onnotice: () => {},
});
try {
  const [query, ...params] = Deno.args;
  const rows = await sql.unsafe(query, params);
  console.log(JSON.stringify(rows, null, 0));
} finally {
  await sql.end();
}
