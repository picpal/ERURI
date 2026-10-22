import { assert, assertEquals } from "jsr:@std/assert";
import OpenAI from "npm:openai@7";
import type { BudgetDeps } from "../functions/_shared/budget.ts";
import type { SaveRule } from "../functions/_shared/save-rules.ts";
import { AGG_TEXT, type AggConditions, type AggRaw, type BucketCount } from "../functions/chat/aggregate.ts";
import { type AggItem, type ChatDeps, handleChat } from "../functions/chat/handler.ts";
import type { Candidate } from "../functions/chat/save-rule.ts";

// chat handler 0.17.0 라우팅(스펙 §9 "채팅 저장 규칙·집계 질문") — 가짜 deps, 오늘 2026-10-21. 값은 합성 문구만
const TODAY = "2026-10-21";
const OLD = ["add_event", "mail_action", "mail_summary", "edit_event"];
const AGG = [...OLD, "aggregate", "save_rule_add", "save_rule_list", "save_rule_remove"];
const rule = (id: string, kind: "keyword" | "sender", value: string): SaveRule => ({ id, kind, value, created_at: "2026-10-20T00:00:00Z" });
const R1 = rule("r-1", "keyword", "합성PAY");
const cand = (item_id: string, o: Partial<Candidate> = {}): Candidate =>
  ({ item_id, source: "MESSAGES", app_name: null, sender: "합성발신", title: null, text: "", ...o });
const raw = (o: AggRaw = {}): AggRaw => ({ keywords: ["합성PAY"], sender: null, sources: [], from: null, to: null, bucket: null, ...o });
const CTX: AggConditions = { keywords: ["합성PAY"], sender: null, sources: [], from: "2026-10-15", to: "2026-10-21", bucket: "hour", defaulted: true, clamped: false };

type Opts = { intent?: string; aggregate?: AggRaw | null; saveRule?: { kind: unknown; value: unknown } | null; sources?: string[];
  rpc?: { total: number; buckets?: BucketCount[]; items?: AggItem[] } | Error; rules?: SaveRule[] | Error; cands?: Candidate[] };
