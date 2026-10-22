import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { costKrw } from "../functions/_shared/budget.ts";
import type { ClassifyMeta, ClassifyResult } from "../functions/_shared/classify.ts";
import type { ExtractOpts, TextExtraction, TextMeta } from "../functions/_shared/extract-text.ts";
import type { FactsInput } from "../functions/_shared/facts.ts";
import type { Job } from "../functions/_shared/job.ts";
import type { Metric } from "../functions/_shared/metrics.ts";
import type { SaveRule } from "../functions/_shared/save-rules.ts";
import { processText, reserveOutputTokens, type TextDeps, type TextItem } from "../functions/worker/text.ts";

// 문구는 합성. 모델·DB 없이 파이프라인 분기만 본다
const EVENT_X: TextExtraction = { kind: "event", events: [{ evidence: "합성 근거",
  event: { title: "진료", start: "2026-09-30T15:00:00+09:00", end: null, location: null, uncertain: [] } }] };
const BUY_X: TextExtraction = { kind: "purchase", evidence: null,
  purchase: { merchant: "합성커피", products: [], ordered_at: null, amount: 32000, currency: "KRW", order_no: null, status: "paid" } };
function fake(o: { item?: Partial<TextItem> | null; text?: string; verdict?: ClassifyResult | null | Error; result?: TextExtraction;
  failEnqueue?: number; pushed?: boolean; budget?: "ok" | "degraded" | "refused"; extractThrows?: boolean; rules?: SaveRule[];
  metrics?: unknown[]; saveMetricsThrows?: boolean; saveFactsThrowsOnce?: boolean } = {}) {
  const calls = { decrypt: 0, classify: [] as string[], extract: [] as { text: string; today: string }[], saved: [] as FactsInput[],
    status: [] as [string, boolean][], tokens: 0, notify: [] as string[], classifyMeta: [] as ClassifyMeta[], extractMeta: [] as TextMeta[],
    backfill: [] as boolean[], gate: [] as [string, number | null][], ruleCalls: 0, quarantine: [] as string[], embed: [] as [string, boolean][],
    reserved: [] as string[], settled: [] as { k: string; m: string; lines: unknown[][] }[],
    metrics: [] as Metric[][], extractOpts: [] as (ExtractOpts | undefined)[], seq: [] as string[], est: [] as number[] };
  const base: TextItem = { contentEnc: "enc", source: "NOTIFICATION", appName: "Slack", sender: null, title: null,
    occurredAt: "2026-09-28T15:30:00Z", capturedAt: "2026-09-28T15:30:05Z", status: "queued" };
  // save_facts 처럼 status 를 extracted 로 바꾸고 제안을 기억한다 → 같은 fake 로 processText 를 다시 부르면 실제 재시도가 된다
  const state = { status: o.item?.status ?? base.status, proposals: [] as string[], failEnqueue: o.failEnqueue ?? 0,
    saveFactsThrows: o.saveFactsThrowsOnce ? 1 : 0 };
  const d: TextDeps = {
    getItem: async () => (o.item === null ? null : { ...base, ...o.item, status: state.status }),
    decrypt: async () => { calls.decrypt++; return o.text ?? "[합성의원] 내일 오후 3시 진료 예약"; },
    classifier: { provider: "jev", classify: async (t, m) => { calls.classify.push(t); calls.classifyMeta.push(m); if (o.verdict instanceof Error) throw o.verdict; return o.verdict ?? null; } },
    threshold: 0.8,
    // metrics 키는 opts.metrics 일 때만(K24 — 실제 extractTextDetailed 와 같다)
    extract: async (text, m, today, onUsage, opts) => { calls.extract.push({ text, today }); calls.extractMeta.push(m); calls.extractOpts.push(opts);
      onUsage?.({ input: 900, cached: 0, output: 60 });
      if (o.extractThrows) throw new Error("openai incomplete max_output_tokens");
      return { result: o.result ?? EVENT_X, usage: { input_tokens: 900, output_tokens: 60 }, ...(opts?.metrics && o.metrics ? { metrics: o.metrics } : {}) }; },
    addTokens: async (_u, n, bf) => { calls.tokens += n; calls.backfill.push(bf); },
    // 던지기는 status 변경 전(PF-F14) — 재시도가 already_processed 가 아니라 다시 추출로 간다
    saveFacts: async (f) => { calls.seq.push("saveFacts");
      if (state.saveFactsThrows > 0) { state.saveFactsThrows--; throw new Error("save_facts XX000"); }
      calls.saved.push(f); state.status = "extracted";
      return f.entries.map((_, i) => { const proposalId = f.kind === "purchase" ? null : `p${i + 1}`;
        if (proposalId && !state.proposals.includes(proposalId)) state.proposals.push(proposalId);
        return { factId: `f${i + 1}`, proposalId, created: calls.saved.length === 1 }; }); },
    setStatus: async (_u, _i, s, w) => { calls.seq.push(`setStatus:${s}`); calls.status.push([s, w]); },
    recordGate: async (_u, _i, l, c) => { calls.gate.push([l, c]); },
    quarantine: async (_u, _i, s) => { calls.quarantine.push(s); state.status = s; },
    enqueueNotify: async (_u, p) => { if (state.failEnqueue > 0) { state.failEnqueue--; throw new Error("enqueue_job XX000"); } calls.notify.push(p); },
    unpushedProposals: async () => (o.pushed ? [] : state.proposals.slice(0, 1)),
    enqueueEmbed: async (_u, i, bf) => { calls.seq.push("enqueueEmbed"); calls.embed.push([i, bf]); },
    saveMetrics: async (_u, _i, ms) => { calls.seq.push("saveMetrics");
      if (o.saveMetricsThrows) throw new Error("worker_save_metrics P0001");
      calls.metrics.push(ms); return ms.length; },
    saveRules: async () => { calls.ruleCalls++; return o.rules ?? []; },
    budget: { reserve: async (_u, k, est) => { calls.reserved.push(k); calls.est.push(est); return { level: o.budget ?? "ok", month: "2026-10-01" }; },
      settle: async (_u, k, _e, m, lines) => { calls.settled.push({ k, m, lines: lines.map((l) => [l.kind, l.model, l.input, l.output]) }); },
      acquire: async () => 1, release: async () => {}, now: () => new Date("2026-10-15T00:00:00Z") },
  };
  return { d, calls };
}
const job = (o: Partial<Job> = {}): Job => ({ id: "j1", kind: "process", user_id: "u1", payload: { item_id: "i1" }, attempts: 1, checkpoint: null, ...o });

