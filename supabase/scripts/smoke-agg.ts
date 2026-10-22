// AGG-deploy(스펙 §15, 계획 D1): 배포된 chat·worker·0035 를 테스트 사용자 22 로 — 저장 규칙 추가 → /ingest 문자 3건(규칙 단계 → Jev 건너뜀) →
// 0.17.0 집계 → 칸 목록 → 구 앱(intents 없음) 경로 → edit_target + 단서(9의도 strict 스키마) → 규칙 빼기. 실제 gpt-6-luna(필터·추출) 호출 — 합성 문구만.
// 출력은 단계·상태·숫자·불리언만(글·키워드·규칙 값 없음). 집계 실패는 200 failed 로 숨으므로 aggregate.status·total·칸 합을 단언한다(최종 리뷰 M6).
// 끝에 이 실행의 행(항목 멱등 키 %:<run>:%, 그 항목의 잡, 규칙 r<run8>%)만 지우고 사용자 22 의 이번 달 사용 집계를 시작 값으로 되돌린다(smoke-edit.ts 와 같다)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-agg.ts [--metrics | --legacy-metrics]
// --metrics(METRIC-deploy, K17·K30 — 새 chat·새 worker·0036): ② 항목 item_metrics 0행(PF-F7) + ⑦ 전용 키워드 m<RUN8>합성PAY 규칙 문자 1건의 본문 기준 정확 숫자
// --legacy-metrics(0036 적용 뒤·새 chat 배포 전 — 구 chat v25): ② 14시 항목에 metric {타임아웃, 6}을 직접 넣어도 ③④가 메시지 수(0.17.0)로 답한다(K26 되돌리기 조합)
import { deleteRunJobs, RUN, service as sb, userClient } from "../tests/_testenv.ts";

const BASE = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const INTENTS = ["add_event", "mail_action", "mail_summary", "edit_event", "aggregate", "save_rule_add", "save_rule_list", "save_rule_remove"];
const RUN8 = RUN.slice("test:".length);
const KW = `r${RUN8}합성PAY`;
const MKW = `m${RUN8}합성PAY`;   // ⑦ 전용(KW 와 겹치지 않아 기여분이 그 한 건뿐 — K30)
const METRICS = Deno.args.includes("--metrics"), LEGACY = Deno.args.includes("--legacy-metrics");
if (METRICS && LEGACY) throw new Error("--metrics and --legacy-metrics are exclusive");
const { u, c } = await userClient(22);
const STARTED = new Date().toISOString();
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const atSeoul = (h: number) => new Date(`${today}T${String(h).padStart(2, "0")}:00:00+09:00`).toISOString();
let failures = 0, ruleId: string | null = null, mRuleId: string | null = null;
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
let threw = false;   // 예외로 끝나면 gate 는 fail(D1 리뷰 I1 — finally 의 판정 줄이 거짓 통과를 찍지 않게)
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
  if (METRICS) {   // PF-F7: 새 worker 에서 ② 항목도 규칙 항목 — "n회차"를 건수로 읽으면 ③④가 흔들린다. 0 이 아니면 느슨하게 하지 않고 그 숫자로 실패
    const m = (await sb.from("item_metrics").select("item_id").in("item_id", items.map((i) => i.id))).data?.length ?? -1;
    check("rule_items_no_metrics", m === 0, { metric_rows: m });
  }
  if (LEGACY) {    // 구 chat 은 total·칸 count(메시지 수)만 읽는다 — 14시 항목에 metric 6 이 있어도 ③ total 3·합 3·④ total 2
    const i14 = (await sb.from("items").select("id").eq("user_id", u.id).like("idempotency_key", `%:${RUN}:agg2`)).data?.[0]?.id as string | undefined;
    const { data: n, error } = i14 ? await sb.rpc("worker_save_metrics", { p_user: u.id, p_item: i14,
      p_metrics: [{ label: "타임아웃", count: 6, at: new Date(`${today}T14:05:00+09:00`).toISOString(), at_body: true }] }) : { data: null, error: { code: "no_item" } };
    check("legacy_seed_metric", !error && n === 1, { saved: n ?? null, error: error?.code ?? null });
  }
  // ③ 0.17.0 집계(intents 여덟)
  const q = `오늘 ${KW} 타임아웃 언제 많았어?`;
  const a = await call("chat", { question: q, intents: INTENTS });
  const agg = a.body?.aggregate;
  const sum = (agg?.buckets ?? []).reduce((s: number, b: { count: number }) => s + b.count, 0);
  check("aggregate", a.status === 200 && a.body.intent === "aggregate" && agg?.status === "ok" && agg.total === 3 && sum === 3
    && agg.conditions?.bucket === "hour" && agg.top?.[0]?.key === "14", { intent: a.body?.intent, agg: agg?.status ?? null, total: agg?.total ?? null, sum,
      bucket: agg?.conditions?.bucket ?? null, buckets: agg?.buckets?.length ?? null, top: agg?.top?.map((b: { key: string; count: number }) => `${b.key}:${b.count}`) ?? null });
  if (LEGACY) check("legacy_message_counts", agg?.body_total === undefined && typeof agg?.sentence === "string" && !agg.sentence.includes("본문 기준"),
    { has_body_total: agg?.body_total !== undefined, sentence_body: typeof agg?.sentence === "string" ? agg.sentence.includes("본문 기준") : null });
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
  if (METRICS) await metricStep();
  // ⑦ 규칙 빼기
  const rm = ruleId ? await call("chat/rule", { op: "remove", rule_id: ruleId }) : { status: 0, body: {} as J };
  check("rule_remove", rm.status === 200 && rm.body.status === "removed" && (rm.body.rules ?? []).length === 0, { status: rm.body?.status ?? null });
} catch (e) {
  threw = true;
  throw e;
} finally {
  await cleanup();
}

