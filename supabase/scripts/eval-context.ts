// CTX-eval: 배포된 chat 의 짧은 맥락(스펙 §9). 테스트 사용자 17·합성 항목만, 출력은 사례·상태·인용 태그·거절 여부·miss 종류만(AGENTS.md §7)
// 청크 임베딩은 넣지 않는다(smoke-chat 선례) — hybrid_search 의 키워드 경로만 검증된다(gates 행에 명시)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-context.ts --runs 3
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "../tests/_testenv.ts";
import { CASES, contextOf, ITEMS, judge, type Reply, type Row, summarize } from "./_context-eval.ts";

const runs = Number(Deno.args[Deno.args.indexOf("--runs") + 1] || 1);
const started = new Date().toISOString();
const { u, c } = await userClient(17);
const tagOf = new Map<string, string>();
async function add(tag: string, title: string, text: string) {
  const { data: id, error } = await sb.rpc("insert_item", { p_user: u.id, p_source: "SHARE", p_idempotency_key: `${RUN}:ctxeval:${tag}`,
    p_sender: null, p_title: title, p_content_enc: toBytea(await encrypt(u.id, text)), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  if (error) throw new Error("insert_item " + error.code);
  tagOf.set(id as string, tag);
  const up = await sb.from("items").update({ status: "extracted" }).eq("user_id", u.id).eq("id", id);
  if (up.error) throw new Error("items " + up.error.code);
  const ch = await sb.from("item_chunks").insert({ item_id: id, user_id: u.id, chunk_index: 0, text: `${title}\n${text}` });
  if (ch.error) throw new Error("item_chunks " + ch.error.code);
}
try {
  for (const i of ITEMS) await add(i.tag, i.title, i.text);
  const { data: sess } = await c.auth.getSession();
  const ask = async (question: string, context?: { question: string; answer: string }[]): Promise<Reply> => {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/chat`, { method: "POST",
      headers: { authorization: `Bearer ${sess.session!.access_token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "content-type": "application/json" },
      body: JSON.stringify(context ? { question, context } : { question }) });
    const j = r.status === 200 ? await r.json() as { answer: string; refused: boolean; source_item_ids: string[] } : null;
    if (!j) await r.body?.cancel();
    return { status: r.status, refused: j?.refused ?? true, cited: (j?.source_item_ids ?? []).map((id) => tagOf.get(id) ?? "other"), answer: j?.answer ?? "" };
  };
  const rows: Row[] = [];
  for (let run = 1; run <= runs; run++) {
    for (const k of CASES) {
      const a = await ask(k.first);
      const b = await ask(k.second, k.withContext ? contextOf(k.first, k.contextAnswer ?? a.answer) : undefined);
      const miss = judge(k, a, b);
      rows.push({ case: k.id, judged: k.judged, miss, secondRefused: b.refused });
      // 답 글은 찍지 않는다 — 상태·거절·인용 태그·miss 종류만(fact·poison 판정도 불리언으로만 남는다)
      console.log(JSON.stringify({ run, case: k.id, judged: k.judged, first: { status: a.status, refused: a.refused, cited: a.cited },
        second: { status: b.status, refused: b.refused, cited: b.cited }, miss }));
    }
  }
  console.log(JSON.stringify(summarize(rows, runs)));
} finally {
  await sb.from("items").delete().eq("user_id", u.id).in("id", [...tagOf.keys()]);          // chunks cascade
  await sb.from("usage_counters").delete().eq("user_id", u.id);
  await sb.from("llm_slots").delete().eq("user_id", u.id);
  await sb.from("audit_log").delete().eq("user_id", u.id).eq("actor", "chat").gte("at", started);
}
