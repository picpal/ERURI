import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { TokenUsage } from "../functions/_shared/budget.ts";
import { embedWithUsage } from "../functions/_shared/embeddings.ts";

const got = () => { const xs: (TokenUsage | null)[] = []; return { xs, on: (u: TokenUsage | null) => { xs.push(u); } }; };
// 스펙 §13: 임베딩 응답을 받은 직후(정렬·매핑보다 먼저) 토큰을 넘긴다 — 꺼내기가 실패해도 청구된 토큰이 남는다
Deno.test("embedWithUsage: onUsage fires before data is read — a malformed response still reports its tokens", async () => {
  const g = got();
  const create = async () => ({ usage: { prompt_tokens: 9, total_tokens: 9 }, data: null }) as never;
  await assertRejects(() => embedWithUsage(["합성"], "query", g.on, create), TypeError);
  assertEquals(g.xs, [{ input: 9, cached: 0, output: 0 }]);
});
Deno.test("embedWithUsage: a normal response reports tokens once and returns vectors in index order", async () => {
  const g = got();
  const create = async () => ({ usage: { prompt_tokens: 4, total_tokens: 4 }, data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }] }) as never;
  assertEquals(await embedWithUsage(["가", "나"], "document", g.on, create), { vectors: [[1], [2]], tokens: 4 });
  assertEquals(g.xs, [{ input: 4, cached: 0, output: 0 }]);
});
Deno.test("embedWithUsage: usage missing → onUsage(null) (calls counted, usage_missing)", async () => {
  const g = got();
  const create = async () => ({ data: [{ index: 0, embedding: [1] }] }) as never;
  assertEquals((await embedWithUsage(["가"], "query", g.on, create)).tokens, 0);
  assertEquals(g.xs, [null]);
});
