// USAGE-deploy(스펙 §15, 계획 D1): 배포된 worker·chat 이 usage_ledger 에 기록하고 월 합계(reserved_krw)와 맞는지. 테스트 사용자 22 전용,
// 이번 실행 증가분만 되돌린다(D17). 출력은 kind·model·숫자·불리언만 — 표식어·질문 글 없음. 서울 자정 ±10분 밖에서 돌린다
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-usage.ts
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "../tests/_testenv.ts";
import { diffUsage, restoreUsage, snapshotUsage, type UsageRow } from "./_usage-snapshot.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const { u, c } = await userClient(22);
const { c: other } = await userClient(23);
const marker = "ERURIUSAGE" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const started = new Date().toISOString();
const s0 = await snapshotUsage(u.id);
const out: Record<string, unknown> = {};
let itemId: string | null = null;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const BUDGET = new Set(["chat", "mail_summary", "extract", "embed"]);
const budgetKrw = (d: UsageRow[]) => d.filter((r) => BUDGET.has(r.kind)).reduce((a, r) => a + r.krw, 0);
const rpcAs = async (client: typeof c) => { const { data, error } = await client.rpc("usage_breakdown"); return error ? { error: error.code } : { rows: data as Record<string, unknown>[] }; };
try {
  // ① 합성 항목(SHARE — 게이트 생략) → 워커가 추출·청크 임베딩까지 마칠 때까지(제한 4분 — 넘으면 실패)
  const { data: id, error } = await sb.rpc("insert_item", { p_user: u.id, p_source: "SHARE", p_idempotency_key: `${RUN}:usage`, p_sender: null, p_title: "합성 안내",
    p_content_enc: toBytea(await encrypt(u.id, `합성상점 주문 ${marker} 배송 예정 합성 안내입니다.`)), p_occurred_at: new Date().toISOString() });
  if (error) throw new Error("insert_item " + error.code);
  itemId = id as string;
  let indexed = false;
  for (let t = 0; t < 240 && !indexed; t += 10) {
    await new Promise((r) => setTimeout(r, 10_000));
    const { count } = await sb.from("item_chunks").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("item_id", itemId).not("embedding", "is", null);
    indexed = (count ?? 0) > 0;
  }
  out.indexed = indexed;
  if (!indexed) throw new Error("not_indexed");
  const s1 = await snapshotUsage(u.id);
  const w = diffUsage(s0, s1);
  out.worker = { rows: w.map((r) => [r.kind, r.model, r.calls]), reserved_matches: near(s1.reserved - s0.reserved, budgetKrw(w)),
    extract: w.some((r) => r.kind === "extract" && r.calls >= 1), embed: w.some((r) => r.kind === "embed" && r.calls >= 1) };
  // ② chat 1회 — 기간 없는 표식어 질문(키워드 검색이 그 항목을 찾아 답변 모델을 부르게)
  const otherBefore = await rpcAs(other);
  const { data: sess } = await c.auth.getSession();
  const res = await fetch(`${URL_}/functions/v1/chat`, { method: "POST", headers: { authorization: `Bearer ${sess.session!.access_token}`, apikey: ANON,
    "content-type": "application/json" }, body: JSON.stringify({ question: `${marker} 주문 배송 안내 내용 알려줘` }) });
  const j = res.status === 200 ? await res.json() as { hits: string[] } : null;
  if (!j) await res.body?.cancel();
  const s2 = await snapshotUsage(u.id);
  const d = diffUsage(s1, s2);
  const has = (model: string) => d.some((r) => r.kind === "chat" && r.model === model && r.calls >= 1 && r.input_tokens > 0);
  // ③ 답변 모델을 불렀다 = 문서가 있었다(hits > 0) + (chat, gpt-6-sol 또는 강등 luna 두 번째 호출) 행. 응답에는 model 칸이 없다(계획 "스펙과 다르게 정한 곳" 4)
  const answered = (j?.hits.length ?? 0) > 0 && (has("gpt-6-sol") || d.some((r) => r.kind === "chat" && r.model === "gpt-6-luna" && r.calls >= 2));
  out.chat = { status: res.status, answered, filter: has("gpt-6-luna"), embedding: has("text-embedding-3-large"),
    reserved_matches: near(s2.reserved - s1.reserved, budgetKrw(d)), only_chat: d.every((r) => r.kind === "chat") };
  // ④ usage_breakdown: 본인 = S2, 다른 테스트 사용자 = 변화 없음, anon = 거부
  const mine = await rpcAs(c);
  const asRow = (r: Record<string, unknown>) => `${r.kind}|${r.model}|${Number(r.calls)}|${Number(r.input_tokens)}|${Number(r.output_tokens)}|${Number(r.krw).toFixed(4)}`;
  const want = s2.rows.map((r) => asRow(r as unknown as Record<string, unknown>)).sort();
  const anon = await fetch(`${URL_}/rest/v1/rpc/usage_breakdown`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json" }, body: "{}" });
  await anon.body?.cancel();
  out.breakdown = { mine: "rows" in mine && JSON.stringify(mine.rows!.map(asRow).sort()) === JSON.stringify(want),
    other_unchanged: JSON.stringify(await rpcAs(other)) === JSON.stringify(otherBefore), anon_denied: anon.status === 401 || anon.status === 403 || anon.status === 404 };
  const ok = out.indexed === true && Object.values(out.worker as Record<string, unknown>).slice(1).every((x) => x === true) &&
    Object.entries(out.chat as Record<string, unknown>).every(([k, x]) => k === "status" ? x === 200 : x === true) &&
    Object.values(out.breakdown as Record<string, unknown>).every((x) => x === true);
  console.log(JSON.stringify({ gate: ok ? "pass" : "fail", ...out }));
} finally {
  // ⑤ 이번 실행 증가분만 되돌린다 — 합성 항목(RUN 태그)·그 잡·이번 실행의 chat 감사·슬롯
  if (itemId) {
    await sb.from("jobs").delete().eq("user_id", u.id).eq("payload->>item_id", itemId);
    await sb.from("items").delete().eq("user_id", u.id).eq("id", itemId);
  }
  await sb.from("audit_log").delete().eq("user_id", u.id).in("actor", ["chat", "worker"]).gte("at", started);
  await sb.from("llm_slots").delete().eq("user_id", u.id);
  await restoreUsage(u.id, s0);
}
