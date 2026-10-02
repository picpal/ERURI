// 광고 구독 해지 배포 실측(계획 U6a). 테스트 사용자 11(스모크 전용, 리뷰 N2) + 실행 태그 연결(disconnected)에 합성 발신자를 기록하고
// 배포된 unsubscribe 함수를 사용자 JWT 로 부른다. 끝나면 자기 행만 지운다(연결 cascade, audit 는 자기 sender id 범위 — 리뷰 M5).
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-unsub.ts
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "../tests/_testenv.ts";

const base = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "");
const key = Deno.env.get("UNSUB_SINK_KEY");
if (!key) { console.error("UNSUB_SINK_KEY 없음(supabase/.env)"); Deno.exit(2); }
const sink = `${base}/functions/v1/unsubscribe/sink/${key}`;
const { u, c } = await userClient(11);
const jwt = (await c.auth.getSession()).data.session!.access_token;
const { data: conn, error } = await sb.from("connections").insert({ user_id: u.id, provider: "gmail", account_ref: `${RUN}-smoke@example.com`, status: "disconnected" })
  .select("id").single();
if (error) throw new Error("connection " + error.code);
// optional: 외부 와일드카드 DNS(sslip.io)가 이름을 사설 주소로 푸는 경로(리뷰 N9). 그 서비스가 안 되면 dns_error 일 수 있어 판정에서 뺀다
const cases = [
  { addr: "sink@example.com", url: sink, want: ["requested", "ok"], optional: false },
  { addr: "redirect@example.com", url: sink + "/redirect", want: ["failed", "redirect_307"], optional: false },   // 따라가지 않는다(리뷰 M1)
  { addr: "private@example.com", url: "https://10.0.0.1/unsub", want: ["failed", "blocked_private"], optional: false },
  { addr: "scheme@example.com", url: "http://u.example.com/unsub", want: ["failed", "blocked_scheme"], optional: false },
  { addr: "mailto@example.com", url: null, want: ["unsupported", undefined], optional: false },
  { addr: "rebind@example.com", url: "https://10-0-0-1.sslip.io/unsub", want: ["failed", "blocked_private"], optional: true },
] as const;
const out: Record<string, unknown> = {};
let pass = true;
try {
  for (const k of cases) {
    const { data: id, error: e } = await sb.rpc("worker_record_unsub", { p_user: u.id, p_connection: conn!.id, p_address: k.addr, p_name: "합성 스모크",
      p_method: k.url ? "one_click" : "mailto", p_url_enc: k.url ? toBytea(await encrypt(u.id, k.url)) : null,
      p_msg_key: `${RUN}:${k.addr}`, p_occurred_at: new Date().toISOString(), p_item: null });
    if (e) throw new Error("record " + e.code);
    const r = await fetch(base + "/functions/v1/unsubscribe", { method: "POST",
      headers: { authorization: "Bearer " + jwt, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({ sender_id: id }) });
    const j = await r.json().catch(() => ({})) as { result?: string; code?: string };
    const ok = r.status === 200 && j.result === k.want[0] && j.code === k.want[1];
    if (!k.optional) pass &&= ok;
    out[k.addr.split("@")[0]] = { status: r.status, result: j.result, code: j.code, ok, ...(k.optional ? { optional: true } : {}) };
  }
  // 키 없는 sink 는 닫혀 있다(리뷰 N10)
  const closed = await fetch(base + "/functions/v1/unsubscribe/sink", { method: "POST", body: "List-Unsubscribe=One-Click",
    headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")! } });
  await closed.body?.cancel();
  out.sink_closed = closed.status;
  pass &&= closed.status === 404;
  const { data: list } = await c.rpc("unsub_list");
  out.list = (list ?? []).map((r: { status: string; method: string }) => `${r.method}:${r.status}`).sort();
  console.log(JSON.stringify({ gate: pass ? "pass" : "fail", ...out }));
} finally {
  const { data: senders } = await sb.from("unsub_senders").select("id").eq("connection_id", conn!.id);
  for (const s of senders ?? []) await sb.from("audit_log").delete().eq("user_id", u.id).like("target", `unsub:${s.id}%`);
  await sb.from("connections").delete().eq("user_id", u.id).eq("id", conn!.id);
}
if (!pass) Deno.exit(1);
