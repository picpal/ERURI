import { assertEquals } from "jsr:@std/assert";
import type { BudgetDeps, BudgetKind } from "../functions/_shared/budget.ts";
import type { Job } from "../functions/_shared/job.ts";
import { type EmbedDeps, embedItem } from "../functions/worker/embed.ts";

function fake(src: { contentEnc: string; title: string | null; backfill: boolean } | null) {
  const saved: { text: string; embedding: string }[][] = [];
  const kinds: BudgetKind[] = [];
  let decrypts = 0;
  const budget: BudgetDeps = { reserve: async (_u, k) => { kinds.push(k); return "ok"; }, settle: async () => {}, acquire: async () => 1,
    release: async () => {}, now: () => new Date() };
  const d: EmbedDeps = {
    source: async () => src,
    decrypt: async () => { decrypts++; return "[합성상점] 합성 무선 이어폰 주문 32,000원. 배송 예정 10월 3일."; },
    embed: async (texts) => ({ vectors: texts.map(() => Array(512).fill(0.01)), tokens: 40 }),
    save: async (_u, _i, chunks) => { saved.push(chunks); },
    budget,
  };
  return { d, saved, kinds, decrypts: () => decrypts };
}
const job: Job = { id: "j1", kind: "embed", user_id: "u1", payload: { item_id: "i1" }, attempts: 1, checkpoint: null };

Deno.test("embed: title + body chunked, one vector per chunk, saved once", async () => {
  const { d, saved, kinds } = fake({ contentEnc: "enc", title: "합성 주문 확인", backfill: false });
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
Deno.test("embed: backfill items (source flag or job payload) use the backfill budget", async () => {
  const a = fake({ contentEnc: "enc", title: null, backfill: true });
  await embedItem(a.d, job);
  const b = fake({ contentEnc: "enc", title: null, backfill: false });
  await embedItem(b.d, { ...job, payload: { item_id: "i1", backfill: true } });
  assertEquals([a.kinds, b.kinds], [["backfill"], ["backfill"]]);
});