Deno.test("backfill job: extraction tokens go to the backfill counter", async () => {
  const { d, calls } = fake();
  await processText(d, job({ payload: { item_id: "i1", backfill: true } }));
  await processText(fake().d, job());
  assertEquals(calls.backfill, [true]);
});

Deno.test("event → proposed; fact via text; tokens counted; status left to save_fact", async () => {
  const { d, calls } = fake({ verdict: { label: "actionable", confidence: 0.99 } });
  assertEquals(await processText(d, job()), "proposed");
  assertEquals([calls.saved.length, calls.saved[0].kind, calls.saved[0].entries[0].payload.via, calls.tokens, calls.status], [1, "event", "text", 960, []]);
});

// 최종 리뷰 I1: 메신저 알림의 title 은 발신자 표시 이름이다 → 분류기(Jev)에는 null, 비메신저는 그대로
Deno.test("gate: messenger title (sender display name) never reaches the classifier; other apps keep title", async () => {
  for (const [source, appName] of [["NOTIFICATION", "메시지"], ["NOTIFICATION", "카카오톡"], ["NOTIFICATION", "KakaoTalk"], ["MESSAGES", "SMS"],
    ["NOTIFICATION", "Slack"], ["MESSAGES", null]] as [string, string | null][]) {
    const { d, calls } = fake({ item: { source, appName, title: "합성이름" }, verdict: { label: "actionable", confidence: 0.99 } });
    await processText(d, job());
    assertEquals(calls.classifyMeta[0], { source, appName, title: null });
  }
  const shop = fake({ item: { appName: "합성쇼핑", title: "주문 안내" }, verdict: { label: "actionable", confidence: 0.99 } });
  await processText(shop.d, job());
  assertEquals(shop.calls.classifyMeta[0].title, "주문 안내");
});

// Review Focus 1: 추출 기준일 = 받은 날(서울)
Deno.test("extract today = received day of occurred_at (Seoul), not processing time", async () => {
  const { d, calls } = fake();
  await processText(d, job());
  assertEquals(calls.extract[0].today, "2026-09-29");                       // occurred 2026-09-28T15:30Z = 서울 09-29 00:30
});

Deno.test("purchase → extracted (no proposal)", async () => {
  const { d } = fake({ result: BUY_X });
  assertEquals(await processText(d, job()), "extracted");
});

Deno.test("already processed → returns stored status without decrypt/classify/extract", async () => {
  const { d, calls } = fake({ item: { status: "extracted", contentEnc: null } });
  assertEquals(await processText(d, job()), "extracted");
  assertEquals([calls.decrypt, calls.classify.length, calls.extract.length], [0, 0, 0]);
});

Deno.test("server rules: OTP → discarded:server:otp with wipe, no model calls; card number masked before models", async () => {
  const otp = fake({ text: "[합성은행] 인증번호 [482913]를 입력하세요" });
  assertEquals(await processText(otp.d, job()), "discarded:server:otp");
  assertEquals([otp.calls.status, otp.calls.classify.length, otp.calls.extract.length], [[["discarded:server:otp", true]], 0, 0]);
  const card = fake({ text: "[합성카드] 4111-1111-1111-1111 승인 32,000원" });
  await processText(card.d, job());
  assertEquals([card.calls.classify[0].includes("4111-1111"), card.calls.extract[0].text.includes("****-****-****-1111")], [false, true]);
});

