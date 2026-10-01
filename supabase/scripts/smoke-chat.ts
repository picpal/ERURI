// 배포된 chat 의 후보(스펙 §9, 2026-10-01 검색·캘린더 S1) 스모크. 전용 테스트 사용자·합성 문구만, 출력은 상태·개수·불리언만(AGENTS.md §7)
// 근거 있는 질문: 답함·후보 ≤ 20·인용 ⊆ 후보·근거 3건 모두 후보·무관 12건은 후보 아님. 근거 없는 질문: 거절·후보 0
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-chat.ts
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "../tests/_testenv.ts";

type Reply = { refused: boolean; candidates?: string[]; source_item_ids?: string[]; schedule?: { from: string; to: string } | null };
const { u, c } = await userClient();
const ids: string[] = [], relevant: string[] = [];
async function add(tag: string, title: string, text: string): Promise<string> {
  const { data: id, error } = await sb.rpc("insert_item", { p_user: u.id, p_source: "SHARE", p_idempotency_key: `${RUN}:smokechat:${tag}`,
    p_sender: null, p_title: title, p_content_enc: toBytea(await encrypt(u.id, text)), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  if (error) throw new Error("insert_item " + error.code);
  ids.push(id as string);
  const up = await sb.from("items").update({ status: "extracted" }).eq("user_id", u.id).eq("id", id);
  if (up.error) throw new Error("items " + up.error.code);
  const ch = await sb.from("item_chunks").insert({ item_id: id, user_id: u.id, chunk_index: 0, text: `${title}\n${text}` });
  if (ch.error) throw new Error("item_chunks " + ch.error.code);
  return id as string;
}
try {
  for (let i = 0; i < 3; i++) {
    relevant.push(await add(`r${i}`, `합성스모크치과 안내 ${i}`, `합성스모크치과 스케일링 예약이 ${10 + i}월 ${3 + i}일 오후 ${2 + i}시로 확정되었습니다`));
  }
  for (let i = 0; i < 12; i++) await add(`n${i}`, `스모크잡담 ${i}`, `스모크잡담 오늘 날씨 맑음 ${i}`);
  const { data: sess } = await c.auth.getSession();
  const ask = async (question: string) => {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/chat`, { method: "POST",
      headers: { authorization: `Bearer ${sess.session!.access_token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({ question }) });
    return { status: r.status, j: (await r.json()) as Reply };
  };
  const a = await ask("합성스모크치과 스케일링 예약 언제야");
  const ac = a.j.candidates ?? [];
  const b = await ask("합성스모크치과 화성 탐사선 발사 일정");
  console.log(JSON.stringify({
    answered: { status: a.status, refused: a.j.refused, candidates: ac.length, relevant: relevant.filter((id) => ac.includes(id)).length,
      noise: ac.filter((id) => !relevant.includes(id)).length, cited_subset: (a.j.source_item_ids ?? []).every((id) => ac.includes(id)) },
    unanswered: { status: b.status, refused: b.j.refused, candidates: (b.j.candidates ?? []).length },
  }));
} finally {
  await sb.from("items").delete().eq("user_id", u.id).in("id", ids);                  // chunks cascade
  await sb.from("usage_counters").delete().eq("user_id", u.id);
  await sb.from("llm_slots").delete().eq("user_id", u.id);
}
