import { assert, assertEquals } from "jsr:@std/assert";
import { Deferred, guarded, ledgerLine, nextMonthSeoul } from "../functions/_shared/budget.ts";
import { budgetDeps } from "../functions/_shared/budget-deps.ts";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, testUser, userClient } from "./_testenv.ts";

const USER = (await testUser()).id;
const reserve = async (kind: string, est: number) => (await sb.rpc("reserve_usage", { p_user: USER, p_kind: kind, p_est_krw: est })).data;

Deno.test("reserve_usage: ok → degraded at 80% → refused past cap; settle adjusts; backfill has its own cap; usage_status for the owner", async () => {
  try {
    assertEquals(await reserve("extract", 7000), "ok");
    assertEquals(await reserve("chat", 1500), "degraded");                                  // 8500 ≥ 8000
    assertEquals(await reserve("chat", 2000), "refused");                                   // 10500 > 10000
    await sb.rpc("settle_usage", { p_user: USER, p_kind: "chat", p_est_krw: 1500, p_actual_krw: 100 });
    assertEquals((await sb.from("usage_counters").select("reserved_krw").eq("user_id", USER).single()).data!.reserved_krw, 7100);
    assertEquals(await reserve("backfill", 1400), "degraded");                              // 백필 별도 1500
    assertEquals(await reserve("backfill", 200), "refused");
    const { c } = await userClient(1);
    const { data } = await c.rpc("usage_status");
    assertEquals([data[0].used_krw, data[0].cap_krw, data[0].level], [7100, 10000, "ok"]);
  } finally {
    await sb.from("usage_counters").delete().eq("user_id", USER);
  }
});

// Review Focus 4: 미룬 잡은 dead 가 아니고 attempts 를 쓰지 않으며 not_before 전에는 클레임되지 않는다
Deno.test("defer_job: back to queued, attempts restored, not claimed before not_before", async () => {
  try {
    const { data: id } = await sb.rpc("enqueue_job", { p_user: USER, p_kind: "process", p_lease_key: `${RUN}:defer`, p_payload: {} });
    const claimed = (await sb.rpc("claim_jobs", { p_limit: 1, p_lease_seconds: 180, p_lease_prefix: RUN })).data as { id: string; attempts: number }[];
    assertEquals([claimed[0].id, claimed[0].attempts], [id, 1]);
    await sb.rpc("defer_job", { p_id: id, p_until: new Date(Date.now() + 3600_000).toISOString(), p_code: "budget_exhausted" });
    const { data: row } = await sb.from("jobs").select("status, attempts, last_error").eq("id", id).single();
    assertEquals([row!.status, row!.attempts, row!.last_error], ["queued", 0, "budget_exhausted"]);
    assertEquals(((await sb.rpc("claim_jobs", { p_limit: 1, p_lease_seconds: 180, p_lease_prefix: RUN })).data as unknown[]).length, 0);
    await sb.from("jobs").update({ not_before: new Date(Date.now() - 1000).toISOString() }).eq("id", id);
    assertEquals(((await sb.rpc("claim_jobs", { p_limit: 1, p_lease_seconds: 180, p_lease_prefix: RUN })).data as unknown[]).length, 1);
  } finally {
    await deleteRunJobs();
  }
});