// 사용자 결정: 비행동 라벨 + confidence ≥ 0.8 → discarded:server:<label>, 추출 없음. 본문은 7일 격리(스펙 §7, M1-④a)
Deno.test("gate: non-actionable ≥ 0.8 → 7-day quarantine (no wipe), label recorded, no extraction", async () => {
  for (const label of ["personal", "promo", "otp", "notice", "medical_result"] as const) {
    const { d, calls } = fake({ verdict: { label, confidence: 0.95 } });
    assertEquals(await processText(d, job()), `discarded:server:${label}`);
    assertEquals([calls.quarantine, calls.status, calls.gate, calls.extract.length], [[`discarded:server:${label}`], [], [[label, 0.95]], 0]);
  }
});

// Review Focus 3: 복구한 항목은 Jev 가 또 버리라고 해도 추출로 간다
Deno.test("restored item (skip_gate): classifier not called, no quarantine, extraction runs", async () => {
  const { d, calls } = fake({ verdict: { label: "personal", confidence: 0.99 } });
  assertEquals(await processText(d, job({ payload: { item_id: "i1", skip_gate: true } })), "proposed");
  assertEquals([calls.classify.length, calls.quarantine.length, calls.extract.length], [0, 0, 1]);
});

// 사용자 결정 2026-10-03: 사용자가 직접 공유·채팅 첨부한 SHARE 항목은 게이트를 건너뛴다(스펙 §7). 다른 출처는 그대로 게이트를 탄다
Deno.test("SHARE item: classifier not called, no gate label or quarantine, extraction runs", async () => {
  for (const appName of ["이미지", "웹 링크", "메모"]) {
    const { d, calls } = fake({ item: { source: "SHARE", appName }, verdict: { label: "promo", confidence: 0.91 } });
    assertEquals(await processText(d, job()), "proposed");
    assertEquals([calls.classify.length, calls.gate, calls.quarantine, calls.extract.length], [0, [], [], 1]);
  }
});

Deno.test("non-SHARE sources still go through the gate", async () => {
  for (const source of ["NOTIFICATION", "MESSAGES", "GMAIL", "CHAT"]) {
    const { d, calls } = fake({ item: { source }, verdict: { label: "promo", confidence: 0.91 } });
    assertEquals(await processText(d, job()), "discarded:server:promo");
    assertEquals([calls.classify.length, calls.quarantine, calls.extract.length], [1, ["discarded:server:promo"], 0]);
  }
});

Deno.test("SHARE item: server rules still discard (OTP wipe, (광고) promotion) and mask before extraction", async () => {
  const otp = fake({ item: { source: "SHARE" }, text: "[합성은행] 인증번호 [482913]를 입력하세요" });
  assertEquals(await processText(otp.d, job()), "discarded:server:otp");
  assertEquals([otp.calls.status, otp.calls.classify.length, otp.calls.extract.length], [[["discarded:server:otp", true]], 0, 0]);
  const ad = fake({ item: { source: "SHARE" }, text: "(광고) 합성마트 가을 세일 30% 할인 쿠폰" });
  assertEquals(await processText(ad.d, job()), "discarded:server:promotion");
  assertEquals([ad.calls.status, ad.calls.classify.length, ad.calls.extract.length], [[["discarded:server:promotion", true]], 0, 0]);
  const card = fake({ item: { source: "SHARE" }, text: "[합성카드] 4111-1111-1111-1111 승인 32,000원" });
  await processText(card.d, job());
  assertEquals([card.calls.classify.length, card.calls.extract[0].text.includes("****-****-****-1111")], [0, true]);
});

// 순수 광고 SHARE 는 게이트 대신 추출기의 none 으로 걸러진다 → empty(원문 유지, 검색 대상)
Deno.test("SHARE ad without a (광고) mark: extraction none → discarded:server:empty", async () => {
  const { d, calls } = fake({ item: { source: "SHARE" }, text: "합성 페스티벌 얼리버드 30% 할인 지금 예매하세요", result: { kind: "none" } });
  assertEquals(await processText(d, job()), "discarded:server:empty");
  assertEquals([calls.classify.length, calls.status, calls.embed.length], [0, [["discarded:server:empty", false]], 1]);
});

Deno.test("gate label recorded for passed items too; classifier error records nothing", async () => {
  const a = fake({ verdict: { label: "actionable", confidence: 0.97 } });
  await processText(a.d, job());
  assertEquals(a.calls.gate, [["actionable", 0.97]]);
  const b = fake({ verdict: new Error("classify jev_timeout") });
  await processText(b.d, job());
  assertEquals(b.calls.gate, []);
});

