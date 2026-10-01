// 시뮬레이터 게이트(T9) 시드: 테스트 사용자 항목 n개 × 일정 3(시각 2 + 날짜만 1)을 save_facts 로 저장하고(워커·LLM 없음),
// 서버와 같은 planBundlePush 로 만든 APNs JSON 을 쓴다 — xcrun simctl push <udid> com.picpal.eruri <파일>.
// 사용: deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env supabase/scripts/seed-bundle.ts --user <n> --out <dir> [--items 2] [--days 3]
//       … seed-bundle.ts --user <n> --cleanup <run>
// 사용자는 testUserId(비밀번호 불변 — 앱 세션을 끊지 않는다). 전용 테스트 사용자·실행 태그만, 자기 행만 지운다(AGENTS.md §7). 출력은 run·id 만, 문구는 합성
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { saveFacts } from "../functions/_shared/facts.ts";
import { planBundlePush, planProposalPush, type ProposalRow } from "../functions/_shared/notify.ts";
import { seoulToday } from "../functions/_shared/time.ts";
import { RUN, service as sb, testUserId } from "../tests/_testenv.ts";

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const user = await testUserId(Number(arg("--user") ?? 1));
const cleanup = arg("--cleanup");
if (cleanup) {
  if (!cleanup.startsWith("test:")) throw new Error("cleanup run must be a test: tag");
  const { data: items } = await sb.from("items").select("id").eq("user_id", user).like("idempotency_key", `${cleanup}:%`);
  const ids = (items ?? []).map((r) => r.id as string);
  if (ids.length) {
    await sb.from("facts").delete().eq("user_id", user).in("item_id", ids);   // proposals → proposal_pushes cascade
    await sb.from("items").delete().eq("user_id", user).in("id", ids);
  }
  console.log(JSON.stringify({ cleanup, items: ids.length }));
  Deno.exit(0);
}
const out = arg("--out") ?? ".";
await Deno.mkdir(out, { recursive: true });
const base = Number(arg("--days") ?? 3);
const n = Math.max(1, Number(arg("--items") ?? 1));
const day = (d: number) => new Date(Date.parse(`${seoulToday()}T00:00:00+09:00`) + d * 86_400_000 + 9 * 3600_000).toISOString().slice(0, 10);
const now = new Date();
const write = async (name: string, plan: ReturnType<typeof planBundlePush>) => {
  if (plan.skip !== null) throw new Error("plan " + plan.skip);
  await Deno.writeTextFile(`${out}/${name}`, JSON.stringify({ "Simulator Target Bundle": "com.picpal.eruri", ...plan.payload }));
};
const made: { item_id: string; proposals: (string | null)[] }[] = [];
for (let i = 1; i <= n; i++) {
  const { data: itemId, error } = await sb.rpc("insert_item", { p_user: user, p_source: "MESSAGES", p_idempotency_key: `${RUN}:bundle:${i}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(user, `[합성문화센터] 합성 게이트 시드 ${i}`)), p_occurred_at: now.toISOString(), p_enqueue: false });
  if (error) throw new Error("insert_item " + error.code);
  // 순번 = 시작 순(워커가 만드는 데이터와 같은 불변식 — 대표 = 가장 이른 일정). 항목마다 2주씩 밀어 두 항목의 일정이 겹치지 않게
  const o = base + (i - 1) * 14;
  const entries = [
    { title: `합성 클래스 1회차${i > 1 ? ` ${i}` : ""}`, start: `${day(o)}T14:00:00+09:00` },
    { title: `합성 전시 관람${i > 1 ? ` ${i}` : ""}`, start: day(o + 1) },                    // 날짜만 → REVIEW 카드
    { title: `합성 클래스 2회차${i > 1 ? ` ${i}` : ""}`, start: `${day(o + 7)}T14:00:00+09:00` },
  ].map((e) => ({ payload: { ...e, end: null, location: null, uncertain: [], via: "text" }, evidence: "합성 근거" }));
  const saved = await saveFacts(sb, { userId: user, itemId: itemId as string, kind: "event", entries });
  const { data: rows } = await sb.rpc("worker_get_proposal_bundle", { p_user: user, p_proposal: saved[0].proposalId });
  await write(`bundle-${i}.apns`, planBundlePush(rows as ProposalRow[], now));
  await write(`single-${i}.apns`, planProposalPush((rows as ProposalRow[])[0], now));
  made.push({ item_id: itemId as string, proposals: saved.map((s) => s.proposalId) });
}
console.log(JSON.stringify({ run: RUN, items: made }));
