import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { CLASSIFY_INSTRUCTIONS, classifierMeta, classifyThreshold, isMessenger, gateDecision, isClassifyResult, LABEL_CRITERIA, LABELS, noneClassifier, raceTimeout }
  from "../functions/_shared/classify.ts";
import { classifierFromEnv, classifierOrNone } from "../functions/_shared/classifier-env.ts";
import { buildJevRequest, JEV_ENDPOINT, JEV_MODEL, jevClassifier, jevHttpTransport, parseJevResponse } from "../functions/_shared/jev.ts";

const META = { source: "NOTIFICATION", appName: "Slack", title: null };
const env = (o: Record<string, string>) => (k: string) => o[k];
// 응답 모양은 평가 리포트 부록(2026-09-29 실호출)과 같다
const JEV_SAMPLE = { model: "jev-1.13.0", usage: { input_tokens: 780, output_tokens: 0 },
  answers: { kind: { type: "choice", choice: "personal", confidence: 1.0, probabilities: { actionable: 0, personal: 1, promo: 0, otp: 0, notice: 0 } } } };

Deno.test("factory: unset/none → none; jev needs only JEV_API_KEY; unknown provider and not-built openai fail with codes", () => {
  assertEquals(classifierFromEnv(env({})).provider, "none");
  assertEquals(classifierFromEnv(env({ CLASSIFY_PROVIDER: "none" })).provider, "none");
  assertThrows(() => classifierFromEnv(env({ CLASSIFY_PROVIDER: "jev" })), Error, "classify jev_key_missing");
  assertEquals(classifierFromEnv(env({ CLASSIFY_PROVIDER: "jev", JEV_API_KEY: "k" })).provider, "jev");
  assertThrows(() => classifierFromEnv(env({ CLASSIFY_PROVIDER: "bogus" })), Error, "classify unknown_provider");
  assertThrows(() => classifierFromEnv(env({ CLASSIFY_PROVIDER: "openai" })), Error, "classify openai_not_built");
});

Deno.test("classifierOrNone: config error → none + code logged (worker keeps running)", () => {
  const logs: string[] = [];
  const c = classifierOrNone(env({ CLASSIFY_PROVIDER: "jev" }), (s) => logs.push(s));
  assertEquals(c.provider, "none");
  assertEquals(logs, [JSON.stringify({ classify_config: "classify jev_key_missing" })]);
});

Deno.test("threshold: default 0.8, valid override, invalid → default", () => {
  assertEquals(classifyThreshold(env({})), 0.8);
  assertEquals(classifyThreshold(env({ CLASSIFY_THRESHOLD: "0.85" })), 0.85);
  for (const bad of ["abc", "0", "1.5", "-1"]) assertEquals(classifyThreshold(env({ CLASSIFY_THRESHOLD: bad })), 0.8);
});

// 사용자 결정(2026-09-29): 비행동 라벨이고 confidence ≥ 0.8 일 때만 폐기. 나머지는 추출로
Deno.test("gate: non-actionable label at ≥ threshold discards with that label; actionable, low confidence, null pass", () => {
  assertEquals(gateDecision(null, 0.8), { discard: false });
  assertEquals(gateDecision({ label: "actionable", confidence: 0.99 }, 0.8), { discard: false });
  for (const label of ["personal", "promo", "otp", "notice", "medical_result"] as const) {
    assertEquals(gateDecision({ label, confidence: 0.8 }, 0.8), { discard: true, reason: label });
    assertEquals(gateDecision({ label, confidence: 0.79 }, 0.8), { discard: false });
  }
});

Deno.test("isClassifyResult: 6 known labels and 0..1 confidence only; none classifier returns null", async () => {
  assert(isClassifyResult({ label: "otp", confidence: 0 }));
  assert(isClassifyResult({ label: "medical_result", confidence: 0.9 }));
  assert(!isClassifyResult({ label: "subscription", confidence: 0.9 }));
  assert(!isClassifyResult({ label: "notice", confidence: 1.2 }));
  assert(!isClassifyResult({ label: "notice" }));
  assertEquals(await noneClassifier.classify("x", META), null);
});

Deno.test("raceTimeout: returns first; times out even if the task ignores the abort signal", async () => {
  assertEquals(await raceTimeout(() => Promise.resolve(1), 50, "t"), 1);
  await assertRejects(() => raceTimeout(() => new Promise<never>(() => {}), 20, "classify jev_timeout"), Error, "classify jev_timeout");
});

Deno.test("jev request: pinned model, choice question with the 6-label criteria, body ≤2000, sender never sent", () => {
  const r = buildJevRequest("가".repeat(2500), META);
  assertEquals([r.model, r.questions.kind.type, r.questions.kind.instructions], [JEV_MODEL, "choice", CLASSIFY_INSTRUCTIONS]);
  assertEquals(Object.keys(r.questions.kind.criteria).sort(), [...LABELS].sort());
  assertEquals(r.questions.kind.criteria, LABEL_CRITERIA);
  assertEquals([r.state.app, r.state.title, r.state.sender, r.state.body.length], ["Slack", null, null, 2000]);
  assertEquals(buildJevRequest("x", { source: "MESSAGES", appName: null, title: "t" }).state.app, "MESSAGES");
});

