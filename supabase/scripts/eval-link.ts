// LNK-eval(계획 2026-10-02-link-event L7): 앱이 만드는 링크·사진 본문 형식(스펙 §6 "보내는 글")의 합성 사례를 배포된 worker 의 process 경로
// (실제 서버 규칙 → Jev 게이트 → gpt-6-luna 추출 → save_facts)에 테스트 lease 로 넣고 상태·일정만 비교한다. 배포·서버 코드 변경 없음.
// 전용 테스트 사용자 13·실행 태그만 쓰고 끝나면 자기 행을 지운다(AGENTS.md §7). 출력은 사례 id·상태·게이트 라벨·개수·어긋난 항목 코드만(본문 없음)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-link.ts [--runs 3]
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "../tests/_testenv.ts";
import { type Case, expand, type Fact, judge } from "./_link-eval.ts";

const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("../eval/link-cases.json", import.meta.url)));
const at = Deno.args.indexOf("--runs");
const runs = at >= 0 ? Number(Deno.args[at + 1]) : 1;
const OCCURRED = "2026-10-02T03:00:00.000Z";                   // 받은 시각(서울 10-02) — 연도 없는 날짜의 해 = 2026(스펙 §7)
const USER = (await testUser(13)).id;
const BASE = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ids: string[] = [];
const STARTED = new Date().toISOString();
let failures = 0;

try {
  for (let r = 0; r < runs; r++) {
    for (const c of cases) {
      const { data: id, error } = await sb.rpc("insert_item", { p_user: USER, p_source: "SHARE", p_idempotency_key: `${RUN}:link:${c.id}:${r}`,
        p_sender: null, p_title: c.title, p_content_enc: toBytea(await encrypt(USER, expand(c.text))), p_occurred_at: OCCURRED,
        p_enqueue: false, p_app_name: c.app_name ?? "웹 링크" });
      if (error || !id) throw new Error("insert_item " + (error?.code ?? "null"));
      ids.push(id as string);
      const e = await sb.rpc("enqueue_job", { p_user: USER, p_kind: "process", p_lease_key: `${RUN}:process:${c.id}:${r}`, p_payload: { item_id: id } });
      if (e.error) throw new Error("enqueue_job " + e.error.code);
    }
    // 테스트 lease 접두를 주면 worker 는 그 접두의 잡만 가져간다(F20). 단 배포된 worker 는 process 의 notify 자식 잡에 접두를 붙이지 않아
    // (index.ts → textDeps 에 leasePrefix 없음) notify:<proposal> 잡이 cron 몫이 된다 — 사용자 13 은 기기가 없어 푸시는 없고, 아래 정리가 지운다.
    // 한 호출 100초 예산 — 남으면 다시 부른다
    for (let call = 0; call < 6; call++) {
      const w = await fetch(`${BASE}/functions/v1/worker`, { method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify({ lease_prefix: RUN }) });
      await w.body?.cancel();
      const { count } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", USER)
        .like("lease_key", `${RUN}:process:%`).in("status", ["queued", "running"]);
      if ((count ?? 0) === 0) break;
    }
    for (const c of cases) {
      const { data: item } = await sb.from("items").select("id, status, gate_label, gate_confidence").eq("user_id", USER)
        .eq("idempotency_key", `${RUN}:link:${c.id}:${r}`).single();
      const { data: facts } = await sb.from("facts").select("kind, ordinal, payload").eq("user_id", USER).eq("item_id", item?.id ?? "")
        .eq("status", "active");
      const miss = judge(c, item?.status ?? "missing", (facts ?? []) as Fact[]);
      if (miss.length) failures++;
      console.log(JSON.stringify({ run: r, case: c.id, app: c.app_name ?? "웹 링크", measure: c.expect.events === null,
        status: item?.status ?? null, gate: item?.gate_label ?? null, conf: item?.gate_confidence ?? null,
        events: ((facts ?? []) as Fact[]).filter((f) => f.kind === "event").length, ok: miss.length === 0, miss }));
    }
  }
  console.log(JSON.stringify({ gate: failures === 0 ? "pass" : "fail", runs, cases: cases.length, failures }));
  if (failures) Deno.exitCode = 1;
} finally {
  if (ids.length) {
    await sb.from("facts").delete().eq("user_id", USER).in("item_id", ids);                 // proposals → proposal_pushes cascade
    await sb.from("jobs").delete().eq("user_id", USER).in("payload->>item_id", ids);
    await sb.from("items").delete().eq("user_id", USER).in("id", ids);
  }
  await deleteRunJobs();
  // 접두 없는 notify 자식 잡(위 주석)과 워커 감사 행(decrypt target = item id, discard target = "<item id> <status>") — 사용자 13 전용, 이 실행 뒤에 생긴 것만
  await sb.from("jobs").delete().eq("user_id", USER).eq("kind", "notify").like("lease_key", "notify:%").gte("created_at", STARTED);
  if (ids.length) await sb.from("audit_log").delete().eq("user_id", USER).in("target", ids);
  await sb.from("audit_log").delete().eq("user_id", USER).eq("actor", "worker").eq("action", "discard").gte("at", STARTED);
  await sb.from("usage_counters").delete().eq("user_id", USER);                              // 테스트 사용자 13 전용 행만(Fable C9·L7-b)
  await sb.from("llm_slots").delete().eq("user_id", USER);
}
