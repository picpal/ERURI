import { assert, assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decrypt, encrypt, SERVER_AUTH, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, userClient } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 사용자 1은 다른 테스트·pane 과 공유하므로(리뷰 N2)
// 주소에 실행 태그를 넣고 unsub_list·audit 를 그 범위로만 읽고 지운다. 연결은 active(insert_item(GMAIL) 조건, 0013 — 리뷰 M4)이고
// refresh token 이 없어 cron 이 sync 를 넣어도 skipped. 끝나면 그 연결의 잡·행만 지운다(cascade)
const day = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const TAG = RUN.slice(5);                                            // 'test:ab12cd34' → 'ab12cd34'
const A = (local: string) => `${local}-${TAG}@example.com`;          // 이 실행의 합성 주소
type ListRow = { sender_id: string; address: string; method: string; status: string; ads_30d: number; ads_after_request: number; can_request: boolean };
const mine = (rows: ListRow[] | null) => (rows ?? []).filter((r) => r.address.endsWith(`-${TAG}@example.com`));

async function setup(n = 1) {
  const { u, c } = await userClient(n);
  const { data, error } = await sb.from("connections").insert({ user_id: u.id, provider: "gmail",
    account_ref: `${RUN}-${crypto.randomUUID().slice(0, 8)}@example.com`, status: "active" }).select("id").single();
  assertEquals(error, null);
  return { u, c, conn: data!.id as string };
}
async function cleanup(user: string, conn: string) {
  const { data: senders } = await sb.from("unsub_senders").select("id").eq("user_id", user).eq("connection_id", conn);
  for (const s of senders ?? []) await sb.from("audit_log").delete().eq("user_id", user).like("target", `unsub:${s.id}%`);   // 자기 sender 의 감사 행만(리뷰 M5)
  await deleteRunJobs();
  await sb.from("jobs").delete().eq("user_id", user).eq("payload->>connection_id", conn);    // cron 이 이 연결에 넣었을 수 있는 잡
  await sb.from("items").delete().eq("user_id", user).like("idempotency_key", `${RUN}%`);
  await sb.from("items").delete().eq("user_id", user).like("idempotency_key", `gmail:${RUN}%`);   // 스캔 대상 테스트가 운영 키 형식으로 바꾼 항목
  await sb.from("connections").delete().eq("user_id", user).eq("id", conn);            // unsub_* cascade
}
async function rec(user: string, conn: string, o: { addr: string; key: string; at: string; method?: string; url?: string | null; item?: string | null; name?: string | null; raw?: boolean }) {
  const { data, error } = await sb.rpc("worker_record_unsub", { p_user: user, p_connection: conn, p_address: o.addr, p_name: o.name ?? "합성 발신자",
    p_method: o.method ?? "one_click", p_url_enc: o.url === null ? null : toBytea(await encrypt(user, o.url ?? "https://u.example.com/one")),
    p_msg_key: o.raw ? o.key : `${RUN}:${o.key}`, p_occurred_at: o.at, p_item: o.item ?? null });
  assertEquals(error, null);
  return data as string;
}
async function item(user: string, tag: string, status: "promo" | "queued"): Promise<string> {
  const { data: id, error } = await sb.rpc("insert_item", { p_user: user, p_source: "GMAIL", p_idempotency_key: `${RUN}:gmail:${tag}`, p_sender: "합성 발신자",
    p_title: "합성", p_content_enc: toBytea(await encrypt(user, "합성 광고 본문")), p_occurred_at: iso(day), p_enqueue: false });
  assertEquals(error, null);
  assert(id, "insert_item returned null — active Gmail connection missing?");
  if (status === "promo") {
    assertEquals((await sb.rpc("worker_record_gate", { p_user: user, p_item: id, p_label: "promo", p_confidence: 0.95 })).error, null);
    assertEquals((await sb.rpc("worker_quarantine_item", { p_user: user, p_item: id, p_status: "discarded:server:promo" })).error, null);
  }
  return id as string;
}
const begin = async (user: string, sender: string) => (await sb.rpc("unsub_begin", { p_user: user, p_sender: sender })).data;

