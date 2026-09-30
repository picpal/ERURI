import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { run } from "../scripts/gmail-gate.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자 7(poc-test-7, 이 파일만 쓴다)에게 합성 Gmail 연결·잡·항목을 만들어 조회식(필터·페이지)과 출력 형태를 본다(AGENTS.md §7).
// 조회는 --connection 으로 이 실행의 연결만 본다. 잡 lease_key 는 RUN 접두라 워커가 가져가지 않는다(0007). gap 은 실제 Gmail API 가 필요해
// judgeIds(순수, gmail-gate.test.ts)로만 다룬다. 정리는 finally 가 자기 행만 지운다
const USER = (await testUser(7)).id;
let CID = "";
async function gate(...args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await run([...args, "--user", USER, "--connection", CID], (l) => lines.push(l));
  return { code, lines };
}

Deno.test("gmail-gate status · latency · mails on a synthetic connection of test user 7", async () => {
  const base = Date.now() - 3600_000;
  const at = (s: number) => new Date(base + s * 1000).toISOString();
  const { data: conn, error: ce } = await sb.from("connections").insert({ user_id: USER, provider: "gmail",
    account_ref: `${RUN}-gg-${crypto.randomUUID()}@example.com`, status: "active", expires_at: at(7 * 86_400) }).select("id").single();
  assertEquals(ce, null);
  CID = conn!.id as string;
  let item: string | null = null;
  try {
    assertEquals((await sb.from("sync_states").insert({ connection_id: CID, user_id: USER, cursor: "1", watch_expires_at: at(7 * 86_400) })).error, null);
    const job = (kind: string, key: string, created: number, o: Record<string, unknown>) =>
      ({ kind, user_id: USER, lease_key: `${RUN}:${key}`, created_at: at(created), ...o });
    const webhook = { connection_id: CID, via: "webhook" };
    const { error } = await sb.from("jobs").insert([
      // 연결 묶음(0초): 백필 fetch 1잡이 5~50초 실행, process 1잡은 30초부터 대기 → 60~360초 sync 는 모두 busy > 0
      job("gmail-fetch", "backfill", 0, { payload: { connection_id: CID, ids: ["x1", "x2", "x3"], backfill: true },
        status: "done", attempts: 1, claimed_at: at(5), updated_at: at(50) }),
      job("process", "backfill", 30, { payload: { item_id: crypto.randomUUID(), backfill: true } }),
      job("gmail-sync", "gmail:w", -2, { payload: webhook, status: "done", attempts: 1, claimed_at: at(4) }),    // watch 즉시 알림(묶음 앞)
      job("gmail-sync", "gmail:c", 1, { payload: webhook, status: "done", attempts: 1, claimed_at: at(20) }),    // 초기 sync(via 오표기)
      ...[60, 120, 180, 240, 300].map((t, i) =>
        job("gmail-sync", `gmail:l${i}`, t, { payload: webhook, status: "done", attempts: 1, claimed_at: at(t + 10) })),
      job("gmail-sync", "gmail:r", 360, { payload: webhook, status: "done", attempts: 2, last_error: "history 503", claimed_at: at(365) }),  // 재시도도 표본
    ], { defaultToNull: false });                                                   // 여러 행 insert 에서 빠진 열은 null 이 아니라 기본값
    assertEquals(error, null);
    const ins = await sb.rpc("insert_item", { p_user: USER, p_source: "GMAIL", p_idempotency_key: `${RUN}:gg-mail`, p_sender: null,
      p_title: "[합성 게이트 테스트 1] 합성", p_content_enc: toBytea(await encrypt(USER, "합성 메일")),
      p_occurred_at: new Date(Date.now() - 30_000).toISOString(), p_enqueue: false });
    assertEquals(ins.error, null);
    item = ins.data as string;

    const s = await gate("status");
    assertEquals(s.code, 0);
    const st = JSON.parse(s.lines.join("\n"));
    assertEquals([st.connection.id, st.connection.status, st.connection.t0, st.backfill.active, st.backfill.stalled, st.backfill.by_kind,
      st.backfill_bursts, st.backfill_ids_latest], [CID, "active", at(0), 1, 0, { process: 1 }, 1, 3]);
    assert(st.gmail_items.queued >= 1);

    const l = await gate("latency", "--since", at(-5));
    assertEquals(l.code, 0);
    const sum = JSON.parse(l.lines.at(-1)!);
    assertEquals([sum.webhook_syncs, sum.connect_excluded, sum.retried, sum.during_backfill, sum.retried_during_backfill,
      sum.avg_latency_s_during_backfill, sum.gate], [8, 2, 1, 6, 1, 9.2, "pass"]);

    const m = await gate("mails", "--prefix", "[합성 게이트 테스트", "--since", at(0));
    assertEquals(m.code, 0);
    const mm = JSON.parse(m.lines.at(-1)!);
    assertEquals(mm.mails, 1);
    assert(mm.max_delay_s >= 25 && mm.max_delay_s <= 60, String(mm.max_delay_s));   // 30초 전 수신 → 지금 저장(시계 오차 여유)
  } finally {
    await deleteRunJobs();
    if (item) await sb.from("items").delete().eq("user_id", USER).eq("id", item);
    await sb.from("connections").delete().eq("id", CID);                              // sync_states cascade
  }
});
