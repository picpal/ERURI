import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { LedgerKind, TokenUsage } from "../functions/_shared/budget.ts";
import { queryEmbedder } from "../functions/chat/query-vector.ts";

// 실제 어댑터(embedWithUsage)처럼 응답을 받은 직후 onUsage 를 부르고 그 뒤 벡터를 꺼낸다. fail = 응답 없음(네트워크), badData = 응답은 왔지만 꺼내기 실패
function fakeEmbed(fail: false | "network" | "badData" = false) {
  const calls: string[][] = [];
  const embed = async (texts: string[], onUsage?: (u: TokenUsage | null) => void) => {
    calls.push(texts);
    if (fail === "network") throw new TypeError("fetch failed");
    onUsage?.({ input: 7, cached: 0, output: 0 });
    if (fail === "badData") throw new TypeError("embedding data missing");
    return { vectors: texts.map(() => [0.1, 0.2]), tokens: 7 };
  };
  return { embed, calls };
}
const billed = () => { const xs: [LedgerKind, string, TokenUsage | null][] = []; return { xs, bill: (k: LedgerKind, m: string, u: TokenUsage | null) => { xs.push([k, m, u]); } }; };

// 스펙 §13 "채팅 검색 질의 임베딩": 기간 폴백 재검색이 같은 문장의 벡터를 재사용하면 원소를 더 쌓지 않는다(API 호출 1번 = 원소 1개)
Deno.test("queryEmbedder: same text twice → one API call, one chat line for text-embedding-3-large", async () => {
  const { embed, calls } = fakeEmbed();
  const qv = queryEmbedder(embed);
  const b = billed();
  assertEquals(await qv("합성 질문", b.bill), [0.1, 0.2]);
  assertEquals(await qv("합성 질문", b.bill), [0.1, 0.2]);
  assertEquals(calls.length, 1);
  assertEquals(b.xs, [["chat", "text-embedding-3-large", { input: 7, cached: 0, output: 0 }]]);
});
Deno.test("queryEmbedder: a different text calls again and bills again", async () => {
  const { embed, calls } = fakeEmbed();
  const qv = queryEmbedder(embed);
  const b = billed();
  await qv("가", b.bill); await qv("나", b.bill);
  assertEquals([calls.length, b.xs.length], [2, 2]);
});
// D13: 앞 요청이 만든 벡터를 재사용한 요청은 API 를 부르지 않았으므로 비용이 없다
Deno.test("queryEmbedder: a later request reusing the cached vector bills nothing", async () => {
  const { embed } = fakeEmbed();
  const qv = queryEmbedder(embed);
  const first = billed(), second = billed();
  await qv("같은 질문", first.bill);
  await qv("같은 질문", second.bill);
  assertEquals([first.xs.length, second.xs.length], [1, 0]);
});
Deno.test("queryEmbedder: an embedding failure without a response bills nothing and is not cached", async () => {
  const bad = fakeEmbed("network");
  const qv = queryEmbedder(bad.embed);
  const b = billed();
  await assertRejects(() => qv("합성", b.bill), TypeError);
  await assertRejects(() => qv("합성", b.bill), TypeError);
  assertEquals([bad.calls.length, b.xs.length], [2, 0]);
});
// 스펙 §13 "응답이 온 실패도 청구된 토큰": 응답은 왔는데 벡터를 못 꺼내면 원소는 남고 캐시는 비운다(Codex 계획 리뷰 2)
Deno.test("queryEmbedder: a response that fails after arriving is billed once per call and is not cached", async () => {
  const bad = fakeEmbed("badData");
  const qv = queryEmbedder(bad.embed);
  const b = billed();
  await assertRejects(() => qv("합성", b.bill), TypeError);
  await assertRejects(() => qv("합성", b.bill), TypeError);
  assertEquals([bad.calls.length, b.xs.length], [2, 2]);
});