Deno.test("unsub_list counts rule ads and gate-promo items only; 30-day window; url never returned; newsletter-only sender hidden", async () => {
  const { u, c, conn } = await setup();
  try {
    const promo = await item(u.id, "p1", "promo"), passed = await item(u.id, "q1", "queued");
    const a = await rec(u.id, conn, { addr: A("ads"), key: "a1", at: iso(day) });
    await rec(u.id, conn, { addr: A("ads"), key: "a2", at: iso(2 * day) });
    await rec(u.id, conn, { addr: A("ads"), key: "a3", at: iso(40 * day) });                // 30일 밖
    await rec(u.id, conn, { addr: A("ads"), key: "a4", at: iso(day), item: promo });       // 게이트 promo → 센다
    await rec(u.id, conn, { addr: A("ads"), key: "a5", at: iso(day), item: passed });      // 통과(거래) 메일 → 세지 않는다
    await rec(u.id, conn, { addr: A("news"), key: "n1", at: iso(day), item: passed, method: "link_only", url: null });
    const { data, error } = await c.rpc("unsub_list");
    assertEquals(error, null);
    const rows = mine(data);
    assertEquals(rows.map((r) => [r.address, r.ads_30d, r.method, r.can_request]), [[A("ads"), 3, "one_click", true]]);
    assertEquals(rows[0].sender_id, a);
    assert(!("url_enc" in rows[0]));
    assertEquals((await c.from("unsub_senders").select("id")).data, []);                       // 표 직접 읽기 불가(정책 없음)
    assertEquals((await c.from("unsub_mail").select("msg_key")).data, []);
  } finally {
    await cleanup(u.id, conn);
  }
});

