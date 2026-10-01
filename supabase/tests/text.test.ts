import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { ClassifyMeta, ClassifyResult } from "../functions/_shared/classify.ts";
import type { TextExtraction, TextMeta } from "../functions/_shared/extract-text.ts";
import type { FactInput } from "../functions/_shared/facts.ts";
import type { Job } from "../functions/_shared/job.ts";
import { processText, type TextDeps, type TextItem } from "../functions/worker/text.ts";

// 문구는 합성. 모델·DB 없이 파이프라인 분기만 본다
const EVENT_X: TextExtraction = { kind: "event", events: [{ evidence: "합성 근거",
  event: { title: "진료", start: "2026-09-30T15:00:00+09:00", end: null, location: null, uncertain: [] } }] };
const BUY_X: TextExtraction = { kind: "purchase", evidence: null,
  purchase: { merchant: "합성커피", products: [], ordered_at: null, amount: 32000, currency: "KRW", order_no: null, status: "paid" } };
function fake(o: { item?: Partial<TextItem> | null; text?: string; verdict?: ClassifyResult | null | Error; result?: TextExtraction;
  failEnqueue?: number; pushed?: boolean; budget?: "ok" | "degraded" | "refused" } = {}) {
  const calls = { decrypt: 0, classify: [] as string[], extract: [] as { text: string; today: string }[], saved: [] as FactInput[],
    status: [] as [string, boolean][], tokens: 0, notify: [] as string[], classifyMeta: [] as ClassifyMeta[], extractMeta: [] as TextMeta[],
    backfill: [] as boolean[], gate: [] as [string, number][], quarantine: [] as string[], embed: [] as [string, boolean][] };
  const base: TextItem = { contentEnc: "enc", source: "NOTIFICATION", appName: "Slack", sender: null, title: null,
    occurredAt: "2026-09-28T15:30:00Z", capturedAt: "2026-09-28T15:30:05Z", status: "queued" };
  // save_fact 처럼 status 를 extracted 로 바꾸고 제안을 기억한다 → 같은 fake 로 processText 를 다시 부르면 실제 재시도가 된다
  const state = { status: o.item?.status ?? base.status, proposals: [] as string[], failEnqueue: o.failEnqueue ?? 0 };
  const d: TextDeps = {
    getItem: async () => (o.item === null ? null : { ...base, ...o.item, status: state.status }),
    decrypt: async () => { calls.decrypt++; return o.text ?? "[합성의원] 내일 오후 3시 진료 예약"; },
    classifier: { provider: "jev", classify: async (t, m) => { calls.classify.push(t); calls.classifyMeta.push(m); if (o.verdict instanceof Error) throw o.verdict; return o.verdict ?? null; } },
    threshold: 0.8,
    extract: async (text, m, today) => { calls.extract.push({ text, today }); calls.extractMeta.push(m); return { result: o.result ?? EVENT_X, usage: { input_tokens: 900, output_tokens: 60 } }; },
    addTokens: async (_u, n, bf) => { calls.tokens += n; calls.backfill.push(bf); },
    saveFact: async (f) => { calls.saved.push(f); state.status = "extracted"; const proposalId = f.kind === "purchase" ? null : "p1";
      if (proposalId && !state.proposals.includes(proposalId)) state.proposals.push(proposalId);
      return { factId: "f1", proposalId, created: calls.saved.length === 1 }; },
    setStatus: async (_u, _i, s, w) => { calls.status.push([s, w]); },
    recordGate: async (_u, _i, l, c) => { calls.gate.push([l, c]); },
    quarantine: async (_u, _i, s) => { calls.quarantine.push(s); state.status = s; },
    enqueueNotify: async (_u, p) => { if (state.failEnqueue > 0) { state.failEnqueue--; throw new Error("enqueue_job XX000"); } calls.notify.push(p); },
    unpushedProposals: async () => (o.pushed ? [] : state.proposals),
    enqueueEmbed: async (_u, i, bf) => { calls.embed.push([i, bf]); },
    budget: { reserve: async () => o.budget ?? "ok", settle: async () => {}, acquire: async () => 1, release: async () => {},
      now: () => new Date("2026-10-15T00:00:00Z") },
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
  assertEquals([calls.saved.length, calls.saved[0].kind, calls.saved[0].payload.via, calls.tokens, calls.status], [1, "event", "text", 960, []]);
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
