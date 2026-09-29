// 스펙 §9 평가 절차 1: 검색 대상 항목의 메타(item_id, source, app_name, sender, title, occurred_at, status)만 로컬 파일로 쓴다(본문·OCR 없음).
// 대상 상태는 청크를 만드는 상태와 같다(0015: extracted, discarded:server:empty). 파일은 사용자가 질문을 쓸 때 본다. 에이전트 출력은 개수만(AGENTS.md §7)
// 사용: deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env supabase/scripts/list-items-meta.ts [--user <uuid>]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const user = arg("--user") ?? Deno.env.get("ERURI_USER_ID");
if (!user) { console.error("ERURI_USER_ID 없음"); Deno.exit(2); }
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const rows: Record<string, string | null>[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("items").select("id, source, app_name, sender, title, occurred_at, status")
    .eq("user_id", user).in("status", ["extracted", "discarded:server:empty"]).order("occurred_at", { ascending: false }).range(from, from + 999);
  if (error) throw new Error("items " + error.code);
  rows.push(...data);
  if (data.length < 1000) break;
}
const clean = (s: string | null) => (s ?? "").replace(/[\t\n\r]/g, " ");
const tsv = ["item_id\tsource\tapp_name\tsender\ttitle\toccurred_at\tstatus",
  ...rows.map((r) => [r.id, r.source, r.app_name, r.sender, r.title, r.occurred_at, r.status].map(clean).join("\t"))].join("\n");
const out = new URL("../eval/items-meta.local.tsv", import.meta.url);
await Deno.writeTextFile(out, tsv + "\n");
const by: Record<string, number> = {};
for (const r of rows) by[r.source!] = (by[r.source!] ?? 0) + 1;
console.log(JSON.stringify({ written: "supabase/eval/items-meta.local.tsv", items: rows.length, by_source: by }));