// ⑦(--metrics, K30): 전용 키워드 규칙 → 문자 1건(받음 서울 14:12 — 그 전이면 어제) → metrics 2행·at_body 2 → 타임아웃 집계 total 1·body_total 6·칸 [14:6] →
// 칸 목록 value 6·줄 count 6 → 오류 집계 body_total 2. 숫자가 하나라도 다르면 그 단계 이름과 숫자로 실패(오류를 타임아웃에 합친 8, 메시지 수 1 막대 등)
async function metricStep() {
  const nowSeoul = new Date(Date.now() + 9 * 3600_000).toISOString();
  const yesterday = nowSeoul.slice(11, 16) < "14:13";
  const day = yesterday ? new Date(Date.now() + 9 * 3600_000 - 86400_000).toISOString().slice(0, 10) : today;
  const word = yesterday ? "어제" : "오늘";
  const add = await call("chat/rule", { op: "add", kind: "keyword", value: MKW });
  mRuleId = add.body?.rule?.id ?? null;
  check("metric_rule_add", add.status === 200 && add.body.status === "added" && mRuleId !== null, { status: add.body?.status ?? null, yesterday });
  const ing = await call("ingest", { id: `${RUN}:met1`, source: "MESSAGES", sender: "합성PAY", title: null,
    text: `[${MKW}] 14:00~14:10 타임아웃 6건, 오류 2건`, capturedAt: new Date(`${day}T14:12:00+09:00`).toISOString(), deviceFilter: "rules" });
  const t0 = Date.now();
  let it: { id: string; status: string; gate_label: string | null } | undefined;
  while (Date.now() - t0 < 300_000) {
    it = ((await sb.from("items").select("id, status, gate_label").eq("user_id", u.id).like("idempotency_key", `%:${RUN}:met1`)).data ?? [])[0];
    console.log(JSON.stringify({ wait: Math.round((Date.now() - t0) / 1000), metric_item: it?.status ?? null }));
    if (it && ["kept", "extracted"].includes(it.status)) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  const rows = (it ? (await sb.from("item_metrics").select("at_body").eq("item_id", it.id)).data ?? [] : []) as { at_body: boolean }[];
  check("metric_saved", ing.status === 202 && !!it && ["kept", "extracted"].includes(it.status) && it.gate_label === "rule" && rows.length === 2
    && rows.filter((r) => r.at_body).length === 2, { ingest: ing.status, status: it?.status ?? null, rule: it?.gate_label === "rule", rows: rows.length,
      at_body: rows.filter((r) => r.at_body).length });
  const a = await call("chat", { question: `${word} ${MKW} 타임아웃 언제 많았어?`, intents: INTENTS });
  const agg = a.body?.aggregate;
  const nz = (agg?.buckets ?? []).filter((b: { count: number }) => b.count !== 0).map((b: { key: string; count: number }) => `${b.key}:${b.count}`);
  check("metric_aggregate", a.status === 200 && a.body.intent === "aggregate" && agg?.status === "ok" && agg.conditions?.bucket === "hour" && agg.total === 1
    && agg.body_total === 6 && nz.length === 1 && nz[0] === "14:6" && agg.top?.[0]?.key === "14" && agg.top?.[0]?.count === 6
    && typeof agg.sentence === "string" && agg.sentence.includes("1건 · 본문 기준 6건 — 14시대가 6건으로 가장 많았어요"),
    { intent: a.body?.intent ?? null, agg: agg?.status ?? null, bucket: agg?.conditions?.bucket ?? null, total: agg?.total ?? null, body_total: agg?.body_total ?? null,
      nonzero: nz, top: agg?.top?.[0] ? `${agg.top[0].key}:${agg.top[0].count}` : null,
      sentence_ok: typeof agg?.sentence === "string" && agg.sentence.includes("1건 · 본문 기준 6건 — 14시대가 6건으로 가장 많았어요") });
  const l = await call("chat/aggregate", { conditions: agg?.conditions, bucket_key: "14" });
  check("metric_bucket_list", l.status === 200 && l.body.status === "ok" && l.body.total === 1 && l.body.value === 6 && l.body.items?.length === 1
    && l.body.items[0].item_id === it?.id && l.body.items[0].count === 6, { total: l.body?.total ?? null, value: l.body?.value ?? null,
      items: l.body?.items?.length ?? null, line_count: l.body?.items?.[0]?.count ?? null });
  const e = await call("chat", { question: `${word} ${MKW} 오류 언제 많았어?`, intents: INTENTS });
  check("metric_aggregate_error", e.status === 200 && e.body.intent === "aggregate" && e.body.aggregate?.status === "ok" && e.body.aggregate.body_total === 2,
    { intent: e.body?.intent ?? null, agg: e.body?.aggregate?.status ?? null, total: e.body?.aggregate?.total ?? null, body_total: e.body?.aggregate?.body_total ?? null });
  const rm = await call("chat/rule", { op: "remove", rule_id: mRuleId });
  check("metric_rule_remove", rm.status === 200 && rm.body.status === "removed", { status: rm.body?.status ?? null });
}

async function cleanup() {
  const ids = (await runItems()).map((i) => i.id);
  for (const id of ids) await sb.from("jobs").delete().eq("user_id", u.id).eq("payload->>item_id", id);   // /ingest 항목의 잡 lease 는 item:<id>(K24)
  if (ids.length) {
    await sb.from("audit_log").delete().eq("user_id", u.id).in("target", ids);
    await sb.from("items").delete().eq("user_id", u.id).in("id", ids);                                  // facts·청크 cascade
  }
  await sb.from("save_rules").delete().eq("user_id", u.id).like("value", `r${RUN8}%`);
  await sb.from("save_rules").delete().eq("user_id", u.id).like("value", `m${RUN8}%`);
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
  const leftRules = (await sb.from("save_rules").select("id", { count: "exact", head: true }).eq("user_id", u.id).or(`value.like.r${RUN8}%,value.like.m${RUN8}%`)).count ?? 0;
  console.log(JSON.stringify({ gate: !threw && failures === 0 && leftItems === 0 && leftRules === 0 ? "pass" : "fail", threw, failures, left_items: leftItems, left_rules: leftRules,
    mode: METRICS ? "metrics" : LEGACY ? "legacy-metrics" : "plain" }));
  if (failures || leftItems || leftRules) Deno.exitCode = 1;
}
