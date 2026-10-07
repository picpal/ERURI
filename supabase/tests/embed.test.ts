import { assert, assertEquals } from "jsr:@std/assert";
import type { BudgetDeps, BudgetKind } from "../functions/_shared/budget.ts";
import type { Job } from "../functions/_shared/job.ts";
import { type EmbedDeps, embedItem } from "../functions/worker/embed.ts";

const BODY = "[합성상점] 합성 무선 이어폰 주문 32,000원. 배송 예정 10월 3일.";
function fake(src: { contentEnc: string; title: string | null } | null, body = BODY,
  reserve: (k: BudgetKind) => "ok" | "refused" = () => "ok") {
  const saved: { text: string; embedding: string }[][] = [];
  const kinds: BudgetKind[] = [];
  const batches: number[] = [];
  const settled: number[] = [];
  let decrypts = 0;
  const lines: [string, number][][] = [];
  const budget: BudgetDeps = { reserve: async (_u, k) => { kinds.push(k); return { level: reserve(k), month: "2026-10-01" }; },
    settle: async (_u, _k, _e, _m, ls) => { settled.push(ls.reduce((a, l) => a + l.krw, 0)); lines.push(ls.map((l) => [l.kind, l.input])); },
    acquire: async () => 1, release: async () => {}, now: () => new Date() };
  const d: EmbedDeps = {
    source: async () => src,
    decrypt: async () => { decrypts++; return body; },
    embed: async (texts, onUsage) => { batches.push(texts.length); onUsage?.({ input: 40, cached: 0, output: 0 }); return { vectors: texts.map(() => Array(512).fill(0.01)), tokens: 40 }; },
    save: async (_u, _i, chunks) => { saved.push(chunks); },
    budget,
  };
  return { d, saved, kinds, batches, settled, lines, decrypts: () => decrypts };
}
const job: Job = { id: "j1", kind: "embed", user_id: "u1", payload: { item_id: "i1" }, attempts: 1, checkpoint: null };

Deno.test("embed: title + body chunked, one vector per chunk, saved once", async () => {
  const { d, saved, kinds } = fake({ contentEnc: "enc", title: "합성 주문 확인" });
  assertEquals(await embedItem(d, job), "embedded");
  assertEquals(saved.length, 1);
  assertEquals(saved[0][0].text.startsWith("합성 주문 확인\n"), true);
  assertEquals(saved[0][0].embedding.startsWith("["), true);
  assertEquals(kinds, ["embed"]);                                                      // 월 예산
});
Deno.test("embed: nothing to embed (already chunked / not eligible) → skipped without decrypt", async () => {
  const { d, saved, decrypts } = fake(null);
  assertEquals(await embedItem(d, job), "skipped");
  assertEquals([saved.length, decrypts()], [0, 0]);
});
// Ruling E: 백필 항목(백로그·Gmail 90일)도 임베딩은 월 예산 — 추출이 백필 예산을 다 써도 검색 인덱스가 다음 달까지 비지 않는다
Deno.test("embed: backfill job embeds on the monthly budget even when the backfill budget is exhausted", async () => {
  const { d, saved, kinds } = fake({ contentEnc: "enc", title: null }, BODY, (k) => (k === "backfill" ? "refused" : "ok"));
  assertEquals(await embedItem(d, { ...job, payload: { item_id: "i1", backfill: true } }), "embedded");
  assertEquals([kinds, saved.length], [["embed"], 1]);
});
// 큰 본문: 한 요청 입력 2,048개·30만 토큰 한도 → 256청크씩 나눠 보내고 한 번 예약·합산 정산
Deno.test("embed: large body is sent in batches of ≤256 chunks, one reservation, tokens summed", async () => {
  const { d, saved, kinds, batches, settled } = fake({ contentEnc: "enc", title: null }, "가".repeat(512 * 600));
  assertEquals(await embedItem(d, job), "embedded");
  assertEquals(batches, [256, 256, 88]);
  assertEquals([kinds.length, saved[0].length, saved[0][599].text.length], [1, 600, 512]);
  assert(settled[0] > 0);
});
// 규칙 재적용(스펙 §12 통제 2): ingest 뒤 규칙이 바뀌어도 모델·평문 청크에는 지금 규칙으로 마스킹한 본문만
Deno.test("embed: rules re-applied — card masked in chunks, OTP body not embedded", async () => {
  const card = fake({ contentEnc: "enc", title: "합성 결제" }, "카드 4532-0151-1283-0366 승인 32,000원");
  assertEquals(await embedItem(card.d, job), "embedded");
  assertEquals(card.saved[0][0].text, "합성 결제\n카드 ****-****-****-0366 승인 32,000원");
  const otp = fake({ contentEnc: "enc", title: "합성 인증" }, "[합성은행] 인증번호 482913 을 입력하세요.");
  assertEquals(await embedItem(otp.d, job), "skipped");
  assertEquals([otp.saved.length, otp.kinds.length], [0, 0]);
});
Deno.test("embed billing: one embed line per batch call (3 batches → 3 lines, tokens per batch)", async () => {
  const { d, lines } = fake({ contentEnc: "enc", title: null }, "가".repeat(512 * 600));
  await embedItem(d, job);
  assertEquals(lines, [[["embed", 40], ["embed", 40], ["embed", 40]]]);
});
