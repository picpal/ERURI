// DIGEST-deploy ①②(스펙 §15): 배포된 mail-read·chat 을 테스트 사용자 22(Gmail 없음)로. 끝에 이 실행이 바꾼 이번 달 사용 집계만 시작 값으로 되돌린다
// 출력은 단계·상태·코드·불리언·통수만(질문 글·검색 칸 값 없음). chat 은 실제 gpt-6-luna 필터 호출 — 합성 문구만.
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-digest.ts [--pre-chat]
// --pre-chat(새 mail-read·옛 chat v27): chat 응답 mail_read 에 count 칸이 없다 — 새 앱 경로(limit)의 "최근 N통"은 대상이 없어 needs_target 이 맞다
import { RUN, service as sb, userClient } from "../tests/_testenv.ts";

const BASE = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const INTENTS = ["add_event", "mail_action", "mail_summary", "edit_event", "aggregate", "save_rule_add", "save_rule_list", "save_rule_remove"];
const PRE_CHAT = Deno.args.includes("--pre-chat");
const { u, c } = await userClient(22);
const STARTED = new Date().toISOString();
let failures = 0, threw = false;
const check = (step: string, ok: boolean, extra: Record<string, unknown> = {}) => { if (!ok) failures++; console.log(JSON.stringify({ step, ok, ...extra })); };
// deno-lint-ignore no-explicit-any
type J = Record<string, any>;
async function call(path: string, body: unknown, auth = true) {
  const { data: s } = await c.auth.getSession();
  const r = await fetch(`${BASE}/functions/v1/${path}`, { method: "POST", headers: { ...(auth ? { authorization: `Bearer ${s.session!.access_token}` } : {}), apikey: ANON, "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  let j: J | null = null;
  try { j = t ? JSON.parse(t) as J : null; } catch { /* 게이트웨이 글 응답 */ }
  return { status: r.status, error: (j?.error as string | undefined) ?? null, body: j };
}
const { data: month } = await sb.rpc("seoul_month");
const ledger0 = ((await sb.from("usage_ledger").select("kind, model, calls, input_tokens, cached_tokens, output_tokens, krw").eq("user_id", u.id).eq("month", month)).data ?? []) as Record<string, unknown>[];
const counter0 = (await sb.from("usage_counters").select("reserved_krw").eq("user_id", u.id).eq("month", month).maybeSingle()).data as { reserved_krw: number } | null;
const fake = "v1." + btoa(JSON.stringify({ u: u.id, c: crypto.randomUUID(), m: "18f0a1b2c3d4e5f6", e: 4102444800 })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_") + "." + "A".repeat(43);
try {
  check("digest 401", (await call("mail-read/digest", { tokens: [fake] }, false)).status === 401);
  for (const [name, tokens] of [["0", []], ["11", Array.from({ length: 11 }, (_, i) => fake + i)], ["dup", [fake, fake]]] as const) {
    const r = await call("mail-read/digest", { tokens }); check(`digest 400 ${name}`, r.status === 400 && r.error === "bad_request", { status: r.status, error: r.error });
  }
  const nc = await call("mail-read/digest", { tokens: [fake] }); check("digest 404 no_connection", nc.status === 404 && nc.error === "no_connection", { status: nc.status, error: nc.error });
  const l11 = await call("mail-read/search", { sender: "합성상점", limit: 11 }); check("search limit 11 → 400", l11.status === 400 && l11.error === "bad_condition", { status: l11.status, error: l11.error });
  const old = await call("mail-read/search", { sender: "합성상점", count: 40 }); check("old app (no limit, count 40) → 404 no_connection", old.status === 404 && old.error === "no_connection", { status: old.status, error: old.error });
  const oldOnly = await call("mail-read/search", { count: 3 }); check("old app count only → 400 needs_target", oldOnly.status === 400 && oldOnly.error === "needs_target", { status: oldOnly.status, error: oldOnly.error });
  const neu = await call("mail-read/search", { count: 3, limit: 3 }); check("new app count only → 404 no_connection (floor met)", neu.status === 404 && neu.error === "no_connection", { status: neu.status, error: neu.error });
  const cur = await call("mail-read/search", { sender: "합성상점", cursor: "c1.a.b" }); check("cursor without limit → 400", cur.status === 400, { status: cur.status, error: cur.error });
  // 배포된 chat → 앱 검색 본문 그대로. 옛 앱(0.18)은 mail_read 를 그대로(limit 없음 — 후보 5통 고르기 계약), 새 앱은 + limit 10
  const many = await call("chat", { question: "최근 메일 3개 각각 요약", intents: INTENTS });
  const mr = many.body?.mail_read as J | null | undefined;
  check("chat mail_summary 200", many.status === 200, { status: many.status, intent: many.body?.intent ?? null, count: mr ? (mr.count ?? (("count" in mr) ? null : "absent")) : "no_mail_read" });
  if (mr) {
    // 기대는 응답 칸 모양에서: 옛 앱(limit 없음)은 count 를 무시하므로 대상 = 발신자·제목·기간·latest, 새 앱(limit)은 + count(서버 하한과 같다)
    const target = !!mr.sender || (mr.subject_words ?? []).length > 0 || !!mr.received_from || !!mr.received_to || mr.latest === true;
    const wantOld = target ? [404, "no_connection"] : [400, "needs_target"];
    const wantNew = target || typeof mr.count === "number" ? [404, "no_connection"] : [400, "needs_target"];
    if (!PRE_CHAT) check("chat 'N개 각각' → count 3", mr.count === 3, { latest: mr.latest ?? null });
    const o = await call("mail-read/search", mr);
    check(`chat 'N개 각각' → old app search (count ignored) → ${wantOld.join(" ")}`, o.status === wantOld[0] && o.error === wantOld[1], { status: o.status, error: o.error, latest: mr.latest ?? null });
    const n = await call("mail-read/search", { ...mr, limit: 10 });
    check(`chat 'N개 각각' → new app search (limit 10) → ${wantNew.join(" ")}`, n.status === wantNew[0] && n.error === wantNew[1], { status: n.status, error: n.error });
  } else check("chat 'N개 각각' mail_read present", false, { intent: many.body?.intent ?? null });
  const one = await call("chat", { question: "합성상점 메일 요약해줘", intents: INTENTS });
  const m1 = one.body?.mail_read as J | null | undefined;
  check("chat single mail_summary 200 · count " + (PRE_CHAT ? "absent" : "null"), one.status === 200 && one.body?.intent === "mail_summary" && !!m1 && (PRE_CHAT ? !("count" in m1) : m1.count === null),
    { status: one.status, intent: one.body?.intent ?? null });
  if (m1) {
    const o = await call("mail-read/search", m1);   // 0.18 앱 단일 메일 요약 경로: 검사 통과 → 연결 확인(사용자 22 는 없음)
    check("chat single → old app search → 404 no_connection", o.status === 404 && o.error === "no_connection", { status: o.status, error: o.error });
  }
} catch (e) {
  threw = true;
  console.log(JSON.stringify({ step: "threw", error: e instanceof Error ? e.name : "unknown" }));
} finally {
  // PF-21: ① 이번 실행분 사용 집계를 시작 값으로 되돌린다(smoke-agg.ts 와 같다) → ② mail_digest 행 0·reserved_krw 시작 값 정확 비교
  await sb.from("audit_log").delete().eq("user_id", u.id).in("actor", ["chat", "mail-read"]).gte("at", STARTED);
  const now1 = ((await sb.from("usage_ledger").select("kind, model").eq("user_id", u.id).eq("month", month)).data ?? []) as { kind: string; model: string }[];
  for (const r of now1) {
    const was = ledger0.find((x) => x.kind === r.kind && x.model === r.model);
    const q = sb.from("usage_ledger");
    if (!was) await q.delete().eq("user_id", u.id).eq("month", month).eq("kind", r.kind).eq("model", r.model);
    else await q.update({ calls: was.calls, input_tokens: was.input_tokens, cached_tokens: was.cached_tokens, output_tokens: was.output_tokens, krw: was.krw })
      .eq("user_id", u.id).eq("month", month).eq("kind", r.kind).eq("model", r.model);
  }
  if (counter0) await sb.from("usage_counters").update({ reserved_krw: counter0.reserved_krw }).eq("user_id", u.id).eq("month", month);
  else await sb.from("usage_counters").delete().eq("user_id", u.id).eq("month", month);
  await sb.from("llm_slots").delete().eq("user_id", u.id);
  const after = (await sb.from("usage_counters").select("reserved_krw").eq("user_id", u.id).eq("month", month).maybeSingle()).data as { reserved_krw: number } | null;
  const ledger1 = ((await sb.from("usage_ledger").select("kind, model, calls, input_tokens, cached_tokens, output_tokens, krw").eq("user_id", u.id).eq("month", month)).data ?? []) as Record<string, unknown>[];
  const key = (r: Record<string, unknown>) => JSON.stringify([r.kind, r.model, r.calls, r.input_tokens, r.cached_tokens, r.output_tokens, Number(r.krw)]);
  const same = ledger1.map(key).sort().join("\n") === ledger0.map(key).sort().join("\n");
  const digestRows = ledger1.filter((r) => r.kind === "mail_digest").length;
  check("left rows 0 (mail_digest ledger 0, ledger and reserved_krw back to start)", digestRows === 0 && same && (after === null) === (counter0 === null) && Number(after?.reserved_krw ?? 0) === Number(counter0?.reserved_krw ?? 0),
    { run: RUN, mail_digest_rows: digestRows, ledger_restored: same });
  console.log(JSON.stringify({ gate: !threw && failures === 0 ? "pass" : "fail", threw, failures, mode: PRE_CHAT ? "pre-chat" : "full" }));
  if (threw || failures) Deno.exitCode = 1;
}
