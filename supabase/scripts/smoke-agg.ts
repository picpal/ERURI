// AGG-deploy(스펙 §15, 계획 D1): 배포된 chat·worker·0035 를 테스트 사용자 22 로 — 저장 규칙 추가 → /ingest 문자 3건(규칙 단계 → Jev 건너뜀) →
// 0.17.0 집계 → 칸 목록 → 구 앱(intents 없음) 경로 → edit_target + 단서(9의도 strict 스키마) → 규칙 빼기. 실제 gpt-6-luna(필터·추출) 호출 — 합성 문구만.
// 출력은 단계·상태·숫자·불리언만(글·키워드·규칙 값 없음). 집계 실패는 200 failed 로 숨으므로 aggregate.status·total·칸 합을 단언한다(최종 리뷰 M6).
// 끝에 이 실행의 행(항목 멱등 키 %:<run>:%, 그 항목의 잡, 규칙 r<run8>%)만 지우고 사용자 22 의 이번 달 사용 집계를 시작 값으로 되돌린다(smoke-edit.ts 와 같다)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-agg.ts
import { deleteRunJobs, RUN, service as sb, userClient } from "../tests/_testenv.ts";

const BASE = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const INTENTS = ["add_event", "mail_action", "mail_summary", "edit_event", "aggregate", "save_rule_add", "save_rule_list", "save_rule_remove"];
const RUN8 = RUN.slice("test:".length);
const KW = `r${RUN8}합성PAY`;
const { u, c } = await userClient(22);
const STARTED = new Date().toISOString();
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const atSeoul = (h: number) => new Date(`${today}T${String(h).padStart(2, "0")}:00:00+09:00`).toISOString();
let failures = 0, ruleId: string | null = null;
const check = (step: string, ok: boolean, extra: Record<string, unknown> = {}) => { if (!ok) failures++; console.log(JSON.stringify({ step, ok, ...extra })); };
const { data: month } = await sb.rpc("seoul_month");
const ledger0 = ((await sb.from("usage_ledger").select("kind, model, calls, input_tokens, cached_tokens, output_tokens, krw").eq("user_id", u.id).eq("month", month)).data ?? []) as Record<string, unknown>[];
const counter0 = (await sb.from("usage_counters").select("reserved_krw").eq("user_id", u.id).eq("month", month).maybeSingle()).data as { reserved_krw: number } | null;
// deno-lint-ignore no-explicit-any
type J = Record<string, any>;
async function call(path: string, body: unknown) {
  const { data: s } = await c.auth.getSession();
  const r = await fetch(`${BASE}/functions/v1/${path}`, { method: "POST", headers: { authorization: `Bearer ${s.session!.access_token}`, apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as J };
}
const runItems = async () => ((await sb.from("items").select("id, status, gate_label").eq("user_id", u.id).like("idempotency_key", `%:${RUN}:%`)).data ?? []) as
  { id: string; status: string; gate_label: string | null }[];
try {
  const left = (await sb.from("save_rules").select("id", { count: "exact", head: true }).eq("user_id", u.id)).count ?? 0;
  if (left !== 0) throw new Error(`test user 22 already has ${left} save_rules — remove them first`);
  // ① 규칙 추가(버튼 라우트 — 모델 없음)
  const add = await call("chat/rule", { op: "add", kind: "keyword", value: KW });
  ruleId = add.body?.rule?.id ?? null;
  check("rule_add", add.status === 200 && add.body.status === "added" && add.body.matched === 0 && ruleId !== null, { status: add.body?.status, matched: add.body?.matched });
  // ② 문자 3건(/ingest, 서울 오늘 10·14·14시) → 배포된 worker: 규칙 단계 → kept/extracted, gate_label 'rule', 청크
  const ing: number[] = [];
  for (const [n, h] of [[1, 10], [2, 14], [3, 14]] as const) {
    const r = await call("ingest", { id: `${RUN}:agg${n}`, source: "MESSAGES", sender: "합성PAY", title: null,
      text: `[${KW}] 결제 타임아웃 발생 ${n}회차 — 합성 가맹점 승인 지연`, capturedAt: atSeoul(h), deviceFilter: "rules" });
    ing.push(r.status);
  }
  const t0 = Date.now();
  let items = await runItems(), chunks = 0;
  while (Date.now() - t0 < 300_000) {
    items = await runItems();
    chunks = items.length ? (await sb.from("item_chunks").select("item_id").eq("user_id", u.id).in("item_id", items.map((i) => i.id))).data
      ?.reduce((s, r, _i, a) => s.add(r.item_id as string) && s, new Set<string>()).size ?? 0 : 0;
    console.log(JSON.stringify({ wait: Math.round((Date.now() - t0) / 1000), statuses: items.map((i) => i.status), chunked: chunks }));
    if (items.length === 3 && items.every((i) => ["kept", "extracted"].includes(i.status)) && chunks === 3) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  check("ingest_rule_saved", ing.every((s) => s === 202) && items.length === 3 && items.every((i) => ["kept", "extracted"].includes(i.status) && i.gate_label === "rule")
    && chunks === 3, { ingest: ing, statuses: items.map((i) => i.status), rule_label: items.filter((i) => i.gate_label === "rule").length, chunked: chunks });
  // ③ 0.17.0 집계(intents 여덟)
  const q = `오늘 ${KW} 타임아웃 언제 많았어?`;
  const a = await call("chat", { question: q, intents: INTENTS });
  const agg = a.body?.aggregate;
  const sum = (agg?.buckets ?? []).reduce((s: number, b: { count: number }) => s + b.count, 0);
  check("aggregate", a.status === 200 && a.body.intent === "aggregate" && agg?.status === "ok" && agg.total === 3 && sum === 3
    && agg.conditions?.bucket === "hour" && agg.top?.[0]?.key === "14", { intent: a.body?.intent, agg: agg?.status ?? null, total: agg?.total ?? null, sum,
      bucket: agg?.conditions?.bucket ?? null, buckets: agg?.buckets?.length ?? null, top: agg?.top?.map((b: { key: string; count: number }) => `${b.key}:${b.count}`) ?? null });
  // ④ 그 칸 목록(/chat/aggregate — 모델 없음)
  const l = await call("chat/aggregate", { conditions: agg?.conditions, bucket_key: "14" });
  check("bucket_list", l.status === 200 && l.body.status === "ok" && l.body.total === 2 && l.body.items?.length === 2
    && l.body.items.every((i: { item_id: string }) => items.some((x) => x.id === i.item_id)), { total: l.body?.total ?? null, items: l.body?.items?.length ?? null });
  // ⑤ 구 앱(intents 없음) — 질문 흐름, 집계 칸 없음
  const o = await call("chat", { question: q });
  check("old_app_question", o.status === 200 && o.body.intent === "question" && (o.body.aggregate ?? null) === null, { intent: o.body?.intent });
  // ⑥ edit_target(없는 제안 id → not_found 대상) + 단서 → 9의도 + 집계 칸 strict 스키마가 배포본에서 받아진다(최종 리뷰 I2)
  const e = await call("chat", { question: "그 일정 3시로 바꿔서 저장해 줘", intents: INTENTS, edit_target: crypto.randomUUID() });
  check("edit_target_cue_schema", e.status === 200 && typeof e.body.intent === "string" && !("error" in (e.body ?? {})), { http: e.status, intent: e.body?.intent ?? null,
    edit: e.body?.edit?.status ?? null });
  // ⑦ 규칙 빼기
  const rm = ruleId ? await call("chat/rule", { op: "remove", rule_id: ruleId }) : { status: 0, body: {} as J };
  check("rule_remove", rm.status === 200 && rm.body.status === "removed" && (rm.body.rules ?? []).length === 0, { status: rm.body?.status ?? null });
} finally {
  const ids = (await runItems()).map((i) => i.id);
  for (const id of ids) await sb.from("jobs").delete().eq("user_id", u.id).eq("payload->>item_id", id);   // /ingest 항목의 잡 lease 는 item:<id>(K24)
  if (ids.length) {
    await sb.from("audit_log").delete().eq("user_id", u.id).in("target", ids);
    await sb.from("items").delete().eq("user_id", u.id).in("id", ids);                                  // facts·청크 cascade
  }
  await sb.from("save_rules").delete().eq("user_id", u.id).like("value", `r${RUN8}%`);
  await deleteRunJobs();
  await sb.from("jobs").delete().eq("user_id", u.id).eq("kind", "notify").gte("created_at", STARTED);
  await sb.from("audit_log").delete().eq("user_id", u.id).in("actor", ["chat", "worker"]).gte("at", STARTED);
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
  const leftItems = (await runItems()).length;
  const leftRules = (await sb.from("save_rules").select("id", { count: "exact", head: true }).eq("user_id", u.id).like("value", `r${RUN8}%`)).count ?? 0;
  console.log(JSON.stringify({ gate: failures === 0 && leftItems === 0 && leftRules === 0 ? "pass" : "fail", failures, left_items: leftItems, left_rules: leftRules }));
  if (failures || leftItems || leftRules) Deno.exitCode = 1;
}
