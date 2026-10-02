// 시뮬레이터 게이트(U9) 시드: 테스트 사용자 n(기본 12 — 게이트 전용, 리뷰 N2)에 합성 광고 발신자 6곳. --cleanup 이면 이 시드의 연결·감사 행만 지운다.
// 사용자 12 는 하네스 token.ts(testUser 12 + 로그인 1회)가 먼저 만든다 — 이 스크립트는 비밀번호를 바꾸지 않는다(앱 세션 유지).
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/seed-unsub.ts [--user-n 12] [--cleanup]
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { service as sb, testUserId } from "../tests/_testenv.ts";

const n = Deno.args.includes("--user-n") ? Number(Deno.args[Deno.args.indexOf("--user-n") + 1]) : 12;
if (!Number.isInteger(n) || n < 1) throw new Error("bad --user-n");
const user = await testUserId(n);
const REF = "test-seed-unsub@example.com";
const old = await sb.from("connections").select("id").eq("user_id", user).eq("account_ref", REF);
for (const r of old.data ?? []) {
  const { data: senders } = await sb.from("unsub_senders").select("id").eq("connection_id", r.id);
  for (const s of senders ?? []) await sb.from("audit_log").delete().eq("user_id", user).like("target", `unsub:${s.id}%`);   // 시드 sender 범위(리뷰 M5)
  await sb.from("connections").delete().eq("id", r.id);
}
if (Deno.args.includes("--cleanup")) { console.log(JSON.stringify({ cleanup: true })); Deno.exit(0); }

const key = Deno.env.get("UNSUB_SINK_KEY");
if (!key) { console.error("UNSUB_SINK_KEY 없음(supabase/.env)"); Deno.exit(2); }
const sink = `${Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "")}/functions/v1/unsubscribe/sink/${key}`;
const { data: conn, error } = await sb.from("connections").insert({ user_id: user, provider: "gmail", account_ref: REF, status: "disconnected" }).select("id").single();
if (error) throw new Error("connection " + error.code);
const H = 3_600_000, D = 24 * H;
// 목록 순서(30일 광고 수): s1 12 · s2 5 · s6 4 · s3 3 · s4 2 · s5 1
const senders = [
  { addr: "s1@example.com", name: "합성쇼핑", method: "one_click", url: sink, ads: 12 },
  { addr: "s2@example.com", name: "합성여행", method: "one_click", url: sink + "/redirect", ads: 5 },   // 307 → 실패(따라가지 않음)
  { addr: "s3@example.net", name: "합성메일진", method: "mailto", url: null, ads: 3 },
  { addr: "s4@example.com", name: "합성사설", method: "one_click", url: "https://10.0.0.1/unsub", ads: 2 },
  { addr: "s5@example.com", name: "합성계속", method: "one_click", url: sink, ads: 1 },
  { addr: "s6@example.com", name: "합성위조", method: "unverified", url: null, ads: 4 },                // 서명 확인 실패 → 버튼 없음(G8)
];
const ids: Record<string, string> = {};
for (const s of senders) {
  for (let i = 0; i < s.ads; i++) {
    const { data, error: e } = await sb.rpc("worker_record_unsub", { p_user: user, p_connection: conn!.id, p_address: s.addr, p_name: s.name, p_method: s.method,
      p_url_enc: s.url ? toBytea(await encrypt(user, s.url)) : null, p_msg_key: `seed-unsub:${s.addr}:${i}`,
      p_occurred_at: new Date(Date.now() - (i + 1) * H).toISOString(), p_item: null });
    if (e) throw new Error("record " + e.code);
    ids[s.addr] = data as string;
  }
}
// s5: 5일 전 해지 요청함 → 1시간 전 광고 1통 = 유예(3일) 뒤 → "해지 요청 뒤에도 광고 1통"
await sb.from("unsub_senders").update({ status: "requested", status_at: new Date(Date.now() - 5 * D).toISOString(),
  requested_at: new Date(Date.now() - 5 * D).toISOString(), result_code: "ok", attempts: 1 }).eq("id", ids["s5@example.com"]);
console.log(JSON.stringify({ seeded: senders.length, user_n: n }));