// 배포 워커로 실제 확인: 월 예산이 찬 사용자의 행동 항목은 Jev 게이트를 통과한 뒤 추출 전에 다음 달로 미뤄진다(dead 아님)
Deno.test({ name: "deployed worker: exhausted monthly budget defers the process job to next month", ignore: Deno.env.get("DEPLOYED") !== "1", fn: async () => {
  const month = (await sb.rpc("seoul_month")).data as string;
  await sb.from("usage_counters").upsert({ user_id: USER, month, reserved_krw: 10000 });   // 꽉 참: 추출 1건 예약(약 0.45원)도 거부
  const { data: item } = await sb.rpc("insert_item", { p_user: USER, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:budget`, p_sender: null,
    p_title: null, p_content_enc: toBytea(await encrypt(USER, "[합성의원] 모레 오후 3시 진료 예약이 확정되었습니다.")), p_occurred_at: new Date().toISOString() });
  try {
    let job: { status: string; attempts: number; last_error: string | null; not_before: string | null } | null = null;
    for (let t = 0; t < 180 && job?.last_error !== "budget_exhausted"; t += 10) {
      await new Promise((r) => setTimeout(r, 10_000));
      job = (await sb.from("jobs").select("status, attempts, last_error, not_before").eq("user_id", USER).eq("payload->>item_id", item as string).single()).data;
    }
    assertEquals([job?.status, job?.attempts, job?.last_error], ["queued", 0, "budget_exhausted"]);
    assertEquals(Date.parse(job!.not_before!), Date.parse(nextMonthSeoul(new Date())));                // 다음 달 1일 00:00 서울
  } finally {
    await sb.from("jobs").delete().eq("user_id", USER).eq("payload->>item_id", item as string);
    await sb.from("items").delete().eq("user_id", USER).eq("id", item as string);
    await sb.from("usage_counters").delete().eq("user_id", USER);
    await sb.from("llm_slots").delete().eq("user_id", USER);
  }
} });

Deno.test("llm slots: two per user, third waits; release frees", async () => {
  try {
    const a = (await sb.rpc("acquire_llm_slot", { p_user: USER, p_holder: `${RUN}:a` })).data;
    const b = (await sb.rpc("acquire_llm_slot", { p_user: USER, p_holder: `${RUN}:b` })).data;
    const c = (await sb.rpc("acquire_llm_slot", { p_user: USER, p_holder: `${RUN}:c` })).data;
    assertEquals([a, b, c], [1, 2, null]);
    await sb.rpc("release_llm_slot", { p_user: USER, p_slot: a, p_holder: `${RUN}:a` });
    assert((await sb.rpc("acquire_llm_slot", { p_user: USER, p_holder: `${RUN}:d` })).data === 1);
  } finally {
    await sb.from("llm_slots").delete().eq("user_id", USER);
  }
});

// M1-③a: 워커 호출 1회는 잡을 하나씩 돌지만 cron 이 겹치면 워커 2개가 동시에 돈다(+ 채팅). 실제 RPC 로 4개를 동시에 불러
// 사용자당 LLM 호출이 2개를 넘지 않고, 나머지는 llm_busy 로 미뤄지며 그 예약은 되돌려지는지 본다
Deno.test("llm slots under real concurrency: 4 overlapping guarded calls → 2 run, 2 Deferred llm_busy, their reservations undone", async () => {
  const deps = budgetDeps(sb);
  const U = { input: 1_000, cached: 0, output: 0 };                                       // luna 입력 1천 토큰 ≈ 0.14원 — 예약 1원 안
  const each = ledgerLine("extract", "gpt-6-luna", U).krw;
  let live = 0, peak = 0;
  try {
    const rs = await Promise.allSettled([0, 1, 2, 3].map((i) => guarded(deps, USER, "extract", 1, `${RUN}:w${i}`, async (_lv, bill) => {
      peak = Math.max(peak, ++live);
      await new Promise((r) => setTimeout(r, 1500));
      live--;
      bill("extract", "gpt-6-luna", U);
      return i;
    })));
    const busy = rs.filter((r) => r.status === "rejected" && r.reason instanceof Deferred && r.reason.message === "llm_busy").length;
    assertEquals([peak, rs.filter((r) => r.status === "fulfilled").length, busy], [2, 2, 2]);
    assertEquals(Number((await sb.from("usage_counters").select("reserved_krw").eq("user_id", USER).single()).data!.reserved_krw), each * 2);   // 원소 2개
    assertEquals((await sb.from("llm_slots").select("slot").eq("user_id", USER).not("holder", "is", null)).data!.length, 0);    // 모두 반납
  } finally {
    await sb.from("usage_counters").delete().eq("user_id", USER);
    await sb.from("usage_ledger").delete().eq("user_id", USER);
    await sb.from("llm_slots").delete().eq("user_id", USER);
  }
});