// Review Focus 4 + 사용자 결정: 낮은 confidence·분류기 오류는 버리지 않고 추출로
Deno.test("gate: low confidence, Jev error or timeout → extraction continues", async () => {
  const verdicts: (ClassifyResult | Error)[] = [{ label: "personal", confidence: 0.67 }, { label: "notice", confidence: 0.5 },
    new Error("classify jev_timeout"), new Error("classify jev_status_529"), new Error("classify jev_status_401")];
  for (const verdict of verdicts) {
    const { d, calls } = fake({ verdict });
    assertEquals(await processText(d, job()), "proposed");
    assertEquals(calls.extract.length, 1);
  }
});

Deno.test("nothing to keep → discarded:server:empty without wipe; missing ciphertext → empty without decrypt", async () => {
  const e = fake({ result: { kind: "none" } });
  assertEquals(await processText(e.d, job()), "discarded:server:empty");
  assertEquals(e.calls.status, [["discarded:server:empty", false]]);
  const n = fake({ item: { contentEnc: null } });
  assertEquals(await processText(n.d, job()), "discarded:server:empty");
  assertEquals(n.calls.decrypt, 0);
});

// R1(2026-10-03): 추출 0건이면 empty 로그 줄에 사유 코드·원래 일정 후보 수만(본문·추출값 없음). 다른 empty(원문 없음)는 사유 없음
Deno.test("empty after extraction logs why and raw_events only — no body or extracted values", async () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const e = fake({ item: { source: "SHARE" }, text: "[이미지] 합성구 문화제 10.23~25 합성광장", result: { kind: "none", why: "no_start", raw_events: 3 } });
    assertEquals(await processText(e.d, job()), "discarded:server:empty");
    const m = fake({ result: { kind: "none" } });                     // 사유가 없는 none(구 형태)도 깨지지 않는다
    assertEquals(await processText(m.d, job()), "discarded:server:empty");
    const n = fake({ item: { contentEnc: null } });
    assertEquals(await processText(n.d, job()), "discarded:server:empty");
  } finally {
    console.log = orig;
  }
  const logs = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  assertEquals(logs.map((l) => [l.checkpoint, l.why, l.raw_events]),
    [["discarded:server:empty", "no_start", 3], ["discarded:server:empty", null, null], ["discarded:server:empty", undefined, undefined]]);
  for (const l of lines) for (const w of ["합성구", "문화제", "합성광장"]) assertEquals(l.includes(w), false, w);
});

Deno.test("errors: no user_id, item not found", async () => {
  await assertRejects(() => processText(fake().d, job({ user_id: null })), Error, "process job without user_id");
  await assertRejects(() => processText(fake({ item: null }).d, job()), Error, "worker_get_text_item not_found");
});

Deno.test("notify job enqueued whenever a proposal exists, never for purchase", async () => {
  const ev = fake();
  await processText(ev.d, job());
  assertEquals(ev.calls.notify, ["p1"]);
  const buy = fake({ result: BUY_X });
  await processText(buy.d, job());
  await processText(buy.d, job());                                                  // 재시도(extracted): 제안 없음 → 넣지 않음
  assertEquals(buy.calls.notify, []);
});

// Fix round 1: save_fact 가 extracted 를 커밋한 뒤 enqueue 가 실패 → 재시도가 already_processed 로 가도 notify 를 다시 넣는다
Deno.test("retry after enqueue failure: item already extracted → notify re-enqueued once, no model calls", async () => {
  const ev = fake({ failEnqueue: 1 });
  await assertRejects(() => processText(ev.d, job()), Error, "enqueue_job");
  assertEquals([ev.calls.notify, ev.calls.extract.length], [[], 1]);
  assertEquals(await processText(ev.d, job()), "extracted");                       // 실제 재시도: status 는 이미 extracted
  assertEquals([ev.calls.notify, ev.calls.extract.length, ev.calls.saved.length, ev.calls.decrypt], [["p1"], 1, 1, 1]);
  // 이미 푸시 기록이 있으면(notify 가 돌았다) 다시 넣지 않는다. discarded 는 조회조차 안 한다
  const done = fake({ item: { status: "extracted" }, pushed: true });
  assertEquals([await processText(done.d, job()), done.calls.notify], ["extracted", []]);
  const gone = fake({ item: { status: "discarded:server:otp" } });
  gone.d.unpushedProposals = () => { throw new Error("must not query"); };
  assertEquals(await processText(gone.d, job()), "discarded:server:otp");
});

const MULTI_X: TextExtraction = { kind: "event", events: [
  { evidence: "합성 1회차", event: { title: "합성 클래스 1회차", start: "2026-10-04T14:00:00+09:00", end: null, location: null, uncertain: [] } },
  { evidence: "합성 2회차", event: { title: "합성 클래스 2회차", start: "2026-10-11T14:00:00+09:00", end: null, location: null, uncertain: [] } },
] };

