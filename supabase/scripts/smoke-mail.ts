// 배포 스모크 MAIL-deploy(계획 M10): 배포된 mail-action·gmail-connect·chat·worker. 테스트 사용자 22 전용 — Google 계정이 없어 Gmail 은 불리지 않는다
// (토큰 없음 → 409·워커가 no_connection 으로 마감). 출력은 단계 이름·상태 코드·불리언·개수만. 끝나면 이 사용자의 이번 실행 행만 지운다(AGENTS.md §7)
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { service as sb, testUser } from "../tests/_testenv.ts";

const BASE = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, ""), ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const RO = "https://www.googleapis.com/auth/gmail.readonly", MOD = "https://www.googleapis.com/auth/gmail.modify";
const FINISHED = ["done", "partial", "failed", "undone", "undo_partial", "undo_failed"];
const started = new Date().toISOString();
const u = await testUser(22);
const c = createClient(BASE, ANON, SERVER_AUTH);
const { data: si, error: se } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
if (se || !si.session) throw new Error("signin " + se?.code);
const jwt = si.session.access_token;

type R = { status: number; j: Record<string, unknown> | null };
async function call(path: string, body?: unknown, auth = true): Promise<R> {
  const r = await fetch(`${BASE}/functions/v1/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { apikey: ANON, "content-type": "application/json", ...(auth ? { authorization: `Bearer ${jwt}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j: Record<string, unknown> | null = null;
  try { j = JSON.parse(t); } catch { /* 본문 없음 */ }
  return { status: r.status, j };
}
const out: Record<string, unknown> = {};
let failed = false;
const check = (name: string, ok: boolean, got: unknown) => { out[name] = ok ? "ok" : got; if (!ok) failed = true; };
const mail = (x: Record<string, unknown> = {}) =>
  ({ action: "trash", sender: "합성상점", subject_words: [], received_from: null, received_to: null, promotions: true, unread_only: false, ...x });
async function seed(conn: string, ids: string[]): Promise<string> {
  const { data, error } = await sb.rpc("mail_action_preview", { p_user: u.id, p_connection: conn, p_action: "trash", p_ids: ids });
  if (error || !data) throw new Error("seed " + error?.code);
  return data as string;
}
async function waitFinished(id: string, ms = 120_000): Promise<R> {
  const end = Date.now() + ms;
  let r = await call(`mail-action/status?id=${id}`);
  while (Date.now() < end && !FINISHED.includes(String(r.j?.status))) {
    await new Promise((x) => setTimeout(x, 3000));
    r = await call(`mail-action/status?id=${id}`);
  }
  return r;
}

let conn: string | null = null;
try {
  check("unauthorized", (await call("mail-action/preview", mail(), false)).status === 401, "-");
  const nc = await call("mail-action/preview", mail());
  check("no_connection", nc.status === 404 && nc.j?.error === "no_connection", nc.status);
  const ins = await sb.from("connections").insert({ user_id: u.id, provider: "gmail", status: "active", scopes: [RO],
    account_ref: `smoke-mail-${crypto.randomUUID().slice(0, 8)}@example.com` }).select("id").single();
  if (ins.error) throw new Error("conn " + ins.error.code);
  conn = ins.data.id as string;
  const sm = await call("mail-action/preview", mail());
  check("scope_missing", sm.status === 403 && sm.j?.error === "scope_missing", sm.status);
  await sb.from("connections").update({ scopes: [RO, MOD] }).eq("id", conn).eq("user_id", u.id);
  const bc = await call("mail-action/preview", mail({ received_from: "2026-02-30" }));
  check("bad_condition", bc.status === 400 && JSON.stringify(bc.j) === JSON.stringify({ error: "bad_condition", fields: ["received_from"] }), bc.status);
  const nt = await call("mail-action/preview", mail({ sender: null, promotions: false }));
  check("needs_target", nt.status === 400 && nt.j?.error === "needs_target", nt.status);
  const ra = await call("mail-action/preview", mail());
  check("reauth_without_token", ra.status === 409 && ra.j?.error === "reauth_required", ra.status);

  const tok = await seed(conn, ["smoke-1", "smoke-2", "smoke-3"]);
  const e1 = await call("mail-action/execute", { token: tok });
  check("execute_202", e1.status === 202 && e1.j?.status === "pending", e1.status);
  check("execute_again_200", (await call("mail-action/execute", { token: tok })).status === 200, "-");
  const fin = await waitFinished(tok);
  check("worker_closed", fin.j?.status === "failed" && fin.j?.code === "no_connection" && fin.j?.failed === 3 && fin.j?.done === 0, fin.j?.status);
  const e3 = await call("mail-action/execute", { token: tok });
  check("execute_after_close_200", e3.status === 200 && e3.j?.status === "failed", e3.status);
  const jobs = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("kind", "mail-action").eq("payload->>id", tok);
  check("one_job", jobs.count === 1, jobs.count);

  const old = await seed(conn, ["smoke-4"]);
  await sb.from("mail_actions").update({ created_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq("id", old).eq("user_id", u.id);
  const ex = await call("mail-action/execute", { token: old });
  check("token_expired", ex.status === 410 && ex.j?.error === "token_expired", ex.status);
  check("unknown_token", (await call("mail-action/execute", { token: crypto.randomUUID() })).status === 404, "-");

  // 되돌릴 것 없는 행(failed)도 토큰 갱신이 먼저라 이 사용자(토큰 없음)는 409 reauth_required — nothing_to_undo 규칙은 호스팅 DB 'undo rules' 사례가 본다(Ruling M10-undo)
  const nu = await call("mail-action/undo", { id: tok });
  check("undo_failed_reauth_409", nu.status === 409 && nu.j?.error === "reauth_required", nu.status);
  const nst = await call(`mail-action/status?id=${tok}`);
  check("undo_failed_row_untouched", nst.j?.status === "failed" && nst.j?.undone === 0 && nst.j?.code === "no_connection", nst.j?.status);
  const dn = await seed(conn, ["smoke-5", "smoke-6", "smoke-7"]);
  await sb.from("mail_actions").update({ status: "done", cursor: 3, ok_ids: ["smoke-5", "smoke-6", "smoke-7"], method: "batch",
    executed_at: new Date().toISOString() }).eq("id", dn).eq("user_id", u.id);
  // 토큰 없는 연결의 되돌리기: 함수가 갱신을 먼저 해 보고 409 — 행은 done 그대로(한 번뿐인 되돌리기가 소진되지 않는다, D3)
  const u1 = await call("mail-action/undo", { id: dn });
  check("undo_reauth_409", u1.status === 409 && u1.j?.error === "reauth_required", u1.status);
  const ust = await call(`mail-action/status?id=${dn}`);
  check("undo_row_untouched", ust.j?.status === "done" && ust.j?.undone === 0, ust.j?.status);
  const ujobs = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("kind", "mail-action").eq("payload->>id", dn);
  check("undo_no_job", ujobs.count === 0, ujobs.count);
  // 끊긴 연결: 실행도 행을 바꾸기 전에 409
  const dead = await seed(conn, ["smoke-8"]);
  await sb.from("connections").update({ status: "reauth_required" }).eq("id", conn).eq("user_id", u.id);
  const ex409 = await call("mail-action/execute", { token: dead });
  check("execute_reauth_409", ex409.status === 409 && ex409.j?.error === "reauth_required", ex409.status);
  check("execute_row_untouched", (await call(`mail-action/status?id=${dead}`)).j?.status === "previewed", "-");
  await sb.from("connections").update({ status: "active" }).eq("id", conn).eq("user_id", u.id);
  check("status_bad_id", (await call("mail-action/status?id=x")).status === 400, "-");
  check("status_unknown", (await call(`mail-action/status?id=${crypto.randomUUID()}`)).status === 404, "-");

  const before = await sb.from("connections").select("status,scopes,expires_at").eq("id", conn).single();
  const bu = await call("gmail-connect", { code: "x", upgrade: "yes" });
  check("upgrade_bad", bu.status === 400 && bu.j?.error === "bad_upgrade", bu.status);
  const bx = await call("gmail-connect", { code: "bogus-code", upgrade: true });
  check("upgrade_bogus_502", bx.status === 502 && bx.j?.error === "token_exchange_failed", bx.status);
  const after = await sb.from("connections").select("status,scopes,expires_at").eq("id", conn).single();
  check("upgrade_left_connection", JSON.stringify(before.data) === JSON.stringify(after.data), "changed");

  const q = "합성상점에서 온 광고 메일 휴지통에 버려줘";
  const c1 = await call("chat", { question: q, intents: ["add_event", "mail_action"] });
  check("chat_mail_action", c1.status === 200 && c1.j?.intent === "mail_action" && (c1.j?.mail as { action?: string } | null)?.action === "trash", c1.j?.intent);
  const c2 = await call("chat", { question: q, intents: ["add_event"] });
  check("chat_without_mail_intent", c2.status === 200 && c2.j?.intent === "question" && c2.j?.mail === null, c2.j?.intent);
  const c3 = await call("chat", { question: q });
  check("chat_old_app", c3.status === 200 && c3.j?.intent === "question", c3.j?.intent);
} finally {
  // deno-lint-ignore no-explicit-any
  const del = async (t: string, f: (b: any) => any) => { const r = await f(sb.from(t).delete({ count: "exact" })); return r.error ? r.error.code : r.count; };
  out.cleanup = {
    audit: await del("audit_log", (b) => b.eq("user_id", u.id).in("actor", ["mail-action", "chat"]).gte("at", started)),
    jobs: await del("jobs", (b) => b.eq("user_id", u.id).eq("kind", "mail-action")),
    units: await del("gmail_units", (b) => b.eq("user_id", u.id)),
    usage: await del("usage_counters", (b) => b.eq("user_id", u.id)),
    slots: await del("llm_slots", (b) => b.eq("user_id", u.id)),
    conn_jobs: conn ? await del("jobs", (b) => b.eq("user_id", u.id).eq("payload->>connection_id", conn)) : 0,   // cron 이 이 연결에 넣은 gmail-sync·watch 잡
    conn: conn ? await del("connections", (b) => b.eq("user_id", u.id).eq("id", conn)) : 0,      // mail_actions 는 cascade
  };
}
console.log(JSON.stringify({ smoke: failed ? "fail" : "pass", ...out }));
if (failed) Deno.exit(1);
