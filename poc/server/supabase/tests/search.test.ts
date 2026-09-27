import { assert, assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../functions/_shared/crypto.ts";
import { embed, embedStats, toPgVector } from "../functions/_shared/embeddings.ts";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const USER = Deno.env.get("POC_USER_ID")!;
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
    p_idempotency_key: "search-test:" + crypto.randomUUID(), p_sender: null, p_title: "합성",
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