Deno.test("multi-event: one save_facts call with both entries; notify enqueued once for the lead (ordinal 0)", async () => {
  const { d, calls } = fake({ result: MULTI_X });
  assertEquals(await processText(d, job()), "proposed");
  assertEquals([calls.saved.length, calls.saved[0].kind, calls.saved[0].entries.length], [1, "event", 2]);
  assertEquals(calls.saved[0].entries.map((e) => e.payload.via), ["text", "text"]);
  assertEquals(calls.notify, ["p1"]);
});

// Review Focus 2: save_facts 커밋 뒤 enqueue 전에 죽으면 재시도는 대표 하나만 다시 넣는다(모델 재호출 없음)
Deno.test("multi-event retry after a lost enqueue: re-enqueues only the lead, no re-extraction", async () => {
  const { d, calls } = fake({ result: MULTI_X, failEnqueue: 1 });
  await assertRejects(() => processText(d, job()));
  assertEquals(await processText(d, job()), "extracted");
  assertEquals([calls.extract.length, calls.notify], [1, ["p1"]]);
});

Deno.test("budget exhausted → Deferred to next month before extraction (job stays queued)", async () => {
  const { d, calls } = fake({ budget: "refused" });
  await assertRejects(() => processText(d, job()), Error, "budget_exhausted");
  assertEquals([calls.extract.length, calls.saved.length], [0, 0]);
});

Deno.test("embed job enqueued after save and after empty-with-body; never for discards", async () => {
  const a = fake(); await processText(a.d, job());                                                       // event → saved
  const b = fake({ result: { kind: "none" } }); await processText(b.d, job());                          // empty(본문 유지)
  const c = fake({ verdict: { label: "personal", confidence: 0.95 } }); await processText(c.d, job());   // 격리
  const e = fake({ text: "인증번호 482913 입니다" }); await processText(e.d, job());                     // 규칙 폐기
  assertEquals([a.calls.embed, b.calls.embed, c.calls.embed, e.calls.embed], [[["i1", false]], [["i1", false]], [], []]);
});

Deno.test("embed job: backfill lane follows the process job; retry after a lost enqueue re-enqueues only for searchable items", async () => {
  const bf = fake(); await processText(bf.d, job({ payload: { item_id: "i1", backfill: true } }));
  assertEquals(bf.calls.embed, [["i1", true]]);
  // save_fact 가 커밋된 뒤 끊긴 재시도(status extracted): 다시 넣는다(embed 잡은 청크가 있으면 건너뛴다). 격리 항목의 재시도는 넣지 않는다
  const ex = fake({ item: { status: "extracted" } }); await processText(ex.d, job());
  const em = fake({ item: { status: "discarded:server:empty" } }); await processText(em.d, job());
  const q = fake({ item: { status: "discarded:server:personal" } }); await processText(q.d, job());
  assertEquals([ex.calls.embed, em.calls.embed, q.calls.embed], [[["i1", false]], [["i1", false]], []]);
});
Deno.test("text billing: a normal item settles one extract line; a backfill item settles one backfill line on the backfill reservation", async () => {
  const a = fake();
  await processText(a.d, job());
  assertEquals(a.calls.settled, [{ k: "extract", m: "2026-10-01", lines: [["extract", "gpt-6-luna", 900, 60]] }]);
  const b = fake();
  await processText(b.d, job({ payload: { item_id: "i1", backfill: true } }));
  assertEquals(b.calls.settled, [{ k: "backfill", m: "2026-10-01", lines: [["backfill", "gpt-6-luna", 900, 60]] }]);
});
// 응답은 왔지만 파싱 실패(incomplete) — 청구된 토큰을 정산하고 잡은 실패(재시도)로
Deno.test("text billing: the extraction response arrives but parsing fails → the line is settled and the job throws", async () => {
  const { d, calls } = fake({ extractThrows: true });
  let thrown = "";
  try { await processText(d, job()); } catch (e) { thrown = (e as Error).message; }
  assertEquals(thrown, "openai incomplete max_output_tokens");
  assertEquals(calls.settled[0].lines, [["extract", "gpt-6-luna", 900, 60]]);
});

// 저장 규칙(스펙 §7 "저장 규칙", 0.17.0): 서버 규칙 폐기(OTP·(광고)) 뒤, 맞으면 Jev 를 건너뛰고 일정이 없으면 kept(원문 유지·청크). 문구·규칙 값은 합성
const rule = (kind: "keyword" | "sender", value: string): SaveRule => ({ id: `r-${value}`, kind, value, created_at: "2026-10-21T00:00:00Z" });
const PAY = rule("keyword", "합성PAY");
const PAY_TEXT = "[합성PAY] 결제 실패 — 타임아웃으로 승인되지 않았어요";

