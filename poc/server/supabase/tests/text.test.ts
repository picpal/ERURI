import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { ClassifyResult } from "../functions/_shared/classify.ts";
import type { TextExtraction } from "../functions/_shared/extract-text.ts";
import type { FactInput } from "../functions/_shared/facts.ts";
import type { Job } from "../functions/_shared/job.ts";
import { processText, type TextDeps, type TextItem } from "../functions/worker/text.ts";

// 문구는 합성. 모델·DB 없이 파이프라인 분기만 본다
const EVENT_X: TextExtraction = { kind: "event", evidence: "합성 근거",
  event: { title: "진료", start: "2026-09-30T15:00:00+09:00", end: null, location: null, uncertain: [] } };
const BUY_X: TextExtraction = { kind: "purchase", evidence: null,
  purchase: { merchant: "합성커피", products: [], ordered_at: null, amount: 32000, currency: "KRW", order_no: null, status: "paid" } };
function fake(o: { item?: Partial<TextItem> | null; text?: string; verdict?: ClassifyResult | null | Error; result?: TextExtraction } = {}) {
  const calls = { decrypt: 0, classify: [] as string[], extract: [] as { text: string; today: string }[], saved: [] as FactInput[],
    status: [] as [string, boolean][], tokens: 0, notify: [] as string[] };
  const base: TextItem = { contentEnc: "enc", source: "NOTIFICATION", appName: "Slack", sender: null, title: null,
    occurredAt: "2026-09-28T15:30:00Z", capturedAt: "2026-09-28T15:30:05Z", status: "queued" };
  const d: TextDeps = {
    getItem: async () => (o.item === null ? null : { ...base, ...o.item }),
    decrypt: async () => { calls.decrypt++; return o.text ?? "[합성의원] 내일 오후 3시 진료 예약"; },
    classifier: { provider: "jev", classify: async (t) => { calls.classify.push(t); if (o.verdict instanceof Error) throw o.verdict; return o.verdict ?? null; } },
    threshold: 0.8,
    extract: async (text, _m, today) => { calls.extract.push({ text, today }); return { result: o.result ?? EVENT_X, usage: { input_tokens: 900, output_tokens: 60 } }; },
    addTokens: async (_u, n) => { calls.tokens += n; },
    saveFact: async (f) => { calls.saved.push(f); return { factId: "f1", proposalId: f.kind === "purchase" ? null : "p1", created: true }; },
    setStatus: async (_u, _i, s, w) => { calls.status.push([s, w]); },
    enqueueNotify: async (_u, p) => { calls.notify.push(p); },
  };
  return { d, calls };
}
const job = (o: Partial<Job> = {}): Job => ({ id: "j1", kind: "process", user_id: "u1", payload: { item_id: "i1" }, attempts: 1, checkpoint: null, ...o });

Deno.test("event → proposed; fact via text; tokens counted; status left to save_fact", async () => {
  const { d, calls } = fake({ verdict: { label: "actionable", confidence: 0.99 } });
  assertEquals(await processText(d, job()), "proposed");
  assertEquals([calls.saved.length, calls.saved[0].kind, calls.saved[0].payload.via, calls.tokens, calls.status], [1, "event", "text", 960, []]);
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

// 사용자 결정: 비행동 라벨 + confidence ≥ 0.8 → discarded:server:<label>, 원문 삭제, 추출 없음
Deno.test("gate: personal/promo/otp/notice ≥ 0.8 → discarded:server:<label> with wipe, no extraction", async () => {
  for (const label of ["personal", "promo", "otp", "notice"] as const) {
    const { d, calls } = fake({ verdict: { label, confidence: 0.95 } });
    assertEquals(await processText(d, job()), `discarded:server:${label}`);
    assertEquals([calls.status, calls.extract.length], [[[`discarded:server:${label}`, true]], 0]);
  }
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

Deno.test("notify job enqueued whenever a proposal exists (also on retry), never for purchase", async () => {
  const ev = fake();
  await processText(ev.d, job());
  assertEquals(ev.calls.notify, ["p1"]);
  const buy = fake({ result: BUY_X });
  await processText(buy.d, job());
  assertEquals(buy.calls.notify, []);
});
