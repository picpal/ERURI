// M1-②d 게이트(스펙 §15 ② "자동화 재지정 → 10문구 서버 상태 일치"): d01~d10 발송 뒤 기기 판정(device_traces)과 서버 최종 상태(items)를 맞춘다.
// 대조 키: 발송 문구 sha8 = 기기 trace text_sha8, trace queue_id → items.idempotency_key = NOTIFICATION:<queue_id>.
// sha 로 못 찾은 문구(Slack 이 본문 변형)는 발송 순서로 대체 매칭하고 줄 끝에 matched_by=order 를 붙인다(_phrase-match.ts).
// 판정: 기기에서 폐기(discarded:*)면 기대 상태도 폐기여야 하고, 서버에 왔으면 status 가 기대값과 같아야 한다. 출력은 id·상태 코드만
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/phrase-status.ts --since <ISO> [--user <uuid>]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { DEVICE10, expectedStatus } from "../eval/phrases.ts";
import { sha8 } from "./_phrase-sender.ts";
import { matchPhrases, type Trace } from "./_phrase-match.ts";

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const since = arg("--since"), user = arg("--user") ?? Deno.env.get("ERURI_USER_ID");
if (!since || !user) { console.error("usage: --since <ISO> [--user <uuid>] (기본 ERURI_USER_ID)"); Deno.exit(2); }
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);

type Row = { id: string; device: string; server: string; expected: string; ok: boolean; byOrder: boolean };
function judge(device: string, server: string, expected: string): boolean {
  if (device.startsWith("discarded:")) return expected.startsWith("discarded:");
  return server === expected;
}

const { data: traces, error } = await sb.from("device_traces").select("at, fields").eq("user_id", user).eq("event", "capture.intent_fired")
  .gte("at", since).order("at");
if (error) throw new Error("device_traces " + error.code);
const rows: Row[] = [];
const matches = matchPhrases(await Promise.all(DEVICE10.map((p) => sha8(p.text))), (traces ?? []) as Trace[]);
for (const [k, p] of DEVICE10.entries()) {
  const f = matches[k].trace?.fields ?? {};
  const device = typeof f.result === "string" ? f.result : "no_trace";
  let server = "-";
  if (typeof f.queue_id === "string" && f.queue_id) {
    const { data } = await sb.from("items").select("status").eq("user_id", user).eq("idempotency_key", `NOTIFICATION:${f.queue_id}`).maybeSingle();
    server = data?.status ?? "not_arrived";
  }
  const expected = expectedStatus(p, "jev");
  rows.push({ id: p.id, device, server, expected, ok: judge(device, server, expected), byOrder: matches[k].by === "order" });
}
for (const r of rows) console.log([r.id, r.device, r.server, r.expected, r.ok ? "ok" : "MISMATCH", ...(r.byOrder ? ["matched_by=order"] : [])].join("\t"));
console.log(JSON.stringify({ matched: rows.filter((r) => r.ok).length, total: rows.length }));
if (rows.some((r) => !r.ok)) Deno.exitCode = 1;