Deno.test("save rule: OTP and (광고) still discard first even when a rule matches (no Jev, no rules lookup needed)", async () => {
  const otp = fake({ rules: [rule("keyword", "합성은행")], text: "[합성은행] 인증번호 [482913]를 입력하세요" });
  assertEquals(await processText(otp.d, job()), "discarded:server:otp");
  const ad = fake({ rules: [rule("keyword", "합성마트")], text: "(광고) 합성마트 가을 세일 30% 할인 쿠폰" });
  assertEquals(await processText(ad.d, job()), "discarded:server:promotion");
  for (const [f, st] of [[otp, "discarded:server:otp"], [ad, "discarded:server:promotion"]] as const) {
    assertEquals([f.calls.status, f.calls.classify.length, f.calls.extract.length, f.calls.gate, f.calls.embed], [[[st, true]], 0, 0, [], []]);
  }
});

Deno.test("save rule: matching item skips Jev, records gate 'rule' with null confidence, 0 facts → kept (no wipe) + embed", async () => {
  // 키워드(본문)·발신자(값·발신자 공백 무시) 둘 다 같은 경로
  for (const [rules, item] of [[[PAY], {}], [[rule("sender", "합성 PAY")], { sender: "합성PAY" }]] as [SaveRule[], Partial<TextItem>][]) {
    const { d, calls } = fake({ rules, item, text: PAY_TEXT, verdict: { label: "notice", confidence: 0.99 }, result: { kind: "none" } });
    assertEquals(await processText(d, job()), "kept");
    assertEquals([calls.classify.length, calls.gate, calls.quarantine, calls.status, calls.embed, calls.extract.length, calls.ruleCalls],
      [0, [["rule", null]], [], [["kept", false]], [["i1", false]], 1, 1]);
  }
});

Deno.test("save rule: matching item with facts → extracted, proposal pushed, gate 'rule'", async () => {
  const { d, calls } = fake({ rules: [PAY], text: PAY_TEXT + " 내일 오후 3시 재시도", verdict: { label: "notice", confidence: 0.99 } });
  assertEquals(await processText(d, job()), "proposed");
  assertEquals([calls.classify.length, calls.gate, calls.saved.length, calls.notify, calls.status, calls.embed],
    [0, [["rule", null]], 1, ["p1"], [], [["i1", false]]]);
});

Deno.test("save rule: card/account numbers are masked, kept item text and extract input have no original digits", async () => {
  const text = "[합성은행] 합성카드 4111111111111111 결제 32,000원 — 합성은행 계좌 110-123-456789 로 환급 예정";
  const { d, calls } = fake({ rules: [rule("keyword", "합성은행")], text, result: { kind: "none" } });
  assertEquals(await processText(d, job()), "kept");
  assertEquals([calls.status, calls.classify.length], [[["kept", false]], 0]);              // 폐기·wipe 아님 — 원문(암호문)은 그대로 남는다
  const sent = calls.extract[0].text;
  for (const raw of ["4111111111111111", "411111111111", "110-123-456789", "123-456"]) assertEquals(sent.includes(raw), false, raw);
  assertEquals([sent.includes("************1111"), sent.includes("***-***-**6789")], [true, true]);
});

Deno.test("save rule: non-matching item 0 facts → discarded:server:empty as before", async () => {
  const { d, calls } = fake({ rules: [PAY, rule("sender", "합성택배")], text: "합성 페스티벌 얼리버드 예매 안내", result: { kind: "none" },
    verdict: { label: "actionable", confidence: 0.6 } });
  assertEquals(await processText(d, job()), "discarded:server:empty");
  assertEquals([calls.classify.length, calls.gate, calls.status, calls.embed], [1, [["actionable", 0.6]], [["discarded:server:empty", false]], [["i1", false]]]);
});

Deno.test("save rule: skip_gate restored item that matches → no recordGate call, 0 facts → kept", async () => {
  const { d, calls } = fake({ rules: [PAY], text: PAY_TEXT, result: { kind: "none" } });
  assertEquals(await processText(d, job({ payload: { item_id: "i1", skip_gate: true } })), "kept");
  assertEquals([calls.classify.length, calls.gate, calls.status, calls.embed], [0, [], [["kept", false]], [["i1", false]]]);   // 복구 항목은 원래 라벨 유지
});

Deno.test("save rule: SHARE never looks up rules (saveRules not called) and 0 facts → discarded:server:empty", async () => {
  const { d, calls } = fake({ item: { source: "SHARE", appName: "메모" }, rules: [PAY], text: PAY_TEXT, result: { kind: "none" } });
  d.saveRules = () => { throw new Error("must not query"); };
  assertEquals(await processText(d, job()), "discarded:server:empty");
  assertEquals([calls.classify.length, calls.gate, calls.status], [0, [], [["discarded:server:empty", false]]]);
});

