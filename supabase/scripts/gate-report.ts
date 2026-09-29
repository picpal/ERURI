// M1-④ 게이트(스펙 §7·§16 Jev 실데이터 재측정): 라벨·confidence 와 사용자 표시(오폐기 = 복구, 오통과 = 보관함 표시)만 집계한다. 본문·제목 없음.
// 기준(§16): 게이트 정확도 ≥ 90%, t=0.8 actionable 유실 ≤ 1%. 오통과 표시는 보관함(M2-⑨b) 이후에 채워진다
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gate-report.ts [--since <ISO>] [--user <uuid>]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const user = arg("--user") ?? Deno.env.get("ERURI_USER_ID");
const since = arg("--since") ?? "1970-01-01T00:00:00Z";
if (!user) { console.error("ERURI_USER_ID 없음"); Deno.exit(2); }
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);

type Row = { id: string; gate_label: string; gate_confidence: number; source: string; status: string };
const rows: Row[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("items").select("id, gate_label, gate_confidence, source, status").eq("user_id", user)
    .not("gate_label", "is", null).gte("captured_at", since).order("captured_at").range(from, from + 999);
  if (error) throw new Error("items " + error.code);
  rows.push(...(data as Row[]));
  if (!data || data.length < 1000) break;
}
const { data: fb, error: fbError } = await sb.from("gate_feedback").select("item_id, verdict").eq("user_id", user);
if (fbError) throw new Error("gate_feedback " + fbError.code);   // 삼키면 오폐기·오통과 0 → 거짓 통과
const verdict = new Map(fb.map((f) => [f.item_id, f.verdict]));
// 실제 게이트 폐기 = 상태가 discarded:server:<gate_label>(격리 중·정리 뒤) 또는 복구된 항목(wrong_discard). 로컬 임계값으로 재계산하지 않는다
const discarded = rows.filter((r) => r.status === `discarded:server:${r.gate_label}` || verdict.get(r.id) === "wrong_discard");
const passed = rows.filter((r) => !discarded.includes(r));
const wrongDiscard = discarded.filter((r) => verdict.get(r.id) === "wrong_discard").length;
const wrongPass = passed.filter((r) => verdict.get(r.id) === "wrong_pass").length;
const byLabel: Record<string, number> = {};
for (const r of rows) byLabel[r.gate_label] = (byLabel[r.gate_label] ?? 0) + 1;
const bySource: Record<string, number> = {};
for (const r of rows) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
const actionableTrue = passed.length - wrongPass + wrongDiscard;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
console.log(JSON.stringify({
  labeled: rows.length, by_label: byLabel, by_source: bySource,
  gate_discarded: discarded.length, gate_passed: passed.length, wrong_discard: wrongDiscard, wrong_pass: wrongPass,
  accuracy: rows.length ? r3((rows.length - wrongDiscard - wrongPass) / rows.length) : null,
  actionable_loss_rate: actionableTrue ? r3(wrongDiscard / actionableTrue) : null,
}, null, 1));
