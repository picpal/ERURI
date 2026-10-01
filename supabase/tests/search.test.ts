import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { embed, embedStats, toPgVector } from "../functions/_shared/embeddings.ts";
import { RUN, service as sb, testUser } from "./_testenv.ts";
// 전용 테스트 사용자만 쓴다(실측 사용자 데이터 보호)
const USER = (await testUser()).id;
type Hit = { item_id: string; chunk_id: string; score: number; sem_sim: number | null; kw_score: number | null };

// 스펙 §16: 임베딩은 합성 문구에만 호출한다
Deno.test("embed returns 512-dim unit vectors in input order and counts tokens (synthetic text only)", async () => {
  const before = embedStats.tokens;
  const v = await embed(["안녕하세요", "합성 문구: 치과 스케일링 예약"], "document");
  assertEquals(v.length, 2);
  assertEquals(v[0].length, 512);
  for (const x of v) assert(Math.abs(Math.sqrt(x.reduce((a, y) => a + y * y, 0)) - 1) < 1e-3);   // dimensions 축소 후에도 길이 1
  assert(embedStats.tokens > before);
  assertEquals(toPgVector([0.5, -1, 0]), "[0.5,-1,0]");
});

async function seed(text: string, embedding: number[] | null) {
  const { data: itemId, error } = await sb.rpc("insert_item", { p_user: USER, p_source: "SHARE",
    p_idempotency_key: `${RUN}:search:${crypto.randomUUID()}`, p_sender: null, p_title: "합성",
    p_content_enc: toBytea(await encrypt(USER, text)), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  assertEquals(error, null);
  const c = await sb.from("item_chunks").insert({ item_id: itemId, user_id: USER, chunk_index: 0, text,
    embedding: embedding ? toPgVector(embedding) : null });
  assertEquals(c.error, null);
  return itemId as string;
}

Deno.test("hybrid_search works with p_embedding null (keyword/trigram only)", async () => {
  const text = "합성 문구: 무선 이어폰 주문 확인, 주문번호 T-4821, 결제 39,000원";
  const itemId = await seed(text, null);
  const { data, error } = await sb.rpc("hybrid_search", { p_user: USER, p_query: "무선 이어폰 주문", p_embedding: null, p_limit: 5 });
  assertEquals(error, null);
  const hit = (data as Hit[]).find((r) => r.item_id === itemId);
  assert(hit && hit.score > 0 && hit.sem_sim === null && hit.kw_score! > 0);
  await sb.from("items").delete().eq("id", itemId);                   // 청크는 cascade
});

Deno.test("hybrid_search fuses the semantic path when an embedding is given, and scopes by user", async () => {
  const text = "합성 문구: 다음 주 화요일 오후 2시 서울치과 스케일링 예약이 확정되었습니다";
  const [e] = await embed([text], "document");
  const itemId = await seed(text, e);
  const [q] = await embed(["이 닦으러 가는 병원 약속 언제였지"], "query");   // 키워드가 겹치지 않는 질의
  const { data, error } = await sb.rpc("hybrid_search", { p_user: USER, p_query: "이 닦으러 가는 병원 약속 언제였지", p_embedding: toPgVector(q), p_limit: 5 });
  assertEquals(error, null);
  const hit = (data as Hit[]).find((r) => r.item_id === itemId);
  assert(hit && hit.sem_sim !== null && hit.sem_sim > 0);
  const other = await sb.rpc("hybrid_search", { p_user: crypto.randomUUID(), p_query: "스케일링", p_embedding: toPgVector(q), p_limit: 5 });
  assertEquals(other.data, []);
  await sb.from("items").delete().eq("id", itemId);
});

// 2026-10-01 검색·캘린더 S2: 숫자가 든 어절은 숫자로 끝나는 변형을 만들지 않는다(10월 → 10, 10은 → 10 금지).
// 예외: 3자 이상 원형에서 조사를 뗀 경우(1234는 → 1234, Codex #3). 10월에 → 10월, 한글 어절의 조사 떼기는 그대로. 맨숫자 1~2자리 토큰(10/3 의 10)은 버린다(Fable N6)
Deno.test("hybrid_search: numeric tokens do not shrink to bare numbers except a dropped particle; bare 1-2 digit tokens ignored; Hangul particles still drop", async () => {
  const a = await seed("합성 문구: 모임알파 10월 3일 저녁 7시", null);
  const b = await seed("합성 문구: 결제베타 10,500원 승인 10:30", null);
  const c = await seed("합성 문구: 치과예약감마 안내", null);
  const d = await seed("합성 문구: 주문델타 번호 1234 배송 시작", null);
  try {
    const found = async (q: string) =>
      new Set(((await sb.rpc("hybrid_search", { p_user: USER, p_query: q, p_embedding: null, p_limit: 20 })).data as Hit[]).map((r) => r.item_id));
    const oct = await found("10월 3일 일정");
    assert(oct.has(a), "10월·3일 원형은 맞는다");
    assert(!oct.has(b), "10월 → 10 변형이 10,500원·10:30 에 맞으면 안 된다");
    const particle = await found("10월에");
    assert(particle.has(a) && !particle.has(b), "10월에 → 10월 은 허용, 10 은 금지");
    assert((await found("치과예약감마는")).has(c), "한글 어절 끝 글자 떼기 유지");
    assert((await found("1234는")).has(d), "1234는 → 1234 허용(3자 이상 원형 + 조사)");
    assert(!(await found("10은")).has(b), "10은 → 10 금지(원형 2자)");
    assert(!(await found("10/3 모임")).has(b), "맨숫자 토큰 10 은 버린다");
  } finally {
    await sb.from("items").delete().eq("user_id", USER).in("id", [a, b, c, d]);       // 청크는 cascade
  }
});
