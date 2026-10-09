// SUMMARY-deploy(스펙 §15, 계획 D1): 배포된 mail-read·chat. 테스트 사용자 22 — Gmail 계정이 없어 Gmail 은 불리지 않는다(칸 검사가 연결보다 먼저라 400 을 잰다).
// --phase off(MAIL_READ 없음) | on(MAIL_READ=on 뒤). 출력은 상태·코드·불리언만. ledger 는 증가분만 되돌린다(D17)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-summary.ts --phase off|on
import { service as sb, userClient } from "../tests/_testenv.ts";
import { restoreUsage, snapshotUsage } from "./_usage-snapshot.ts";

const phase = Deno.args[Deno.args.indexOf("--phase") + 1];
if (phase !== "off" && phase !== "on") { console.log(JSON.stringify({ error: "phase" })); Deno.exit(1); }
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const { u, c } = await userClient(22);
const { data: sess } = await c.auth.getSession();
const jwt = sess.session!.access_token;
const started = new Date().toISOString();
const s0 = await snapshotUsage(u.id);
const call = async (path: string, body: unknown, token: string | null = jwt) => {
  const r = await fetch(`${URL_}/functions/v1/${path}`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const t = await r.text();
  let j: Record<string, unknown> | null = null;
  try { j = t ? JSON.parse(t) : null; } catch { j = null; }
  return { status: r.status, j };
};
const Q = "합성상점에서 온 메일 요약해줘";
const chat = async (intents?: string[]) => {
  const r = await call("chat", { question: Q, ...(intents ? { intents } : {}) });
  const mr = r.j?.mail_read as { sender?: string | null } | null | undefined;
  return { status: r.status, intent: r.j?.intent ?? null, sender_ok: typeof mr?.sender === "string" && mr.sender.includes("합성상점"), mail_read_null: mr === null };
};
const F = { sender: "합성상점", subject_words: [], received_from: null, received_to: null, latest: false, translate: false, target_in_message: true };
const b64u = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
try {
  const out: Record<string, unknown> = {};
  let ok: boolean;
  const V15 = ["add_event", "mail_action", "mail_summary"], V14 = ["add_event", "mail_action"];
  if (phase === "off") {
    const a = await chat(V15);
    const s = await call("mail-read/search", F), r = await call("mail-read/read", { token: "x", request: "a" });
    Object.assign(out, { chat: a, search: [s.status, s.j?.error], read: [r.status, r.j?.error] });
    ok = a.intent === "question" && a.mail_read_null && s.status === 503 && s.j?.error === "disabled" && r.status === 503 && r.j?.error === "disabled";
  } else {
    const noAuth = await call("mail-read/search", F, null);
    const valid = await call("mail-read/search", F);
    const needs = await call("mail-read/search", {});
    const bad = await call("mail-read/search", { ...F, received_from: "2026-02-30" });
    const badTok = await call("mail-read/read", { token: "x", request: "a" });
    const claims = b64u(JSON.stringify({ u: u.id, c: "22222222-2222-4222-8222-222222222222", m: "18c2f0a1b2c3d4e5", e: Math.floor(Date.now() / 1000) + 600 }));
    const forged = await call("mail-read/read", { token: `v1.${claims}.${"A".repeat(43)}`, request: "a" });
    const a15 = await chat(V15), a14 = await chat(V14), a0 = await chat();
    Object.assign(out, { no_auth: noAuth.status, valid: [valid.status, valid.j?.error], needs: [needs.status, needs.j?.error], bad: [bad.status, bad.j?.error, bad.j?.fields],
      bad_token: [badTok.status, badTok.j?.error], forged: [forged.status, forged.j?.error], chat15: a15, chat14: a14, chat0: a0 });
    ok = noAuth.status === 401 && valid.status === 404 && valid.j?.error === "no_connection" && needs.status === 400 && needs.j?.error === "needs_target" &&
      bad.status === 400 && bad.j?.error === "bad_condition" && JSON.stringify(bad.j?.fields) === `["received_from"]` &&
      badTok.status === 400 && badTok.j?.error === "bad_token" && forged.status === 404 && forged.j?.error === "not_found" &&
      a15.intent === "mail_summary" && a15.sender_ok && a14.intent === "question" && a14.mail_read_null && a0.intent === "question";
  }
  console.log(JSON.stringify({ gate: ok ? "pass" : "fail", phase, ...out }));
} finally {
  await sb.from("audit_log").delete().eq("user_id", u.id).eq("actor", "chat").gte("at", started);
  await sb.from("llm_slots").delete().eq("user_id", u.id);
  await restoreUsage(u.id, s0);
}
