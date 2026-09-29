import { assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "./_testenv.ts";

// 앱 채팅 인용 👍/👎(M2-⑨a ChatView): POST rest/v1/eval_judgments?on_conflict=user_id,question_id,item_id, merge-duplicates, user_id 는 기본값
Deno.test("eval_judgments: owner upserts 👍/👎 on own item; another user's item rejected (insert and update)", async () => {
  const { u, c } = await userClient(1);
  const { u: u2 } = await userClient(2);
  const mk = async (user: string, tag: string) => (await sb.rpc("insert_item", { p_user: user, p_source: "SHARE", p_idempotency_key: `${RUN}:j:${tag}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(user, "합성")), p_occurred_at: new Date().toISOString(), p_enqueue: false })).data as string;
  const mine = await mk(u.id, "a"), theirs = await mk(u2.id, "b");
  try {
    const q = `${RUN}-q1`;
    assertEquals((await c.from("eval_judgments").upsert({ question_id: q, item_id: mine, ok: true }, { onConflict: "user_id,question_id,item_id" })).error, null);
    assertEquals((await c.from("eval_judgments").upsert({ question_id: q, item_id: mine, ok: false }, { onConflict: "user_id,question_id,item_id" })).error, null);
    assertEquals((await c.from("eval_judgments").select("ok").eq("question_id", q)).data, [{ ok: false }]);
    const bad = await c.from("eval_judgments").insert({ question_id: q, item_id: theirs, ok: true });
    assertEquals(bad.error?.code, "42501");                                                   // RLS
    const moved = await c.from("eval_judgments").update({ item_id: theirs }).eq("question_id", q).eq("item_id", mine);
    assertEquals(moved.error?.code, "42501");                                                 // update 도 자기 항목으로만(0019)
  } finally {
    await sb.from("items").delete().in("id", [mine, theirs]);                                  // judgments cascade
  }
});
