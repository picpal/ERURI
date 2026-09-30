// M1-③ 게이트(스펙 §15 ③, PoC-6 흡수): Gmail 연결 상태·웹훅→sync 지연·재연결 공백 누락을 id·수치로만 본다. 본문·제목·주소는 출력하지 않는다.
// gap 은 Gmail 메시지를 메모리에서 서버 규칙으로만 다시 판정한다(출력·저장 없음, AGENTS.md §7)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts <status|latency|gap> [옵션] [--user <uuid>]
//   status                              연결 상태·만료·watch 만료·마지막 성공·백필 대기 잡 수·GMAIL 항목 상태별 수·토큰 카운터
//   latency --since <ISO>               웹훅이 넣은 gmail-sync 잡의 적재→첫 클레임 지연(초), 그때 백필 대기 여부, 백필 중 평균
//   gap --after <ISO> --before <ISO>    그 구간 Gmail 메시지 id(-category:promotions)를 items 와 대조: 저장·규칙 폐기(otp/promotion)·누락
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { gmailApi, gmailToItem, refreshAccessToken } from "../functions/_shared/gmail.ts";

const cmd = Deno.args[0];
const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const user = arg("--user") ?? Deno.env.get("ERURI_USER_ID");
if (!user) { console.error("ERURI_USER_ID 없음"); Deno.exit(2); }
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const { data: conns } = await sb.from("connections").select("id, status, expires_at, created_at").eq("user_id", user).eq("provider", "gmail");
const conn = conns?.[0];
if (!conn) { console.log(JSON.stringify({ error: "no_connection" })); Deno.exit(1); }

if (cmd === "status") {
  const { data: st } = await sb.from("sync_states").select("last_success_at, watch_expires_at").eq("connection_id", conn.id).eq("user_id", user).single();
  const { count: backlog } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user).eq("priority", 40).in("status", ["queued", "running"]);
  const { data: items } = await sb.from("items").select("status").eq("user_id", user).eq("source", "GMAIL");
  const byStatus: Record<string, number> = {};
  for (const r of items ?? []) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const { data: usage } = await sb.from("usage_counters").select("month, extract_tokens, backfill_tokens").eq("user_id", user);
  const { data: pushes } = await sb.from("reauth_pushes").select("reason, sent_at").eq("user_id", user).order("sent_at");
  console.log(JSON.stringify({ connection: { status: conn.status, created_at: conn.created_at, expires_at: conn.expires_at }, sync: st,
    backfill_backlog: backlog, gmail_items: byStatus, usage, reauth_pushes: pushes }, null, 1));
} else if (cmd === "latency") {
  const since = arg("--since");
  if (!since) { console.error("--since <ISO>"); Deno.exit(2); }
  const { data: syncs } = await sb.from("jobs").select("id, created_at, claimed_at, status").eq("user_id", user).eq("kind", "gmail-sync")
    .eq("payload->>via", "webhook").gte("created_at", since).order("created_at");
  const rows: { latency: number | null; pending: number }[] = [];
  for (const s of syncs ?? []) {
    const { count } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user).eq("priority", 40)
      .lte("created_at", s.created_at).or(`claimed_at.is.null,claimed_at.gt.${s.created_at}`);
    const latency = s.claimed_at ? (Date.parse(s.claimed_at) - Date.parse(s.created_at)) / 1000 : null;
    rows.push({ latency, pending: count ?? 0 });
    console.log([s.id, s.created_at, latency ?? "-", `backfill_pending=${count ?? 0}`, s.status].join("\t"));
  }
  const during = rows.filter((r) => r.pending > 0 && r.latency !== null);
  const avg = during.length ? during.reduce((a, r) => a + r.latency!, 0) / during.length : null;
  console.log(JSON.stringify({ webhook_syncs: rows.length, during_backfill: during.length, avg_latency_s_during_backfill: avg }));
} else if (cmd === "gap") {
  const after = Math.floor(Date.parse(arg("--after") ?? "") / 1000), before = Math.floor(Date.parse(arg("--before") ?? "") / 1000);
  if (!Number.isFinite(after) || !Number.isFinite(before)) { console.error("--after <ISO> --before <ISO>"); Deno.exit(2); }
  const { data: rt, error } = await sb.rpc("gmail_get_refresh_token", { p_user: user, p_connection: conn.id });
  if (error || !rt) { console.log(JSON.stringify({ error: "no_refresh_token" })); Deno.exit(1); }
  const api = gmailApi(await refreshAccessToken(rt as string));
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const p = await api.listMessageIds(`after:${after} before:${before} -category:promotions`, page);
    ids.push(...(p.messages ?? []).map((m) => m.id));
    page = p.nextPageToken;
  } while (page);
  const have = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await sb.from("items").select("idempotency_key").eq("user_id", user).in("idempotency_key", ids.slice(i, i + 100).map((x) => "gmail:" + x));
    for (const r of data ?? []) have.add(r.idempotency_key.slice("gmail:".length));
  }
  const ruled: Record<string, number> = {};
  const missing: string[] = [];
  for (const id of ids.filter((x) => !have.has(x))) {
    const v = gmailToItem(await api.getMessage(id));
    if (v.kind === "discard") ruled[v.reason] = (ruled[v.reason] ?? 0) + 1;
    else missing.push(id);
  }
  console.log(JSON.stringify({ listed: ids.length, stored: have.size, discarded_by_rule: ruled, missing }));
  if (missing.length) Deno.exitCode = 1;
} else {
  console.error("usage: gmail-gate.ts <status|latency|gap>"); Deno.exit(2);
}
