// 배포된 chat 의 의도 판별 하위 호환(스펙 §9 "하위 호환", 계획 A3). 테스트 사용자 19·합성 문구, 항목을 만들지 않는다. 출력은 상태·의도·개수만
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-intent.ts
import { service as sb, userClient } from "../tests/_testenv.ts";

const REG = "합성 치과 예약 10/20 15:00–16:00 캘린더에 등록해줘";
const MAIL = "합성상점에서 온 광고 메일 휴지통에 버려줘";
const started = new Date().toISOString();
const { u, c } = await userClient(19);
try {
  const { data: sess } = await c.auth.getSession();
  const ask = async (body: Record<string, unknown>) => {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/chat`, { method: "POST",
      headers: { authorization: `Bearer ${sess.session!.access_token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "content-type": "application/json" },
      body: JSON.stringify(body) });
    const j = r.status === 200 ? await r.json() as { intent?: string; mail?: unknown; answer: string; hits: string[]; candidates: string[]; schedule: unknown } : null;
    if (!j) await r.body?.cancel();
    return { status: r.status, intent: j?.intent ?? null, mail_null: j ? j.mail === null : null, empty: j ? j.answer === "" && j.hits.length === 0 && j.candidates.length === 0 && j.schedule === null : null };
  };
  const old = await ask({ question: REG });                                          // 0.12.x 앱: 필드 없음 → 질문
  const add = await ask({ question: REG, intents: ["add_event"] });                  // 0.13.0 앱 → add_event, 빈 목록
  const mailNotListed = await ask({ question: MAIL, intents: ["add_event"] });       // 목록에 없는 행동 → 질문
  const mailFlagOn = await ask({ question: MAIL, intents: ["add_event", "mail_action"] });    // MAIL_ACTIONS=on(0.14.0 MAIL-deploy 2026-10-08 부터) → mail_action
  const ok = old.intent === "question" && add.intent === "add_event" && add.empty === true && add.mail_null === true &&
    mailNotListed.intent === "question" && mailFlagOn.intent === "mail_action";
  console.log(JSON.stringify({ gate: ok ? "pass" : "fail", old, add, mailNotListed, mailFlagOn }));
} finally {
  await sb.from("usage_counters").delete().eq("user_id", u.id);
  await sb.from("llm_slots").delete().eq("user_id", u.id);
  await sb.from("audit_log").delete().eq("user_id", u.id).eq("actor", "chat").gte("at", started);
}