Deno.test("save rule: already kept item on retry → embed only (no decrypt, classify, extract)", async () => {
  const { d, calls } = fake({ item: { status: "kept" }, rules: [PAY] });
  assertEquals(await processText(d, job()), "kept");
  assertEquals([calls.decrypt, calls.classify.length, calls.extract.length, calls.status, calls.notify, calls.ruleCalls, calls.embed],
    [0, 0, 0, [], [], 0, [["i1", false]]]);
  const bf = fake({ item: { status: "kept" } });
  await processText(bf.d, job({ payload: { item_id: "i1", backfill: true } }));
  assertEquals(bf.calls.embed, [["i1", true]]);
});

// 0.18.0: 규칙 항목은 metrics 를 함께 묻는다(K24) — 앞 세 인자(text·meta·today)는 같고 opts 만 다르다
Deno.test("save rule: extract text/meta/today are identical with or without a matching rule (only opts differ)", async () => {
  const item: Partial<TextItem> = { source: "MESSAGES", appName: "SMS", sender: "합성PAY", title: "합성PAY 알림" };
  const ruled = fake({ item, rules: [PAY], text: PAY_TEXT });
  const plain = fake({ item, text: PAY_TEXT });
  await processText(ruled.d, job());
  await processText(plain.d, job());
  assertEquals([ruled.calls.gate, plain.calls.classify.length], [[["rule", null]], 1]);
  assertEquals([ruled.calls.extract, ruled.calls.extractMeta], [plain.calls.extract, plain.calls.extractMeta]);
  assertEquals([ruled.calls.extractOpts, plain.calls.extractOpts], [[{ metrics: true }], [undefined]]);
});

Deno.test("save rule: log line has rule:true and no rule value/title/body", async () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const k = fake({ item: { title: "합성PAY 알림" }, rules: [PAY], text: PAY_TEXT, result: { kind: "none", why: "model_none", raw_events: 0 } });
    assertEquals(await processText(k.d, job()), "kept");
    const p = fake({ rules: [PAY], text: PAY_TEXT });
    assertEquals(await processText(p.d, job()), "proposed");
    const n = fake({ text: "[합성의원] 내일 오후 3시 진료 예약" });
    assertEquals(await processText(n.d, job()), "proposed");
  } finally {
    console.log = orig;
  }
  const logs = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  assertEquals(logs.map((l) => [l.checkpoint, l.rule]), [["kept", true], ["proposed", true], ["proposed", false]]);
  assertEquals([logs[0].why, logs[0].raw_events], ["model_none", 0]);
  for (const l of lines) for (const w of ["합성PAY", "PAY", "타임아웃", "알림", "r-"]) assertEquals(l.includes(w), false, w);
});

// 본문 건수(0.18.0, 스펙 §7 "본문 건수"): 저장 규칙 항목만 추출 호출이 metrics 를 함께 뽑고, 정규화해 save_facts·kept 전에 덮어쓴다. 문구는 합성
const RULE: SaveRule[] = [{ id: "r1", kind: "keyword", value: "합성결제", created_at: "2026-10-21T00:00:00Z" }];
const BODY = "[합성결제] 14:00~14:10 타임아웃 6건";
function captureLogs(): { lines: string[]; stop(): void } {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  return { lines, stop: () => { console.log = orig; } };
}

Deno.test("metrics: rule item asks extract with {metrics:true}; non-rule item passes no 5th argument", async () => {
  const a = fake({ rules: RULE, text: BODY, result: { kind: "none" } }); await processText(a.d, job());
  const b = fake({ text: BODY, result: { kind: "none" } }); await processText(b.d, job());
  assertEquals([a.calls.extractOpts, b.calls.extractOpts], [[{ metrics: true }], [undefined]]);
});

Deno.test("metrics: rule item 0 facts → saveMetrics(normalized) before setStatus kept; log metrics/metric_body counts only", async () => {
  const { d, calls } = fake({ rules: RULE, text: BODY, result: { kind: "none" },
    metrics: [{ label: "타임아웃", count: 6, start: "14:00", end: "14:10" }, { label: "", count: 1, start: null, end: null }] });
  const logs = captureLogs();
  try { assertEquals(await processText(d, job()), "kept"); } finally { logs.stop(); }
  // 받음 서울 09-29 00:30 — 시각만 "14:00"은 받은 시각 이전의 가장 최근 14:00 = 09-28 14:00(Ruling N8-time)
  assertEquals(calls.metrics, [[{ label: "타임아웃", count: 6, at: "2026-09-28T05:00:00.000Z", at_body: true }]]);
  assertEquals(calls.seq.slice(0, 2), ["saveMetrics", "setStatus:kept"]);
  const line = JSON.parse(logs.lines.find((l) => l.includes('"kept"'))!);
  assertEquals([line.metrics, line.metric_body], [1, 1]);
  assert(!logs.lines.join("").includes("타임아웃"));
});