// 리뷰 H2: 같은 From 의 더 최근 거래·뉴스레터 메일이 해지 URL 을 바꾸지 못한다. 복구된 항목은 후보에서 빠진다
Deno.test("H2: a newer non-ad mail never supplies the URL; one_click ad wins over a newer unverified ad; restored item drops out", async () => {
  const { u, c, conn } = await setup();
  try {
    const passed = await item(u.id, "q2", "queued");
    const s = await rec(u.id, conn, { addr: A("shop"), key: "h1", at: iso(2 * day), url: "https://u.example.com/AD" });               // 광고 A
    await rec(u.id, conn, { addr: A("shop"), key: "h2", at: iso(day), item: passed, url: "https://u.example.com/ORDER" });            // 더 최근 거래 B(one_click)
    await rec(u.id, conn, { addr: A("shop"), key: "h3", at: iso(1000), item: passed, method: "mailto", url: null });                  // 더 최근 거래 C(mailto)
    let { data } = await c.rpc("unsub_list");
    assertEquals(mine(data).map((r) => [r.address, r.method, r.ads_30d]), [[A("shop"), "one_click", 1]]);
    const b1 = await begin(u.id, s);
    assertEquals([b1.result, await decrypt(u.id, b1.url_enc)], ["ok", "https://u.example.com/AD"]);   // 합성 값이라 복호화 확인 가능
    await sb.rpc("unsub_finish", { p_user: u.id, p_sender: s, p_code: "http_500" });
    await rec(u.id, conn, { addr: A("shop"), key: "h4", at: iso(500), method: "unverified", url: null });                           // 더 최근 광고지만 unverified
    assertEquals(await decrypt(u.id, (await begin(u.id, s)).url_enc), "https://u.example.com/AD");                                   // one_click 광고가 우선
    // 유일한 광고가 게이트 promo 항목인 발신자: 사용자가 복구하면(queued) 광고가 아니다 → 요청 불가·목록에서 빠짐
    const promo = await item(u.id, "p2", "promo");
    const r = await rec(u.id, conn, { addr: A("restored"), key: "r1", at: iso(day), item: promo });
    assertEquals((await begin(u.id, r)).result, "ok");
    await sb.from("unsub_senders").update({ status: "active", status_at: null, attempts: 0 }).eq("id", r);
    await sb.from("items").update({ status: "queued" }).eq("id", promo);
    assertEquals(await begin(u.id, r), { result: "unsupported" });
    ({ data } = await c.rpc("unsub_list"));
    assertEquals(mine(data).map((x) => x.address).includes(A("restored")), false);
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("same message twice counts once; method/url stay on the mail row; sender name follows the newest mail", async () => {
  const { u, c, conn } = await setup();
  try {
    const promo = await item(u.id, "p3", "promo");
    await rec(u.id, conn, { addr: A("dup"), key: "d1", at: iso(day), name: "옛 이름" });
    await rec(u.id, conn, { addr: A("dup"), key: "d1", at: iso(day), item: promo });       // 스캔이 다시 읽음 → item 만 보충
    const { data: m } = await sb.from("unsub_mail").select("item_id, method").eq("user_id", u.id).eq("msg_key", `${RUN}:d1`);
    assertEquals(m, [{ item_id: promo, method: "one_click" }]);
    await rec(u.id, conn, { addr: A("dup"), key: "d2", at: iso(10 * day), method: "mailto", url: null, name: "더 옛 이름" });   // 더 오래된 메일
    await rec(u.id, conn, { addr: A("dup").toUpperCase(), key: "d3", at: iso(1000), method: "mailto", url: null, name: "새 이름" });   // 더 최근, 대문자 주소
    const { data: s } = await sb.from("unsub_senders").select("display_name").eq("user_id", u.id).eq("address", A("dup")).single();
    assertEquals(s!.display_name, "새 이름");
    const { data: list } = await c.rpc("unsub_list");
    assertEquals(mine(list).map((r) => [r.ads_30d, r.method]), [[3, "one_click"]]);     // 최신 메일이 mailto 여도 one_click 광고가 있으면 one_click
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("begin/finish: unsupported, ok + decrypt audit, busy within 60s, stale requesting restarts, requested → already, 3xx code fails, other user not_found, limit + can_request", async () => {
  const { u, c, conn } = await setup();
  try {
    const mail = await rec(u.id, conn, { addr: A("m"), key: "m1", at: iso(day), method: "mailto", url: null });
    assertEquals(await begin(u.id, mail), { result: "unsupported" });
    const s = await rec(u.id, conn, { addr: A("o"), key: "o1", at: iso(day) });
    assertEquals(await begin(crypto.randomUUID(), s), { result: "not_found" });              // 다른 사용자(존재하지 않는 id 로 충분)
    const b1 = await begin(u.id, s);
    assertEquals(b1.result, "ok");
    assert(String(b1.url_enc).startsWith("\\x"));
    assertEquals(await begin(u.id, s), { result: "busy" });
    await sb.from("unsub_senders").update({ status_at: iso(120_000) }).eq("id", s);          // 2분 전 시작한 채 끝남
    assertEquals((await begin(u.id, s)).result, "ok");
    assertEquals((await sb.rpc("unsub_finish", { p_user: u.id, p_sender: s, p_code: "ok" })).error, null);
    const { data: row } = await sb.from("unsub_senders").select("status, result_code, attempts, requested_at").eq("id", s).single();
    assertEquals([row!.status, row!.result_code, row!.attempts, row!.requested_at !== null], ["requested", "ok", 2, true]);
    assertEquals(await begin(u.id, s), { result: "already" });
    const { data: audit } = await sb.from("audit_log").select("action, target").eq("user_id", u.id).like("target", `unsub:${s}%`).order("id");
    assertEquals(audit!.map((a) => a.action), ["decrypt", "decrypt", "unsubscribe"]);
    assertEquals(audit![2].target, `unsub:${s} ok`);
    // 3xx 는 접수가 아니다(리뷰 M1)
    const f = await rec(u.id, conn, { addr: A("f"), key: "f1", at: iso(day) });
    await begin(u.id, f);
    await sb.rpc("unsub_finish", { p_user: u.id, p_sender: f, p_code: "redirect_302" });
    const { data: fr } = await sb.from("unsub_senders").select("status, result_code, requested_at").eq("id", f).single();
    assertEquals([fr!.status, fr!.result_code, fr!.requested_at], ["failed", "redirect_302", null]);
    // 한도 5회: begin 은 limit, 목록은 can_request = false(리뷰 N5)
    await sb.from("unsub_senders").update({ attempts: 5, status: "failed" }).eq("id", f);
    assertEquals(await begin(u.id, f), { result: "limit" });
    const { data: list } = await c.rpc("unsub_list");
    assertEquals(mine(list).find((r) => r.sender_id === f)?.can_request, false);
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("requested sender: ads after the 3-day grace reopen the request; ads inside the grace do not", async () => {
  const { u, c, conn } = await setup();
  try {
    const s = await rec(u.id, conn, { addr: A("g"), key: "g1", at: iso(6 * day) });
    await sb.from("unsub_senders").update({ status: "requested", status_at: iso(5 * day), requested_at: iso(5 * day), result_code: "ok" }).eq("id", s);
    await rec(u.id, conn, { addr: A("g"), key: "g2", at: iso(4 * day) });                  // 유예 안
    let { data } = await c.rpc("unsub_list");
    assertEquals(mine(data).map((r) => r.ads_after_request), [0]);
    assertEquals(await begin(u.id, s), { result: "already" });
    await rec(u.id, conn, { addr: A("g"), key: "g3", at: iso(day) });                      // 유예 뒤
    ({ data } = await c.rpc("unsub_list"));
    assertEquals(mine(data).map((r) => [r.status, r.ads_after_request]), [["requested", 1]]);
    assertEquals((await begin(u.id, s)).result, "ok");
  } finally {
    await cleanup(u.id, conn);
  }
});

// 리뷰 M6: 광고 메일 행이 정리돼도 30일 안에 요청한 발신자는 목록에 남는다(발신자 기준 left join)
Deno.test("requested sender stays listed after its ad rows are purged", async () => {
  const { u, c, conn } = await setup();
  try {
    const s = await rec(u.id, conn, { addr: A("gone"), key: "x1", at: iso(40 * day) });
    await sb.from("unsub_senders").update({ status: "requested", status_at: iso(7 * day), requested_at: iso(7 * day), result_code: "ok", last_seen_at: iso(40 * day) }).eq("id", s);
    // 이번 실행의 연결로만 지운다(Ruling U3 — 공유 사용자 1의 다른 실행 행을 지우지 않는다)
    const { data: p, error: pe } = await sb.rpc("purge_unsub", { p_user: u.id, p_connection: conn });
    assertEquals([pe, p], [null, { mail: 1, senders: 0 }]);                                  // 요청 180일 안 발신자는 남는다
    assertEquals((await sb.from("unsub_mail").select("msg_key").eq("sender_id", s)).data, []);
    const { data } = await c.rpc("unsub_list");
    assertEquals(mine(data).map((r) => [r.address, r.status, r.ads_30d, r.method]), [[A("gone"), "requested", 0, "none"]]);
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("scan targets, scan enqueue (test prefix, backfill lease, once), stats, purge by user, connection delete cascades, anon/authenticated cannot call worker RPCs", async () => {
  const { u, c, conn } = await setup();
  try {
    const promo = await item(u.id, "p4", "promo");
    const t = await rec(u.id, conn, { addr: A("t"), key: "t1", at: iso(day) });
    const targets = async () => (await sb.rpc("unsub_scan_targets", { p_user: u.id, p_since: iso(30 * day) })).data;
    const mineT = async () => ((await targets()) ?? []).filter((t: { item_id: string }) => t.item_id === promo);
    assertEquals(await mineT(), []);                      // 테스트 키 'test:<run>:gmail:p4' 는 'gmail:%' 가 아니다 — 운영 키 형식만 고른다
    await sb.from("items").update({ idempotency_key: `gmail:${RUN}-p4` }).eq("id", promo);
    assertEquals(await mineT(), [{ gmail_id: `${RUN}-p4`, item_id: promo }]);
    await rec(u.id, conn, { addr: A("t"), key: `gmail:${RUN}-p4`, raw: true, at: iso(day), item: promo });
    assertEquals(await mineT(), []);                      // 이미 기록된 메일은 다시 읽지 않는다
    // 사용자 1은 다른 pane·실행의 active 연결을 함께 가질 수 있어 반환 개수는 ≥1 — 결과는 이번 실행 연결 id 로 걸러 단언한다(Ruling U3).
    // 중복 검사는 같은 접두 lease 로 좁혀져 있어 두 번째 호출은 다른 실행과 무관하게 0
    const n1 = (await sb.rpc("gmail_enqueue_unsub_scan", { p_user: u.id, p_lease_prefix: RUN + ":" })).data;
    assert(n1 >= 1, String(n1));
    assertEquals((await sb.rpc("gmail_enqueue_unsub_scan", { p_user: u.id, p_lease_prefix: RUN + ":" })).data, 0);   // 이미 대기 중
    const { data: jobs } = await sb.from("jobs").select("kind, lease_key, priority, payload").eq("user_id", u.id).eq("kind", "gmail-unsub-scan")
      .like("lease_key", `${RUN}%`).eq("payload->>connection_id", conn);
    assertEquals(jobs!.map((j) => [j.lease_key, j.priority, j.payload.backfill, j.payload.lease_key, j.payload.connection_id]),
      [[`${RUN}:backfill:${u.id}`, 40, true, `${RUN}:backfill:${u.id}`, conn]]);
    assert((await sb.rpc("gmail_enqueue_unsub_scan", { p_user: u.id, p_lease_prefix: "evil:" })).error !== null);
    // 집계 RPC(리뷰 M8): 서버에서 센다. 사용자 1 공유라 이 실행이 더한 만큼 이상인지만 본다
    const { data: st, error: se } = await sb.rpc("unsub_stats", { p_user: u.id, p_jobs_since: iso(60_000) });
    assertEquals(se, null);
    assert(st.senders >= 1 && st.ads_30d >= 2 && (st.method_of_senders_with_ads.one_click ?? 0) >= 1, JSON.stringify(st));
    assert((st.jobs["gmail-unsub-scan:queued"] ?? 0) >= 1);
    // purge: 35일 지난 메일 행만, 이번 실행의 연결만(Ruling U3) — 그래서 개수를 정확히 단언한다
    await rec(u.id, conn, { addr: A("old"), key: "old", at: iso(40 * day) });
    await sb.from("unsub_senders").update({ last_seen_at: iso(40 * day) }).eq("user_id", u.id).eq("address", A("old"));
    const { data: p } = await sb.rpc("purge_unsub", { p_user: u.id, p_connection: conn });
    assertEquals(p, { mail: 1, senders: 1 });
    assertEquals((await sb.from("unsub_senders").select("id").eq("user_id", u.id).eq("address", A("old"))).data, []);
    assertEquals((await sb.from("unsub_senders").select("id").eq("user_id", u.id).eq("address", A("t"))).data!.length, 1);
    // 권한(리뷰 U3 Important 1): 함수마다 전체 인자·범위 인자(이번 실행 연결·sender·RUN 접두)로 부르고 42501(실행 권한 없음)을 단언한다.
    // 42501 은 PostgREST 가 이름·인자로 함수를 찾은 뒤 실행에서 나오므로 인자 오타(PGRST202)는 실패한다. 회수가 깨져도
    // 전역 purge·운영 lease 잡은 생기지 않고, 생긴 행은 이번 연결·sender 범위라 아래 cascade·감사 정리로 지워진다
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
    const probes: [string, Record<string, unknown>][] = [
      ["worker_record_unsub", { p_user: u.id, p_connection: conn, p_address: A("perm"), p_name: "합성 발신자", p_method: "mailto",
        p_url_enc: null, p_msg_key: `${RUN}:perm`, p_occurred_at: iso(day), p_item: null }],
      ["unsub_scan_targets", { p_user: u.id, p_since: iso(30 * day) }],
      ["gmail_enqueue_unsub_scan", { p_user: u.id, p_lease_prefix: RUN + ":" }],
      ["unsub_begin", { p_user: u.id, p_sender: t }],
      ["unsub_finish", { p_user: u.id, p_sender: t, p_code: "perm_probe" }],
      ["purge_unsub", { p_user: u.id, p_connection: conn }],
      ["unsub_stats", { p_user: u.id, p_jobs_since: iso(60_000) }],
      ["unsub_best", { p_user: u.id, p_sender: t }],
      ["unsub_ad_mail", { p_user: u.id }],
    ];
    for (const [fn, args] of probes) {
      assertEquals((await c.rpc(fn, args)).error?.code, "42501", `authenticated ${fn}`);
      assertEquals((await anon.rpc(fn, args)).error?.code, "42501", `anon ${fn}`);
    }
    assertEquals((await anon.rpc("unsub_list")).error?.code, "42501");                          // anon 실행 회수
    assertEquals((await sb.from("audit_log").select("id").eq("user_id", u.id).like("target", `unsub:${t}%`)).data, []);   // 탐침이 실행되지 않았다
    // 연결 삭제(출처 삭제 경로) → unsub_* cascade
    const { data: ids } = await sb.from("unsub_senders").select("id").eq("connection_id", conn);
    for (const s of ids ?? []) await sb.from("audit_log").delete().eq("user_id", u.id).like("target", `unsub:${s.id}%`);
    await deleteRunJobs();
    await sb.from("jobs").delete().eq("user_id", u.id).eq("payload->>connection_id", conn);
    await sb.from("connections").delete().eq("id", conn);
    assertEquals((await sb.from("unsub_senders").select("id").eq("user_id", u.id).eq("connection_id", conn)).data, []);
    assertEquals((await sb.from("unsub_mail").select("msg_key").eq("user_id", u.id).like("msg_key", `${RUN}%`)).data, []);
  } finally {
    await cleanup(u.id, conn);
  }
});
