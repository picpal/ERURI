// 배포된 worker 의 process 경로 스모크(Task 4). 실제 gpt-6-luna 추출 + 워커 secret 의 CLASSIFY_PROVIDER.
// 전용 테스트 사용자·실행 태그만 쓰고 끝나면 자기 행을 지운다(AGENTS.md §7). 문구는 합성. 출력은 id·상태 코드만
// 사용: cd poc/server && deno run --allow-net --allow-env --allow-read --env-file=.env scripts/smoke-process.ts
import { encrypt, toBytea } from "../supabase/functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "../supabase/tests/_testenv.ts";

const USER = (await testUser()).id;
const TEXTS: Record<string, string> = { ev: "[합성의원] 다음 주 화요일 오후 3시 진료 예약이 확정되었습니다.", chat: "ㅋㅋㅋ 오늘 진짜 웃겼다" };
const ids: string[] = [];
try {
  for (const [tag, text] of Object.entries(TEXTS)) {
    const { data: id, error } = await sb.rpc("insert_item", { p_user: USER, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:smoke:${tag}`,
      p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(USER, text)), p_occurred_at: new Date().toISOString(), p_enqueue: false });
    if (error) throw new Error("insert_item " + error.code);
    ids.push(id as string);
    const e = await sb.rpc("enqueue_job", { p_user: USER, p_kind: "process", p_lease_key: `${RUN}:process:${tag}`, p_payload: { item_id: id } });
    if (e.error) throw new Error("enqueue_job " + e.error.code);
  }
  // secret 키 호출이 test: 실행 태그를 주면 그 테스트 잡만 가져간다(worker/index.ts)
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/worker`, { method: "POST",
    headers: { authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({ lease_prefix: RUN }) });
  const out = await r.json();
  console.log("worker", r.status, JSON.stringify((out.results ?? []).map((x: unknown[]) => x.slice(0, 2))));
  const { data } = await sb.from("items").select("id, status").in("id", ids);
  console.log(JSON.stringify(data));
} finally {
  await sb.from("facts").delete().eq("user_id", USER).in("item_id", ids);
  await sb.from("items").delete().eq("user_id", USER).in("id", ids);
  await sb.from("usage_counters").delete().eq("user_id", USER);
  await deleteRunJobs();
}
