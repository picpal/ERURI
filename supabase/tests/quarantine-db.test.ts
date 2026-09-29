import { assert, assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, userClient } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 스펙 §7 게이트 폐기 7일 격리·복구
// 복구 잡은 항목의 실행 태그를 물려받아(lease_key 'test:<run>:item:<id>', 0011) 운영 워커가 가져가지 않는다
async function seedDiscarded(user: string, tag: string, expiredDaysAgo = 0): Promise<string> {
  const { data: id, error } = await sb.rpc("insert_item", { p_user: user, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:q:${tag}`, p_sender: null,
    p_title: "합성 제목", p_content_enc: toBytea(await encrypt(user, "ㅋㅋ 합성 잡담")), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  assertEquals(error, null);
  assertEquals((await sb.rpc("worker_record_gate", { p_user: user, p_item: id, p_label: "personal", p_confidence: 0.93 })).error, null);
  assertEquals((await sb.rpc("worker_quarantine_item", { p_user: user, p_item: id, p_status: "discarded:server:personal" })).error, null);
  if (expiredDaysAgo) {
    const up = await sb.from("items").update({ quarantine_until: new Date(Date.now() - expiredDaysAgo * 86_400_000).toISOString() }).eq("id", id);
    assertEquals(up.error, null);
  }
  return id as string;
}

Deno.test("quarantine: body kept 7 days; owner sees meta; restore → queued + run-tagged skip_gate job + wrong_discard; again not_discarded; other user not_found; anon rejected", async () => {
  const { u, c } = await userClient(1);
  const { c: c2 } = await userClient(2);
  const a = await seedDiscarded(u.id, "a");
  try {
    const { data: row } = await sb.from("items").select("status, gate_label, gate_confidence, quarantine_until").eq("id", a).single();
    const { data: body } = await sb.from("items").select("id").eq("id", a).not("content_enc", "is", null);
    assertEquals([row!.status, row!.gate_label, Math.round(row!.gate_confidence * 100), body!.length], ["discarded:server:personal", "personal", 93, 1]);
    assertEquals(Math.round((Date.parse(row!.quarantine_until) - Date.now()) / 86_400_000), 7);
    const { data: list } = await c.from("items").select("id, title, gate_label, gate_confidence").not("quarantine_until", "is", null).eq("id", a);
    assertEquals(list!.length, 1);                                                            // "최근 폐기": RLS 로 자기 행 메타
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
    assert((await anon.rpc("restore_discarded", { p_item: a })).error !== null);             // anon 실행 권한 없음
    assertEquals((await c2.rpc("restore_discarded", { p_item: a })).data, "not_found");
    assertEquals((await c.rpc("restore_discarded", { p_item: a })).data, "queued");
    const { data: jobs } = await sb.from("jobs").select("lease_key, payload").eq("user_id", u.id).eq("payload->>item_id", a);
    assertEquals(jobs!.map((j) => [j.lease_key, j.payload.skip_gate]), [[`${RUN}:item:${a}`, true]]);   // 실행 태그 → 운영 워커 제외
    assertEquals((await sb.from("gate_feedback").select("verdict").eq("item_id", a)).data, [{ verdict: "wrong_discard" }]);
    assertEquals((await c.rpc("restore_discarded", { p_item: a })).data, "not_discarded");
  } finally {
    await deleteRunJobs();
    await sb.from("facts").delete().eq("user_id", u.id).eq("item_id", a);
    await sb.from("items").delete().eq("user_id", u.id).eq("id", a);                           // gate_feedback cascade
  }
});

Deno.test("gate_feedback insert: owner only for own item (RLS)", async () => {
  const { u, c } = await userClient(1);
  const { c: c2 } = await userClient(2);
  const d = await seedDiscarded(u.id, "d");
  try {
    assert((await c2.from("gate_feedback").insert({ item_id: d, verdict: "wrong_pass" })).error !== null);   // 남의 item_id 거부
    assertEquals((await c.from("gate_feedback").insert({ item_id: d, verdict: "wrong_pass" })).error, null);
  } finally {
    await sb.from("items").delete().eq("user_id", u.id).eq("id", d);                           // gate_feedback cascade
  }
});

Deno.test("purge_quarantine (scoped): expired quarantine loses body, keeps row and reason; restore before and after purge → expired", async () => {
  const { u, c } = await userClient(1);
  const b = await seedDiscarded(u.id, "b", 1);
  try {
    assertEquals((await c.rpc("restore_discarded", { p_item: b })).data, "expired");
    assertEquals((await sb.rpc("purge_quarantine", { p_user: u.id })).data, 1);
    const { data } = await sb.from("items").select("status, quarantine_until").eq("id", b).is("content_enc", null).single();
    assertEquals([data!.status, data!.quarantine_until], ["discarded:server:personal", null]);
    assertEquals((await c.rpc("restore_discarded", { p_item: b })).data, "expired");           // 정리 뒤에도 not_discarded 가 아니다
  } finally {
    await sb.from("items").delete().eq("user_id", u.id).eq("id", b);
  }
});
