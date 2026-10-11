// EDIT-deploy(스펙 §15, 계획 D1·K4): 배포된 ingest 경로(insert_item SHARE·채팅 + process 잡 + worker lease) → 배포된 chat edit_event → 0033 버전 규칙을
// 테스트 사용자 22 로 확인한다. 실제 gpt-6-luna(추출·필터) 호출 — 합성 문구만. 출력은 단계·상태 코드·불리언·개수만(글·값 없음).
// 끝에 이 실행의 행만 지우고 사용자 22 의 이번 달 사용 집계를 시작 값으로 되돌린다(이 실행 동안 사용자 22 를 쓰는 다른 실행이 없다 — D1 Step 1)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-edit.ts
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, userClient } from "../tests/_testenv.ts";

type P = { id: string; action: string; status: string; version: number; payload: Record<string, unknown>; eventkit_id: string | null };
const BASE = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTENTS = ["add_event", "mail_action", "mail_summary", "edit_event"];
const { u, c } = await userClient(22);
const STARTED = new Date().toISOString();
const seoulDay = (offset: number) => new Date(Date.now() + 9 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
let item = "", failures = 0;
const check = (step: string, ok: boolean, extra: Record<string, unknown> = {}) => { if (!ok) failures++; console.log(JSON.stringify({ step, ok, ...extra })); };
const { data: month } = await sb.rpc("seoul_month");
const ledger0 = ((await sb.from("usage_ledger").select("kind, model, calls, input_tokens, cached_tokens, output_tokens, krw").eq("user_id", u.id).eq("month", month)).data ?? []) as Record<string, unknown>[];
const counter0 = (await sb.from("usage_counters").select("reserved_krw").eq("user_id", u.id).eq("month", month).maybeSingle()).data as { reserved_krw: number } | null;
const versions = async () => ((await sb.from("facts").select("id, payload, proposals(id, action, status, version, payload, eventkit_id)")
  .eq("user_id", u.id).eq("item_id", item).eq("kind", "event").eq("status", "active")).data ?? []) as { id: string; payload: Record<string, unknown>; proposals: P[] }[];
async function chat(question: string, editTarget: string | null) {
  const { data: s } = await c.auth.getSession();
  const r = await fetch(`${BASE}/functions/v1/chat`, { method: "POST", headers: { authorization: `Bearer ${s.session!.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ question, intents: INTENTS, ...(editTarget ? { edit_target: editTarget } : {}) }) });
  return { status: r.status, body: await r.json() as { intent?: string; edit?: { status: string; action: string | null } | null } };
}
try {
  // ① 등록: 앱 채팅 등록과 같은 SHARE·채팅 항목(occurred_at = 지금) → 배포된 worker 추출(테스트 lease)
  const { data: id, error } = await sb.rpc("insert_item", { p_user: u.id, p_source: "SHARE", p_idempotency_key: `${RUN}:smokeedit`, p_sender: null,
    p_title: null, p_content_enc: toBytea(await encrypt(u.id, "모레 11시부터 15시까지 합성 미팅 등록해줘")), p_occurred_at: new Date().toISOString(),
    p_enqueue: false, p_app_name: "채팅" });
  if (error || !id) throw new Error("insert_item " + (error?.code ?? "null"));
  item = id as string;
  const e = await sb.rpc("enqueue_job", { p_user: u.id, p_kind: "process", p_lease_key: `${RUN}:process:edit`, p_payload: { item_id: item } });
  if (e.error) throw new Error("enqueue_job " + e.error.code);
  for (let i = 0; i < 6; i++) {
    const w = await fetch(`${BASE}/functions/v1/worker`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ lease_prefix: RUN }) });
    await w.body?.cancel();
    if ((await sb.from("items").select("status").eq("id", item).single()).data?.status !== "queued") break;
  }
  let f = await versions();
  check("register", f.length === 1 && f[0].proposals.length === 1 && String(f[0].proposals[0].payload.start ?? "").startsWith(seoulDay(2)), { facts: f.length });
  const v1 = f[0].proposals[0];
  // ② 추가 전 고치기: v2 create_event proposed + v1 stale, fact 시작이 내일
  const a = await chat("앗 내가 잘못 말햇어 내일이야", v1.id);
  f = await versions();
  const ps = f[0].proposals.sort((x, y) => x.version - y.version);
  check("edit_before_add", a.status === 200 && a.body.intent === "edit_event" && a.body.edit?.status === "ok" && a.body.edit?.action === "create_event"
    && ps.map((p) => `${p.version}:${p.action}:${p.status}`).join(",") === "1:create_event:stale,2:create_event:proposed"
    && String(f[0].payload.start ?? "").startsWith(seoulDay(1)), { versions: ps.length });
  // ③ v2 를 캘린더에 넣었다고 보고(사용자 JWT) → 다시 고치기 = update_event(before = v2 값, base = v2, eventkit_id 같음), v2 succeeded 그대로
  const v2 = ps[1];
  const rep = await c.rpc("report_execution", { p_proposal: v2.id, p_device: `${RUN}:device`, p_eventkit_id: "EK-합성-smoke", p_version: 2,
    p_executed_at: new Date().toISOString() });
  const b = await chat("2시로 바꿔줘", v1.id);
  const ps3 = (await versions())[0].proposals.sort((x, y) => x.version - y.version);
  const v3 = ps3[2];
  check("edit_after_add", rep.data === "ok" && b.body.edit?.status === "ok" && b.body.edit?.action === "update_event" && v3?.action === "update_event"
    && v3.payload.base_proposal_id === v2.id && (v3.payload.before as Record<string, unknown> | undefined)?.start === v2.payload.start
    && v3.eventkit_id === "EK-합성-smoke" && ps3[1].status === "succeeded", { versions: ps3.length });
  // ④ edit_target 없이 같은 말 → 고치기 아님(0.15.0 모양 요청)
  const n = await chat("앗 내일이야", null);
  check("no_target", n.status === 200 && n.body.intent !== "edit_event" && (n.body.edit ?? null) === null);
  // ⑤ 30분 지남(서버 captured_at — 자기 행) → 쓰기 없음(고치기로 고르면 expired, 질문으로 고르면 edit null)
  await sb.from("items").update({ captured_at: new Date(Date.now() - 31 * 60_000).toISOString() }).eq("id", item).eq("user_id", u.id);
  const x = await chat("3시로 바꿔줘", v1.id);
  check("expired", (x.body.edit === null || x.body.edit?.status === "expired") && (await versions())[0].proposals.length === 3, { edit: x.body.edit?.status ?? null });
  // ⑥ resolve_uncertain(사용자 JWT): update_event 최고 버전·옛 버전 → not_found
  const r3 = await c.rpc("resolve_uncertain", { p_proposal: v3.id, p_code: "ampm", p_value: "" });
  const r1 = await c.rpc("resolve_uncertain", { p_proposal: v1.id, p_code: "ampm", p_value: "" });
  check("resolve_guard", (r3.data as { status?: string })?.status === "not_found" && (r1.data as { status?: string })?.status === "not_found");
  console.log(JSON.stringify({ gate: failures === 0 ? "pass" : "fail", failures }));
  if (failures) Deno.exitCode = 1;
} finally {
  if (item) {
    await sb.from("audit_log").delete().eq("user_id", u.id).in("target", [item, await sha(item)]);
    await sb.from("jobs").delete().eq("user_id", u.id).eq("payload->>item_id", item);
    await sb.from("items").delete().eq("id", item).eq("user_id", u.id);              // facts → proposals → executions·proposal_pushes, 청크 cascade
  }
  await deleteRunJobs();
  await sb.from("jobs").delete().eq("user_id", u.id).eq("kind", "notify").gte("created_at", STARTED);
  await sb.from("audit_log").delete().eq("user_id", u.id).in("actor", ["chat", "worker"]).gte("at", STARTED);
  const now1 = ((await sb.from("usage_ledger").select("kind, model").eq("user_id", u.id).eq("month", month)).data ?? []) as { kind: string; model: string }[];
  for (const r of now1) {
    const was = ledger0.find((x) => x.kind === r.kind && x.model === r.model);
    const q = sb.from("usage_ledger");
    if (!was) await q.delete().eq("user_id", u.id).eq("month", month).eq("kind", r.kind).eq("model", r.model);
    else await q.update({ calls: was.calls, input_tokens: was.input_tokens, cached_tokens: was.cached_tokens, output_tokens: was.output_tokens, krw: was.krw })
      .eq("user_id", u.id).eq("month", month).eq("kind", r.kind).eq("model", r.model);
  }
  if (counter0) await sb.from("usage_counters").update({ reserved_krw: counter0.reserved_krw }).eq("user_id", u.id).eq("month", month);
  else await sb.from("usage_counters").delete().eq("user_id", u.id).eq("month", month);
  await sb.from("llm_slots").delete().eq("user_id", u.id);
}