Deno.test("jev parse: choice answer → label + Jev confidence; wrong type / unknown label / bad confidence → null", () => {
  assertEquals(parseJevResponse(JEV_SAMPLE), { label: "personal", confidence: 1 });
  const k = JEV_SAMPLE.answers.kind;
  assertEquals(parseJevResponse({ answers: { kind: { ...k, type: "text" } } }), null);
  assertEquals(parseJevResponse({ answers: { kind: { ...k, choice: "spam" } } }), null);
  assertEquals(parseJevResponse({ answers: { kind: { ...k, confidence: 1.5 } } }), null);
  assertEquals(parseJevResponse(null), null);
});

// Review Focus 4: 429·529 는 짧게 두 번 재시도, 그래도 실패하거나 401·422 면 오류(게이트는 추출로 넘긴다)
Deno.test("jev classifier: 429/529 retried twice then coded error; 401 not retried; bad body / network / timeout coded", async () => {
  const seq = (statuses: number[]) => {
    const calls: number[] = [];
    return { calls, t: async () => { const s = statuses[Math.min(calls.length, statuses.length - 1)]; calls.push(s); return { status: s, json: s === 200 ? JEV_SAMPLE : null }; } };
  };
  const slept: number[] = [];
  const sleep = async (ms: number) => { slept.push(ms); };
  const a = seq([429, 200]);
  assertEquals(await jevClassifier({ transport: a.t, sleep }).classify("x", META), { label: "personal", confidence: 1 });
  assertEquals([a.calls, slept], [[429, 200], [300]]);
  const b = seq([529, 529, 529]);
  await assertRejects(() => jevClassifier({ transport: b.t, sleep }).classify("x", META), Error, "classify jev_status_529");
  assertEquals(b.calls.length, 3);
  const c = seq([401]);
  await assertRejects(() => jevClassifier({ transport: c.t, sleep }).classify("x", META), Error, "classify jev_status_401");
  assertEquals(c.calls.length, 1);
  await assertRejects(() => jevClassifier({ transport: async () => ({ status: 200, json: { answers: {} } }) }).classify("x", META), Error, "classify jev_bad_response");
  await assertRejects(() => jevClassifier({ transport: () => Promise.reject(new TypeError("dns")) }).classify("x", META), Error, "classify jev_network");
  await assertRejects(() => jevClassifier({ transport: () => new Promise(() => {}), timeoutMs: 20 }).classify("x", META), Error, "classify jev_timeout");
});

Deno.test("jev http transport: endpoint, bearer header, JSON body; key not in URL", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const t = jevHttpTransport({ apiKey: "k123", fetchFn: (async (url: string, init: RequestInit) => {
    seen.push({ url, init }); return new Response(JSON.stringify(JEV_SAMPLE), { status: 200 }); }) as unknown as typeof fetch });
  const r = await t({ a: 1 }, new AbortController().signal);
  assertEquals([r.status, seen[0].url, seen[0].init.method, seen[0].init.body], [200, JEV_ENDPOINT, "POST", "{\"a\":1}"]);
  assertEquals((seen[0].init.headers as Record<string, string>).authorization, "Bearer k123");
  assert(!seen[0].url.includes("k123"));
});

// 실호출 1건(합성 d10). JEV_LIVE=1 일 때만: JEV_LIVE=1 deno test ... supabase/tests/classify.test.ts
Deno.test({ name: "jev live smoke (synthetic phrase)", ignore: Deno.env.get("JEV_LIVE") !== "1", fn: async () => {
  const c = classifierFromEnv((k) => (k === "CLASSIFY_PROVIDER" ? "jev" : Deno.env.get(k)));
  const r = await c.classify("밥 먹었어? 나 지금 집 가는 중", META);
  assert(r !== null && isClassifyResult(r));
  console.log(JSON.stringify({ live: r.label, confidence: r.confidence }));
} });

Deno.test("classifierMeta: messenger apps (ko/en, MESSAGES source) drop title; other apps keep it; sender never in instructions", () => {
  for (const app of ["메시지", "Messages", "SMS", "iMessage", "카카오톡", "KakaoTalk", "Slack", "Instagram", "Telegram", "LINE", "Kakao Talk"]) {
    assert(isMessenger({ source: "NOTIFICATION", appName: app }), app);
    assertEquals(classifierMeta({ source: "NOTIFICATION", appName: app, title: "합성이름" }).title, null);
  }
  assertEquals(classifierMeta({ source: "MESSAGES", appName: null, title: "합성이름" }).title, null);
  assertEquals(classifierMeta({ source: "NOTIFICATION", appName: "합성쇼핑", title: "주문 안내" }).title, "주문 안내");
  assertEquals(classifierMeta({ source: "SHARE", appName: null, title: "합성" }).title, "합성");
  assert(!CLASSIFY_INSTRUCTIONS.includes("sender"));
});