Deno.test("metrics: rule item with an event → saveMetrics before saveFacts, both saved", async () => {
  const { d, calls } = fake({ rules: RULE, text: BODY, result: EVENT_X, metrics: [{ label: "오류", count: 2, start: null, end: null }] });
  assertEquals(await processText(d, job()), "proposed");
  assertEquals([calls.seq.indexOf("saveMetrics") < calls.seq.indexOf("saveFacts"), calls.saved.length, calls.metrics[0][0].at_body], [true, 1, false]);
});

Deno.test("metrics: rule item with no metrics key / [] still calls saveMetrics([]) (retry overwrite)", async () => {
  const a = fake({ rules: RULE, text: BODY, result: { kind: "none" } }); await processText(a.d, job());
  const b = fake({ rules: RULE, text: BODY, result: { kind: "none" }, metrics: [] }); await processText(b.d, job());   // PF-F11
  assertEquals([a.calls.metrics, b.calls.metrics], [[[]], [[]]]);
});

Deno.test("metrics: skip_gate restored rule item also saves metrics", async () => {
  const { d, calls } = fake({ rules: RULE, text: BODY, result: { kind: "none" }, metrics: [{ label: "타임아웃", count: 3, start: null, end: null }] });
  await processText(d, job({ payload: { item_id: "i1", skip_gate: true } }));
  assertEquals([calls.gate.length, calls.metrics[0].length], [0, 1]);
});

Deno.test("metrics: non-rule item and SHARE never call saveMetrics; log lines have no metrics key", async () => {
  for (const o of [{ text: BODY }, { text: BODY, item: { source: "SHARE" } }]) {
    const { d, calls } = fake({ ...o, result: { kind: "none" } });
    const logs = captureLogs();
    try { await processText(d, job()); } finally { logs.stop(); }
    assertEquals(calls.metrics.length, 0);
    assert(logs.lines.length > 0 && logs.lines.every((l) => !("metrics" in JSON.parse(l))));
  }
});

Deno.test("metrics: already processed (kept/extracted) retry → no extract, no saveMetrics", async () => {
  for (const status of ["kept", "extracted"]) {
    const { d, calls } = fake({ rules: RULE, item: { status } }); await processText(d, job());
    assertEquals([calls.extract.length, calls.metrics.length], [0, 0]);
  }
});

Deno.test("retry after saveFacts throws re-extracts and overwrites metrics (no growth)", async () => {   // Review Focus 5
  const { d, calls } = fake({ rules: RULE, text: BODY, result: EVENT_X, saveFactsThrowsOnce: true,
    metrics: [{ label: "타임아웃", count: 6, start: null, end: null }] });
  await assertRejects(() => processText(d, job()));
  assertEquals(await processText(d, job()), "proposed");
  assertEquals([calls.extract.length, calls.metrics.length, calls.metrics[1].length], [2, 2, 1]);   // 두 번째 호출도 같은 1행 — DB 덮어쓰기는 N1 사례
});

Deno.test("metrics: saveMetrics throws → job throws, status untouched (no kept, no saveFacts)", async () => {
  const { d, calls } = fake({ rules: RULE, text: BODY, result: { kind: "none" }, saveMetricsThrows: true });
  await assertRejects(() => processText(d, job()), Error, "worker_save_metrics");
  assertEquals([calls.status.length, calls.saved.length], [0, 0]);
});

Deno.test("reserveOutputTokens: general always 700; rule 700 at cap 2048 and the cap itself above 2048 (modes split, K25)", () => {
  assertEquals([reserveOutputTokens(false, 2048), reserveOutputTokens(false, 3072), reserveOutputTokens(true, 2048), reserveOutputTokens(true, 3072)],
    [700, 700, 700, 3072]);
});

Deno.test("reservation estimate: general item costKrw(len+1200, 700) whatever RULE_MAX_OUTPUT_TOKENS is; rule item uses reserveOutputTokens(true)", async () => {
  const a = fake({ rules: RULE, text: BODY, result: { kind: "none" } }); await processText(a.d, job());
  const b = fake({ text: BODY, result: { kind: "none" } }); await processText(b.d, job());
  const est = (output: number) => costKrw("gpt-6-luna", { input: a.calls.extract[0].text.length + 1200, output });
  assertEquals([a.calls.est, b.calls.est], [[est(reserveOutputTokens(true))], [est(700)]]);   // N8 이 상한을 올려도 이 테스트는 그대로 통과한다
});

Deno.test("metrics code has no real service name (worker/text.ts, _shared/metrics.ts)", async () => {
  for (const p of ["../functions/worker/text.ts", "../functions/_shared/metrics.ts"]) assert(!/pinpay/i.test(await Deno.readTextFile(new URL(p, import.meta.url))), p);
});