function adeps(o: Opts = {}) {
  const seen = { agg: [] as unknown[], withIntent: [] as boolean[], aggregate: [] as { c: AggConditions; key: string | null }[], saveRules: 0, cands: 0,
    search: 0, answer: 0, audit: 0, remove: [] as string[], add: [] as string[][], lines: [] as string[][] };
  const budget: BudgetDeps = { reserve: async () => ({ level: "ok", month: "2026-10-01" }),
    settle: async (_u, _k, _e, _m, lines) => { seen.lines.push(lines.map((l) => l.kind)); },
    acquire: async () => 1, release: async () => {}, now: () => new Date("2026-10-21T00:00:00Z") };
  const d: ChatDeps = {
    authUser: async (t) => (t === "good" ? "user-1" : null),
    filters: async (_q, _t, _c, withIntent, bill, _edit, agg) => {
      seen.agg.push(agg === undefined ? "undefined" : agg);
      seen.withIntent.push(withIntent === true);
      bill?.("chat", "gpt-6-luna", { input: 900, cached: 0, output: 80 });
      const f = { filters: { date_from: null, date_to: null, event_from: null, event_to: null, sources: o.sources ?? [], kinds: [], merchant: null } };
      if (!withIntent) return f;
      const intent = (o.intent ?? "question") as never;
      return { ...f, intent, mail: null, mail_read: null, ...(agg ? { aggregate: o.aggregate ?? null, save_rule: o.saveRule ?? null } : {}) };
    },
    facts: async () => [],
    search: async () => { seen.search++; return { docs: [{ item_id: "i1", occurred_at: "2026-10-20T01:00:00Z", text: "합성 문서" }], candidates: ["i1"] }; },
    answer: async () => { seen.answer++; return { answer: "합성 답", source_item_ids: ["i1"], refused: false, model: "gpt-6-sol" }; },
    meta: async () => [], proposals: async () => [], audit: async () => { seen.audit++; }, itemDetail: async () => null,
    budget, today: () => TODAY, sleep: async () => {}, mailActions: () => true, mailRead: () => true,
    editTarget: async () => ({ status: "not_found" }),
    editApply: async () => { throw new Error("editApply is not expected in chat-agg-handler.test.ts"); },
    saveRules: async () => {
      seen.saveRules++;
      if (o.rules instanceof Error) throw o.rules;
      return o.rules ?? [];
    },
    ruleAdd: async (_u, kind, value) => { seen.add.push([kind, value]); return { status: "added", rule_id: "r-new" }; },
    ruleRemove: async (_u, id) => { seen.remove.push(id); return "removed"; },
    ruleCandidates: async () => { seen.cands++; return o.cands ?? []; },
    ruleRestore: async (_u, ids) => ids.length,
    aggregate: async (_u, c, key) => {
      seen.aggregate.push({ c, key });
      if (o.rpc instanceof Error) throw o.rpc;
      return o.rpc ?? { total: 0, buckets: [] };
    },
  };
  return { d, seen };
}
const req = (path: string, body: unknown, token: string | null = "good") => new Request(`http://x/${path}`, { method: "POST",
  body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
async function call(d: ChatDeps, body: unknown, path = "chat") {
  const lines: string[] = [], orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const res = await handleChat(req(path, body), d);
    return { status: res.status, j: res.status === 401 ? null : await res.json(), lines };
  } finally { console.log = orig; }
}

Deno.test("intents without the new four: filters called with agg null (0.16.x request), aggregate/save_rule null in response", async () => {
  for (const body of [{ question: "합성PAY 언제 왔어", intents: OLD }, { question: "합성PAY 언제 왔어" }]) {
    const { d, seen } = adeps({ intent: "question" });
    const { status, j } = await call(d, body);
    assertEquals([status, seen.agg, j.intent, j.aggregate, j.save_rule], [200, [null], "question", null, null]);
    assert("aggregate" in j && "save_rule" in j);                                   // K12 — 늘 싣는다
  }
});

Deno.test("intents with aggregate: filters called with { previous: null } on a cue; aggregate_context read only when intents has aggregate; bad shape → 400 bad_context", async () => {
  for (const [intents, question] of [[AGG, "합성PAY 몇 건"], [["save_rule_add"], "앞으로 합성PAY 문자는 저장해"]] as const) {
    const { d, seen } = adeps({ intent: "question" });
    await call(d, { question, intents });
    assertEquals(seen.agg, [{ previous: null }], intents.join(","));
  }
  // 단서 게이트(Ruling A10-cue): 새 의도가 있어도 단서·aggregate_context 가 없으면 0.16.x 요청(agg null)
  for (const question of ["합성 질문", "요약해줘", "합성 회의 메모 등록해줘"]) {
    const { d, seen } = adeps({ intent: "question" });
    await call(d, { question, intents: AGG });
    assertEquals(seen.agg, [null], question);
  }
  const { d, seen } = adeps({ intent: "question" });
  await call(d, { question: "날짜별로는?", intents: AGG, aggregate_context: CTX });
  assertEquals(seen.agg, [{ previous: CTX }]);

  const { sender: _s, ...noSender } = CTX;
  for (const bad of ["x", [], { ...CTX, keywords: "합성PAY" }, noSender, { ...CTX, defaulted: "yes" }, { ...CTX, to: "2026-10-25" }, { ...CTX, keywords: [] },
    { ...CTX, from: "2026-02-30" }]) {
    const b = adeps({ intent: "aggregate" });
    const r = await call(b.d, { question: "날짜별로는?", intents: AGG, aggregate_context: bad });
    assertEquals([r.status, r.j, b.seen.agg.length], [400, { error: "bad_context" }, 0], JSON.stringify(bad));
  }
});

Deno.test("aggregate_context is ignored (even malformed, no 400) when intents lacks aggregate", async () => {
  for (const [intents, agg] of [[["save_rule_add", "add_event"], { previous: null }], [OLD, null]] as const) {
    const { d, seen } = adeps({ intent: "question" });
    const r = await call(d, { question: "합성PAY 몇 건", intents, aggregate_context: "garbage" });
    assertEquals([r.status, seen.agg], [200, [agg]]);
  }
});

Deno.test("aggregate round-trip: a defaulted (and a clamped) ok response's conditions sent back as aggregate_context with '날짜별로는?' → 200, inherited, bucket day, same from/to, sentence keeps '최근 7일' / '(최대 90일)'", async () => {
  const rpc = { total: 2, buckets: [{ key: "14", count: 2 }] };
  for (const [first, mark] of [[raw({ bucket: "hour" }), "최근 7일"], [raw({ from: "2026-01-01", bucket: "hour" }), "(최대 90일)"]] as const) {
    const a = adeps({ intent: "aggregate", aggregate: first, rpc });
    const one = await call(a.d, { question: "합성PAY 몇 시에 많았어", intents: AGG });
    const c = one.j.aggregate.conditions as AggConditions;
    assert(c.defaulted || c.clamped, mark);

    const b = adeps({ intent: "aggregate", aggregate: { keywords: [], sender: null, sources: [], from: null, to: null, bucket: "day" },
      rpc: { total: 2, buckets: [{ key: c.to, count: 2 }] } });
    const two = await call(b.d, { question: "날짜별로는?", intents: AGG, aggregate_context: c, context: [{ question: "합성PAY 몇 시에 많았어", answer: one.j.aggregate.sentence }] });
    assertEquals(two.status, 200, mark);
    assertEquals(b.seen.agg, [{ previous: c }]);
    const n = two.j.aggregate.conditions as AggConditions;
    assertEquals([two.j.intent, two.j.aggregate.status, n.bucket, n.from, n.to, n.defaulted, n.clamped], ["aggregate", "ok", "day", c.from, c.to, c.defaulted, c.clamped]);
    assert((two.j.aggregate.sentence as string).includes(mark), two.j.aggregate.sentence);
    assertEquals(JSON.parse(two.lines.at(-1)!).inherited, true);
  }
});

Deno.test("aggregate ok: RPC args (keywords, sender, MESSAGES only stays MESSAGES, from/to, bucket), response {intent:'aggregate', answer:'', aggregate:{status:'ok', buckets 24, top, sentence, notes}}, no search/answer/audit calls", async () => {
  const { d, seen } = adeps({ intent: "aggregate", sources: ["MESSAGES", "NOTIFICATION"],
    aggregate: raw({ keywords: [" 합성PAY ", "타임아웃", "합성pay"], sender: " 합성은행 ", sources: ["MESSAGES"], from: "2026-10-15", to: "2026-10-21", bucket: "hour" }),
    rpc: { total: 5, buckets: [{ key: "09", count: 2 }, { key: "14", count: 3 }] } });
  const { status, j } = await call(d, { question: "이번 주 합성은행 합성PAY 타임아웃 문자 몇 시에 많았어", intents: AGG });
  assertEquals(status, 200);
  assertEquals(seen.aggregate, [{ c: { keywords: ["합성PAY", "타임아웃"], sender: "합성은행", sources: ["MESSAGES"], from: "2026-10-15", to: "2026-10-21",
    bucket: "hour", defaulted: false, clamped: false }, key: null }]);
  assertEquals([j.intent, j.answer, j.refused, j.source_item_ids, j.citations, j.proposals, j.hits, j.candidates, j.schedule, j.mail, j.mail_read, j.edit, j.save_rule],
    ["aggregate", "", false, [], [], [], [], [], null, null, null, null, null]);
  const a = j.aggregate;
  assertEquals([a.status, a.total, a.buckets.length, a.top], ["ok", 5, 24, [{ key: "14", label: "14시", count: 3 }, { key: "09", label: "9시", count: 2 }]]);
  assertEquals(a.sentence, "10/15–10/21 '합성PAY·타임아웃' 합성은행에서 온 문자 5건 — 14시대가 3건으로 가장 많았어요");
  assertEquals(a.notes, [AGG_TEXT.savedOnly]);
  assertEquals([seen.search, seen.answer, seen.audit, seen.saveRules, seen.cands], [0, 0, 0, 0, 0]);
});

Deno.test("aggregate: legacy filter sources (문자 = MESSAGES+NOTIFICATION) never reach the RPC — only aggregate.sources", async () => {
  for (const [sources, want] of [[[], []], [["MESSAGES"], ["MESSAGES"]], [["MESSAGES", "NOTIFICATION"], ["MESSAGES", "NOTIFICATION"]]] as const) {
    const { d, seen } = adeps({ intent: "aggregate", sources: ["MESSAGES", "NOTIFICATION"], aggregate: raw({ sources: [...sources] }), rpc: { total: 1, buckets: [] } });
    await call(d, { question: "합성PAY 문자 몇 건", intents: AGG });
    assertEquals(seen.aggregate[0].c.sources, [...want]);
  }
});

Deno.test("aggregate: zero keywords → question flow (search + answer, intent question); with aggregate_context → inherited", async () => {
  for (const agg of [raw({ keywords: [] }), raw({ keywords: [" ", 3] }), null]) {
    const { d, seen } = adeps({ intent: "aggregate", aggregate: agg });
    const { j, lines } = await call(d, { question: "문자 몇 개 왔어?", intents: AGG });
    assertEquals([j.intent, j.aggregate, j.answer, seen.search, seen.answer, seen.aggregate.length], ["question", null, "합성 답", 1, 1, 0]);
    assertEquals(JSON.parse(lines.at(-1)!).intent_raw, "aggregate");
  }
  const { d, seen } = adeps({ intent: "aggregate", aggregate: raw({ keywords: [], bucket: "weekday" }), rpc: { total: 1, buckets: [{ key: "3", count: 1 }] } });
  const { j, lines } = await call(d, { question: "요일별로는?", intents: AGG, aggregate_context: CTX });
  assertEquals([j.intent, j.aggregate.status, seen.search, seen.aggregate[0].c.keywords, seen.aggregate[0].c.bucket], ["aggregate", "ok", 0, ["합성PAY"], "weekday"]);
  assertEquals(JSON.parse(lines.at(-1)!).inherited, true);
});

Deno.test("aggregate: bad_condition → no RPC, conditions null, sentence = AGG_TEXT.bad", async () => {
  for (const agg of [raw({ keywords: ["합성PAY", "A"] }), raw({ keywords: ["합성1", "합성2", "합성3", "합성4"] }), raw({ sender: "가" }), raw({ from: "2026-02-30" })]) {
    const { d, seen } = adeps({ intent: "aggregate", aggregate: agg });
    const { status, j } = await call(d, { question: "합성PAY 몇 건", intents: AGG });
    assertEquals([status, j.intent, seen.aggregate.length, seen.search], [200, "aggregate", 0, 0]);
    assertEquals(j.aggregate, { status: "bad_condition", conditions: null, total: 0, body_total: null, buckets: [], top: [], sentence: AGG_TEXT.bad, notes: [] });
  }
});

Deno.test("aggregate: RPC throws or aborts → status failed, conditions kept, sentence = AGG_TEXT.failed", async () => {
  for (const err of [new Error("aggregate_items 57014"), new Error("aggregate_items timeout"), new DOMException("aborted", "AbortError")]) {
    const { d, seen } = adeps({ intent: "aggregate", aggregate: raw({ bucket: "weekday" }), rpc: err as Error });
    const { status, j, lines } = await call(d, { question: "합성PAY 무슨 요일에 많았어", intents: AGG });
    assertEquals([status, j.aggregate.status, j.aggregate.sentence, j.aggregate.total, j.aggregate.buckets, j.aggregate.notes], [200, "failed", AGG_TEXT.failed, 0, [], []]);
    assertEquals(j.aggregate.conditions, seen.aggregate[0].c);
    assertEquals(JSON.parse(lines.at(-1)!).status, "failed");
  }
});

Deno.test("aggregate: zero total reads rules for the hint; non-zero total does not call saveRules", async () => {
  const none = adeps({ intent: "aggregate", aggregate: raw(), rpc: { total: 0, buckets: [] }, rules: [] });
  const a = (await call(none.d, { question: "합성PAY 몇 건", intents: AGG })).j.aggregate;
  assertEquals([none.seen.saveRules, a.notes.length, a.sentence], [1, 2, "최근 7일 '합성PAY' 메시지는 0건이에요"]);
  const has = adeps({ intent: "aggregate", aggregate: raw(), rpc: { total: 0, buckets: [] }, rules: [rule("r-2", "keyword", "합성pay")] });
  assertEquals([(await call(has.d, { question: "합성PAY 몇 건", intents: AGG })).j.aggregate.notes, has.seen.saveRules], [[AGG_TEXT.savedOnly], 1]);
  const some = adeps({ intent: "aggregate", aggregate: raw(), rpc: { total: 3, buckets: [{ key: "2026-10-20", count: 3 }] } });
  assertEquals([(await call(some.d, { question: "합성PAY 몇 건", intents: AGG })).j.aggregate.total, some.seen.saveRules], [3, 0]);
});

// Ruling A9-hint: 0건 집계에서 규칙 읽기가 실패해도 집계는 ok — 꼬리 줄 ②(힌트)만 뺀다
Deno.test("saveRules throws on zero total → status ok, 0건 문장, notes = [savedOnly]", async () => {
  const { d, seen } = adeps({ intent: "aggregate", aggregate: raw(), rpc: { total: 0, buckets: [] }, rules: new Error("save_rules_of 57014") });
  const { status, j, lines } = await call(d, { question: "합성PAY 몇 건", intents: AGG });
  assertEquals([status, j.aggregate.status, j.aggregate.total, j.aggregate.sentence, j.aggregate.notes, seen.saveRules],
    [200, "ok", 0, "최근 7일 '합성PAY' 메시지는 0건이에요", [AGG_TEXT.savedOnly], 1]);
  assertEquals(JSON.parse(lines.at(-1)!).status, "ok");
});

Deno.test("save_rule_add duplicate → matched counted from candidates; ok/limit/bad_value → matched 0 and no candidate decrypt", async () => {
  const cands = [cand("i-1", { text: "[합성PAY] 결제 타임아웃" }), cand("i-2", { title: "합성pay 안내" }), cand("i-3", { text: "합성택배" })];
  const dup = adeps({ intent: "save_rule_add", saveRule: { kind: "keyword", value: " 합성pay " }, rules: [R1], cands });
  const j = (await call(dup.d, { question: "앞으로 합성pay 문자는 저장해", intents: AGG })).j;
  assertEquals([j.intent, j.answer, j.aggregate, dup.seen.cands, dup.seen.search, dup.seen.add], ["save_rule_add", "", null, 1, 0, []]);
  assertEquals(j.save_rule, { op: "add", status: "duplicate", candidate: null, matches: [R1], rules: [], matched: 2, limit: 20 });

  const twenty = Array.from({ length: 20 }, (_, i) => rule(`r-${i + 1}`, "keyword", `합성키워드${i + 1}`));
  for (const [saveRule, rules, status] of [[{ kind: "sender", value: "합성택배" }, [R1], "ok"], [{ kind: "keyword", value: "합성새키워드" }, twenty, "limit"],
    [{ kind: "keyword", value: "가" }, [R1], "bad_value"]] as const) {
    const o = adeps({ intent: "save_rule_add", saveRule, rules: [...rules], cands });
    const s = (await call(o.d, { question: "앞으로 저장해", intents: AGG })).j.save_rule;
    assertEquals([s.status, s.matched, o.seen.cands, o.seen.add], [status, 0, 0, []], status);
  }
  const list = adeps({ intent: "save_rule_list", rules: [R1] });
  assertEquals((await call(list.d, { question: "저장 규칙 보여줘", intents: AGG })).j.save_rule, { op: "list", status: "ok", candidate: null, matches: [], rules: [R1], matched: 0, limit: 20 });
  const rm = adeps({ intent: "save_rule_remove", saveRule: { kind: "keyword", value: "합성PAY" }, rules: [R1] });
  const r = (await call(rm.d, { question: "합성PAY 규칙 빼줘", intents: AGG })).j.save_rule;
  assertEquals([r.op, r.status, r.matches, rm.seen.remove], ["remove", "ok", [R1], []]);   // 카드를 누르기 전에는 바뀌지 않는다
});

Deno.test("save_rule_* without the intent in intents → question", async () => {
  for (const [intent, intents] of [["save_rule_add", [...OLD, "aggregate"]], ["save_rule_list", OLD], ["aggregate", [...OLD, "save_rule_add"]]] as const) {
    const { d, seen } = adeps({ intent, saveRule: { kind: "keyword", value: "합성PAY" }, aggregate: raw() });
    const { j } = await call(d, { question: "앞으로 합성PAY 문자는 저장해", intents });
    assertEquals([j.intent, j.save_rule, j.aggregate, seen.saveRules, seen.aggregate.length, seen.search], ["question", null, null, 0, 0, 1], intent);
  }
});

Deno.test("/chat/aggregate: revalidates ①..⑤ (no inheritance), bad key → 400 bad_request, RPC error → 500 aggregate_failed, ok → truncated when total > 50", async () => {
  const item = (i: number): AggItem => ({ item_id: `i-${i}`, title: "합성PAY 안내", sender: null, source: "MESSAGES", app_name: null, occurred_at: "2026-10-20T05:00:00Z" });
  const { d, seen } = adeps({ rpc: { total: 52, items: Array.from({ length: 50 }, (_, i) => item(i)) } });
  const ok = await call(d, { conditions: { ...CTX, to: "2026-10-25", keywords: [" 합성PAY "] }, bucket_key: "14" }, "chat/aggregate");
  assertEquals([ok.status, ok.j.status, ok.j.bucket_key, ok.j.label, ok.j.total, ok.j.items.length, ok.j.truncated], [200, "ok", "14", "14시", 52, 50, true]);
  // 재검증 뒤 조건(미래 to → 오늘, 앞뒤 공백 제거)으로 그 칸만 — 필터·예산 없음
  assertEquals(seen.aggregate, [{ c: { ...CTX, keywords: ["합성PAY"], defaulted: false }, key: "14" }]);
  assertEquals([seen.agg.length, seen.lines.length], [0, 0]);

  const few = adeps({ rpc: { total: 3, items: [item(1), item(2), item(3)] } });
  const dayC = { ...CTX, bucket: "day" };
  const f = await call(few.d, { conditions: dayC, bucket_key: "2026-10-16" }, "chat/aggregate");
  assertEquals([f.status, f.j.label, f.j.truncated], [200, "10/16(금)", false]);

  for (const body of [{ conditions: CTX, bucket_key: "24" }, { conditions: CTX, bucket_key: 14 }, { conditions: { ...CTX, keywords: [] }, bucket_key: "14" },
    { conditions: { ...CTX, keywords: ["합성PAY", "A"] }, bucket_key: "14" }, { conditions: dayC, bucket_key: "2026-10-14" }, { conditions: { ...CTX, bucket: "weekday" }, bucket_key: "8" },
    { bucket_key: "14" }, [], '"x"', 'null']) {
    const b = adeps();
    const r = await call(b.d, body, "chat/aggregate");
    assertEquals([r.status, r.j, b.seen.aggregate.length], [400, { error: "bad_request" }, 0], JSON.stringify(body));
  }
  const e = adeps({ rpc: new Error("aggregate_items timeout") });
  const er = await call(e.d, { conditions: CTX, bucket_key: "14" }, "chat/aggregate");
  assertEquals([er.status, er.j], [500, { error: "aggregate_failed" }]);
  assert(!er.lines.join("").includes("합성"));
  const n = adeps();
  assertEquals((await call(n.d, "{", "chat/aggregate")).j, { error: "bad_json" });
  const res = await handleChat(req("chat/aggregate", { conditions: CTX, bucket_key: "14" }, null), n.d);
  assertEquals([res.status, n.seen.aggregate.length], [401, 0]);
});

Deno.test("/chat/rule: 401 without JWT, 400 bad_json, routes to ruleButton", async () => {
  const { d, seen } = adeps({ rules: [R1], cands: [cand("i-1", { text: "합성비밀값 안내" })] });
  const res = await handleChat(req("chat/rule", { op: "remove", rule_id: "r-1" }, null), d);
  assertEquals([res.status, seen.remove], [401, []]);
  assertEquals(await call(d, "{", "chat/rule").then((r) => [r.status, r.j]), [400, { error: "bad_json" }]);
  assertEquals(await call(d, { op: "bogus" }, "chat/rule").then((r) => [r.status, r.j]), [400, { error: "bad_request" }]);
  const rm = await call(d, { op: "remove", rule_id: "r-1" }, "chat/rule");
  assertEquals([rm.status, rm.j, seen.remove], [200, { status: "removed", rules: [R1] }, ["r-1"]]);
  const add = await call(d, { op: "add", kind: "keyword", value: "합성비밀값" }, "chat/rule");
  assertEquals([add.status, add.j.status, seen.add], [200, "added", [["keyword", "합성비밀값"]]]);
  assertEquals([seen.agg.length, seen.lines.length], [0, 0]);                          // 모델·예산 없음
  assert(!add.lines.join("").includes("합성"), add.lines.join("\n"));                 // PF-F11 — 로그에 값 없음
});

Deno.test("logs: intent, context count, inherited, status, total, bucket, clamped, defaulted / op, status, rules, matched — no keyword, sender, value or title strings", async () => {
  const a = adeps({ intent: "aggregate", aggregate: raw({ sender: "합성은행", bucket: "hour" }), rpc: { total: 5, buckets: [{ key: "14", count: 5 }] } });
  const one = await call(a.d, { question: "합성은행 합성PAY 몇 시에 많았어", intents: AGG, context: [{ question: "합성 앞 질문", answer: "합성 앞 답" }] });
  assertEquals(one.lines.map((l) => JSON.parse(l)), [{ chat: "intent", intent: "aggregate", context: 1, inherited: false, status: "ok", total: 5, bucket: "hour",
    clamped: false, defaulted: true }]);
  const b = adeps({ intent: "aggregate", aggregate: raw({ keywords: ["A", "합성PAY"] }) });
  assertEquals(JSON.parse((await call(b.d, { question: "합성PAY 몇 건", intents: AGG })).lines[0]),
    { chat: "intent", intent: "aggregate", context: 0, inherited: false, status: "bad_condition", total: 0, bucket: null, clamped: false, defaulted: false });
  const s = adeps({ intent: "save_rule_add", saveRule: { kind: "sender", value: "합성PAY" }, rules: [rule("r-3", "sender", "합성PAY")],
    cands: [cand("i-1", { sender: "합성PAY" })] });
  const two = await call(s.d, { question: "앞으로 합성PAY에서 온 문자는 저장해", intents: AGG });
  assertEquals(two.lines.map((l) => JSON.parse(l)), [{ chat: "intent", intent: "save_rule_add", context: 0, op: "add", status: "duplicate", rules: 1, matched: 1 }]);
  for (const l of [...one.lines, ...two.lines]) assert(!l.includes("합성"), l);
});

Deno.test("usage: aggregate and save_rule intents settle only the filter element (kind chat)", async () => {
  for (const o of [{ intent: "aggregate", aggregate: raw(), rpc: { total: 0, buckets: [] } }, { intent: "save_rule_add", saveRule: { kind: "keyword", value: "합성PAY" }, rules: [R1] },
    { intent: "save_rule_list" }] as Opts[]) {
    const { d, seen } = adeps(o);
    await call(d, { question: "합성PAY 몇 건", intents: AGG });
    assertEquals(seen.lines, [["chat"]], o.intent);
  }
});

Deno.test("llm_unavailable on the filter call → 503 llm_unavailable (same as questions)", async () => {
  const { d, seen } = adeps({ intent: "aggregate", aggregate: raw() });
  d.filters = async () => { throw new OpenAI.AuthenticationError(401, { code: "invalid_api_key" }, "Incorrect API key provided: sk-inv*********test", new Headers()); };
  const r = await call(d, { question: "합성PAY 몇 건", intents: AGG, aggregate_context: CTX });
  assertEquals([r.status, r.j, seen.aggregate.length, seen.lines.length], [503, { error: "llm_unavailable" }, 0, 1]);
  assertEquals(r.lines.map((l) => JSON.parse(l)), [{ chat: "llm_unavailable", reason: "llm_auth" }]);
});
