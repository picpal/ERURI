// 0.16.1 배포 스모크(RETRY-deploy): 배포된 0034 + worker 경로 — dead 처리 잡 → 항목 failed(트리거), 남의 retry_item → not_found,
// 본인 retry_item → queued(같은 잡 attempts 0) → worker 처리 → extracted, 다시 retry_item → not_failed.
// 전용 테스트 사용자 23(남 = 2)·실행 태그만 쓰고 끝나면 자기 행을 지운다(AGENTS.md §7). 문구는 합성. 출력은 상태 코드만
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-retry.ts
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, userClient } from "../tests/_testenv.ts";

const { u, c: own } = await userClient(23);
const { c: other } = await userClient(2);
const USER = u.id;
const out: Record<string, unknown> = {};
let id = "";
try {
  const { data, error } = await sb.rpc("insert_item", { p_user: USER, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:smokeretry`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(USER, "[합성의원] 다음 주 목요일 오전 10시 검진 예약이 확정되었습니다.")),
    p_occurred_at: new Date().toISOString(), p_enqueue: false });
  if (error) throw new Error("insert_item " + error.code);
  id = data as string;
  const { data: job, error: e } = await sb.rpc("enqueue_job", { p_user: USER, p_kind: "process", p_lease_key: `${RUN}:process:retry`, p_payload: { item_id: id } });
  if (e) throw new Error("enqueue_job " + e.code);
  await sb.from("jobs").update({ status: "dead", attempts: 5, last_error: "test_dead" }).eq("id", job);
  const status = async () => (await sb.from("items").select("status").eq("id", id).single()).data!.status;
  out.after_dead = await status();
  out.other = (await other.rpc("retry_item", { p_item: id })).data;
  out.own = (await own.rpc("retry_item", { p_item: id })).data;
  const { data: j } = await sb.from("jobs").select("status, attempts").eq("id", job).single();
  out.job = [j!.status, j!.attempts];
  out.queued = await status();
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/worker`, { method: "POST",
    headers: { authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({ lease_prefix: RUN }) });
  out.worker = [r.status, ((await r.json()).results ?? []).map((x: unknown[]) => x[1])];
  out.processed = await status();
  out.again = (await own.rpc("retry_item", { p_item: id })).data;
  const ok = out.after_dead === "failed" && out.other === "not_found" && out.own === "queued" && out.queued === "queued" &&
    JSON.stringify(out.job) === '["queued",0]' && out.processed === "extracted" && out.again === "not_failed";
  console.log(JSON.stringify(out));
  console.log(JSON.stringify({ gate: ok ? "pass" : "fail" }));
} finally {
  if (id) {
    // 처리 뒤 생긴 embed(item_id)·notify(proposal_id) 잡 — 실행 태그가 없다
    const facts = ((await sb.from("facts").select("id").eq("user_id", USER).eq("item_id", id)).data ?? []).map((f) => f.id as string);
    const props = facts.length === 0 ? [] : ((await sb.from("proposals").select("id").in("fact_id", facts)).data ?? []).map((p) => p.id as string);
    await sb.from("jobs").delete().eq("user_id", USER).eq("payload->>item_id", id);
    if (props.length > 0) await sb.from("jobs").delete().eq("user_id", USER).in("payload->>proposal_id", props);
    await sb.from("facts").delete().eq("user_id", USER).eq("item_id", id);
    await sb.from("items").delete().eq("user_id", USER).eq("id", id);
  }
  await sb.from("usage_counters").delete().eq("user_id", USER);
  await deleteRunJobs();
}
