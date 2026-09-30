// 배포된 chat 의 검색 후보(R-A1) 스모크. 전용 테스트 사용자·합성 문구만, 출력은 상태·개수·불리언만(AGENTS.md §7)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-chat.ts
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "../tests/_testenv.ts";

const { u, c } = await userClient();
const ids: string[] = [];
try {
  for (let i = 0; i < 14; i++) {
    const { data: id, error } = await sb.rpc("insert_item", { p_user: u.id, p_source: "SHARE", p_idempotency_key: `${RUN}:smokechat:${i}`,
      p_sender: null, p_title: `합성스모크 ${i}`, p_content_enc: toBytea(await encrypt(u.id, `합성스모크단어 ${i}`)),
      p_occurred_at: new Date().toISOString(), p_enqueue: false });
    if (error) throw new Error("insert_item " + error.code);
    ids.push(id as string);
    const up = await sb.from("items").update({ status: "extracted" }).eq("user_id", u.id).eq("id", id);
    if (up.error) throw new Error("items " + up.error.code);
    const ch = await sb.from("item_chunks").insert({ item_id: id, user_id: u.id, chunk_index: 0, text: `합성스모크 ${i}\n합성스모크단어 ${i}` });
    if (ch.error) throw new Error("item_chunks " + ch.error.code);
  }
  const { data: sess } = await c.auth.getSession();
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/chat`, { method: "POST",
    headers: { authorization: `Bearer ${sess.session!.access_token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "content-type": "application/json" },
    body: JSON.stringify({ question: "합성스모크단어 목록" }) });
  const j = await r.json();
  const cands: string[] = j.candidates ?? [], hits: string[] = j.hits ?? [];
  console.log(JSON.stringify({ status: r.status, hits: hits.length, candidates: cands.length,
    seeded_in_candidates: ids.filter((id) => cands.includes(id)).length, hits_subset: hits.every((h) => cands.includes(h)) }));
} finally {
  await sb.from("items").delete().eq("user_id", u.id).in("id", ids);                  // chunks cascade
  await sb.from("usage_counters").delete().eq("user_id", u.id);
  await sb.from("llm_slots").delete().eq("user_id", u.id);
}
