import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import type { GmailClient, GmailMessage } from "../functions/_shared/gmail.ts";
import { GmailHttpError } from "../functions/_shared/gmail.ts";
import {
  defaultGmailDeps, enqueueUnsubRescan, gmailFetch, type GmailJobDeps, gmailSync, gmailUnsubFetch, gmailUnsubScan, recordUnsub, type RpcClient, UNSUB_SCAN_Q, unsubScanQuery,
} from "../functions/_shared/gmail-jobs.ts";
import type { Job } from "../functions/_shared/job.ts";

const USER = "00000000-0000-0000-0000-0000000000aa", CONN = "00000000-0000-0000-0000-0000000000cc";
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// U1 규칙: AR 의 dkim=pass 가 selector·b= 앞부분으로 서명 하나를 특정해야 one_click
const SIG = "v=1; d=example.com; s=s1; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=AbCdEf12rest";
const AR = "mx.google.com; dkim=pass header.i=@example.com header.s=s1 header.b=AbCdEf12";
const mk = (id: string, o: { labels?: string[]; subject?: string; lu?: boolean; body?: string } = {}): GmailMessage => ({
  id, internalDate: "1790000000000", labelIds: o.labels ?? ["INBOX"],
  payload: { mimeType: "text/plain", body: { data: b64(o.body ?? "합성 본문") }, headers: [
    { name: "From", value: "합성쇼핑 <news@example.com>" }, { name: "Subject", value: o.subject ?? "합성 안내" },
    ...(o.lu ? [{ name: "List-Unsubscribe", value: "<https://u.example.com/one?t=1>" }, { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
                { name: "Authentication-Results", value: AR }, { name: "DKIM-Signature", value: SIG }] : []),
  ] },
});
const job = (kind: string, payload: Record<string, unknown> = {}): Job => ({ id: "job-1", kind, user_id: USER, payload: { connection_id: CONN, ...payload }, attempts: 1, checkpoint: null });

function fakeRpc(results: Record<string, unknown> = {}, failing: string[] = []) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: RpcClient = { rpc: (fn, args = {}) => {
    calls.push({ fn, args });
    if (failing.includes(fn)) return Promise.resolve({ data: null, error: { code: "XX000" } });
    return Promise.resolve({ data: fn in results ? results[fn] : null, error: null });
  } };
  return { rpc, calls };
}
function fakeDeps(api: Partial<GmailClient> = {}): GmailJobDeps {
  return {
    refresh: async () => "access-1",
    api: () => ({
      history: async () => ({ notFound: true as const }), listMessageIds: async () => ({ messages: [] }),
      profile: async () => ({ emailAddress: "poc@example.com", historyId: "1" }),
      getMessage: async (id) => mk(id), getMessageMeta: async (id) => mk(id),
      watch: async () => ({ historyId: "1", expiration: "1" }), ...api,
    }),
    encrypt: async (_u, t) => new TextEncoder().encode("ENC(" + t + ")"),
    pause: async () => {}, topic: () => "t",
  };
}
const hex = (s: string) => "\\x" + Array.from(new TextEncoder().encode(s), (x) => x.toString(16).padStart(2, "0")).join("");
const ST = { gmail_get_refresh_token: "rt-1", gmail_state: [{ cursor: "1", last_success_at: "2026-09-20T00:00:00Z" }] };

Deno.test("recordUnsub: one_click url encrypted, msg key, item link; rpc error → 'error' without throwing", async () => {
  const { rpc, calls } = fakeRpc();
  assertEquals(await recordUnsub(rpc, fakeDeps(), USER, CONN, mk("m1", { lu: true }), "item-9"), "recorded");
  assertEquals(calls[0].fn, "worker_record_unsub");
  assertEquals(calls[0].args, { p_user: USER, p_connection: CONN, p_address: "news@example.com", p_name: "합성쇼핑", p_method: "one_click",
    p_url_enc: hex("ENC(https://u.example.com/one?t=1)"), p_msg_key: "gmail:m1", p_occurred_at: new Date(1790000000000).toISOString(), p_item: "item-9" });
  const { rpc: bad } = fakeRpc({}, ["worker_record_unsub"]);
  assertEquals(await recordUnsub(bad, fakeDeps(), USER, CONN, mk("m2", { lu: true }), null), "error");
  const { rpc: r3, calls: c3 } = fakeRpc();
  const noFrom: GmailMessage = { id: "m3", internalDate: "1", payload: { headers: [] } };
  assertEquals(await recordUnsub(r3, fakeDeps(), USER, CONN, noFrom, null), "skipped");
  assertEquals(c3.length, 0);
});

Deno.test("gmail-fetch: promotion discard records (no item), pass with List-Unsubscribe records with item id, plain pass and OTP do not", async () => {
  const msgs: Record<string, GmailMessage> = {
    p: mk("p", { labels: ["INBOX", "CATEGORY_PROMOTIONS"], lu: true }),
    n: mk("n", { lu: true, subject: "합성 소식" }),
    t: mk("t", { subject: "합성 주문 확인" }),
    o: mk("o", { body: "인증번호 483920 을 입력하세요" }),
  };
  const { rpc, calls } = fakeRpc({ ...ST, insert_item: "item-n" });
  assertEquals(await gmailFetch(rpc, job("gmail-fetch", { ids: ["p", "n", "t", "o"] }), fakeDeps({ getMessage: async (id) => msgs[id] })), "fetched");
  const recs = calls.filter((c) => c.fn === "worker_record_unsub").map((c) => [c.args.p_msg_key, c.args.p_item]);
  assertEquals(recs, [["gmail:p", null], ["gmail:n", "item-n"]]);
  assertEquals(calls.filter((c) => c.fn === "insert_item").map((c) => c.args.p_idempotency_key), ["gmail:n", "gmail:t"]);
});

Deno.test("gmail-fetch: unsub record failure never fails the fetch; duplicate insert (null id) skips the record", async () => {
  const { rpc, calls } = fakeRpc({ ...ST, insert_item: null }, ["worker_record_unsub"]);
  const msgs: Record<string, GmailMessage> = { p: mk("p", { labels: ["CATEGORY_PROMOTIONS"], lu: true }), n: mk("n", { lu: true }) };
  assertEquals(await gmailFetch(rpc, job("gmail-fetch", { ids: ["p", "n"] }), fakeDeps({ getMessage: async (id) => msgs[id] })), "fetched");
  assertEquals(calls.filter((c) => c.fn === "worker_record_unsub").map((c) => c.args.p_msg_key), ["gmail:p"]);   // n 은 중복(null id) → 기록 없음
});

// 리뷰 H4: 기록 RPC 가 끝나지 않아도 gmail-fetch 는 예산 안에 다음 메일로 간다
Deno.test("gmail-fetch: a hanging record RPC does not hold the fetch (budget → 'error', mail still stored)", async () => {
  const calls: string[] = [];
  const results: Record<string, unknown> = { ...ST, insert_item: "item-n" };
  const rpc: RpcClient = { rpc: (fn, _args = {}) => {
    calls.push(fn);
    if (fn === "worker_record_unsub") return new Promise(() => {});                         // 끝나지 않는 RPC
    return Promise.resolve({ data: fn in results ? results[fn] : null, error: null });
  } };
  const t0 = Date.now();
  assertEquals(await recordUnsub(rpc, { ...fakeDeps(), unsubBudgetMs: 50 }, USER, CONN, mk("m1", { lu: true }), null), "error");
  const msgs: Record<string, GmailMessage> = { p: mk("p", { labels: ["CATEGORY_PROMOTIONS"], lu: true }), n: mk("n", { lu: true }) };
  assertEquals(await gmailFetch(rpc, job("gmail-fetch", { ids: ["p", "n"] }), { ...fakeDeps({ getMessage: async (id) => msgs[id] }), unsubBudgetMs: 50 }), "fetched");
  assert(Date.now() - t0 < 2000, "budget not applied");
  assertEquals(calls.filter((f) => f === "insert_item").length, 1);                         // 광고 기록이 멈춰도 다음 메일은 저장됐다
});

// 리뷰 U4-I1: 예산은 호출당이라 기록 RPC 가 계통적으로 멈추면 잡 지연이 예산 × 기록 수로 커진다 → 첫 실패 뒤 그 잡의 나머지 기록은 건너뛴다
Deno.test("gmail-fetch: after the first record failure the job skips the rest of its records (one budget per job), storing/discarding unchanged", async () => {
  const msgs: Record<string, GmailMessage> = {
    p1: mk("p1", { labels: ["CATEGORY_PROMOTIONS"], lu: true }), t: mk("t", { subject: "합성 주문 확인" }),
    p2: mk("p2", { labels: ["CATEGORY_PROMOTIONS"], lu: true }), n: mk("n", { lu: true, subject: "합성 소식" }),
  };
  const ids = ["p1", "t", "p2", "n"];
  const run = async (hang: boolean) => {
    const calls: string[] = [];
    const logs: string[] = [];
    const results: Record<string, unknown> = { ...ST, insert_item: "item-x" };
    const rpc: RpcClient = { rpc: (fn, _args = {}) => {
      calls.push(fn);
      if (hang && fn === "worker_record_unsub") return new Promise(() => {});                 // 끝나지 않는 RPC
      return Promise.resolve({ data: fn in results ? results[fn] : null, error: null });
    } };
    const log = console.log;
    console.log = (s: string) => { logs.push(s); };
    const t0 = Date.now();
    try {
      const r = await gmailFetch(rpc, job("gmail-fetch", { ids }), { ...fakeDeps({ getMessage: async (id) => msgs[id] }), unsubBudgetMs: 100 });
      return { r, ms: Date.now() - t0, calls, logs };
    } finally { console.log = log; }
  };
  const ok = await run(false), hung = await run(true);
  assertEquals(ok.calls.filter((f) => f === "worker_record_unsub").length, 3);              // 기록 대상 3건(p1·p2 폐기 + n 저장)
  assertEquals(hung.calls.filter((f) => f === "worker_record_unsub").length, 1);
  assert(hung.ms < 200, `elapsed ${hung.ms}ms ≥ 2 × budget`);
  assertEquals(hung.r, ok.r);
  assertEquals(hung.calls.filter((f) => f === "insert_item"), ok.calls.filter((f) => f === "insert_item"));
  const fetchLog = (l: string[]) => l.find((s) => s.includes('"gmail_fetch"'));
  assertEquals(fetchLog(hung.logs), fetchLog(ok.logs));                                     // stored·discarded·gone 그대로
  assertEquals(hung.logs.filter((s) => s.includes("unsub_record_skipped")).map((s) => JSON.parse(s)),
    [{ connection_id: CONN, code: "unsub_record_skipped", n: 2 }]);
  assertEquals(ok.logs.filter((s) => s.includes("unsub_record_skipped")), []);
});

Deno.test("gmail-unsub-scan: list query + gate targets → gmail-unsub-fetch jobs of 50 on the payload lease, backfill lane", async () => {
  const ids = Array.from({ length: 70 }, (_, i) => "s" + i);
  const qs: string[] = [];
  const { rpc, calls } = fakeRpc({ ...ST, unsub_scan_targets: [{ gmail_id: "s3", item_id: "item-3" }, { gmail_id: "g1", item_id: "item-g" }] });
  const deps = fakeDeps({ listMessageIds: async (q, p) => { qs.push(q); return p ? { messages: ids.slice(60).map((id) => ({ id })) } : { messages: ids.slice(0, 60).map((id) => ({ id })), nextPageToken: "1" }; } });
  assertEquals(await gmailUnsubScan(rpc, job("gmail-unsub-scan", { backfill: true, lease_key: "test:r:backfill:" + USER }), deps), "scanned");
  assertEquals(qs, [UNSUB_SCAN_Q, UNSUB_SCAN_Q]);
  const enq = calls.filter((c) => c.fn === "enqueue_job");
  assertEquals(enq.map((c) => [c.args.p_kind, c.args.p_lease_key, (c.args.p_payload as { msgs: unknown[] }).msgs.length]),
    [["gmail-unsub-fetch", "test:r:backfill:" + USER, 50], ["gmail-unsub-fetch", "test:r:backfill:" + USER, 21]]);
  const all = enq.flatMap((c) => (c.args.p_payload as { msgs: { id: string; item: string | null }[] }).msgs);
  assertEquals(all.find((m) => m.id === "s3"), { id: "s3", item: "item-3" });
  assertEquals(all.find((m) => m.id === "g1"), { id: "g1", item: "item-g" });
  assertEquals((enq[0].args.p_payload as { backfill: boolean }).backfill, true);
});

Deno.test("gmail-unsub-fetch: metadata only; gate target recorded with item, promo label/(광고) recorded, plain skipped, 404 skipped", async () => {
  const meta: Record<string, GmailMessage> = {
    a: mk("a", { lu: true }), b: mk("b", { labels: ["CATEGORY_PROMOTIONS"], lu: true }), c: mk("c", { subject: "(광고) 합성 세일" }), d: mk("d"),
  };
  const got: string[] = [];
  const { rpc, calls } = fakeRpc(ST);
  const deps = fakeDeps({
    getMessage: async () => { throw new Error("full format must not be used"); },
    getMessageMeta: async (id) => { got.push(id); if (id === "gone") throw new GmailHttpError("messages.get", 404); return meta[id]; },
  });
  const msgs = [{ id: "a", item: "item-a" }, { id: "b", item: null }, { id: "c", item: null }, { id: "d", item: null }, { id: "gone", item: null }];
  assertEquals(await gmailUnsubFetch(rpc, job("gmail-unsub-fetch", { msgs }), deps), "fetched");
  assertEquals(got, ["a", "b", "c", "d", "gone"]);
  assertEquals(calls.filter((c) => c.fn === "worker_record_unsub").map((c) => [c.args.p_msg_key, c.args.p_item]),
    [["gmail:a", "item-a"], ["gmail:b", null], ["gmail:c", null]]);
});

// 리뷰 M2: 스캔은 기록 자체가 목적이라 실패를 done 으로 숨기지 않는다(잡 재시도, 기록은 멱등)
Deno.test("gmail-unsub-fetch: a record error fails the job for retry", async () => {
  const { rpc } = fakeRpc(ST, ["worker_record_unsub"]);
  const deps = fakeDeps({ getMessageMeta: async (id) => mk(id, { lu: true }) });
  await assertRejects(() => gmailUnsubFetch(rpc, job("gmail-unsub-fetch", { msgs: [{ id: "a", item: "item-a" }] }), deps), Error, "unsub_record_error");
});

// 리뷰 N4: 재동기화 공백 스캔은 after: 로 그 구간만, 30일보다 오래되면 30일로 자른다
Deno.test("gmail-unsub-scan: payload.after narrows the list query and gate targets; lease defaults to backfill:<user>", async () => {
  const after = Math.floor(Date.now() / 1000) - 3 * 86_400;
  assertEquals(unsubScanQuery(after), `after:${after} {category:promotions subject:광고} -in:drafts`);
  assertEquals(unsubScanQuery(null), UNSUB_SCAN_Q);
  const qs: string[] = [];
  const { rpc, calls } = fakeRpc({ ...ST, unsub_scan_targets: [] });
  const deps = fakeDeps({ listMessageIds: async (q) => { qs.push(q); return { messages: [{ id: "x1" }] }; } });
  assertEquals(await gmailUnsubScan(rpc, job("gmail-unsub-scan", { backfill: true, after }), deps), "scanned");
  assertEquals(qs, [unsubScanQuery(after)]);
  assertEquals(calls.find((c) => c.fn === "unsub_scan_targets")!.args.p_since, new Date(after * 1000).toISOString());
  assertEquals(calls.find((c) => c.fn === "enqueue_job")!.args.p_lease_key, "backfill:" + USER);
  const old = Math.floor(Date.now() / 1000) - 90 * 86_400;
  const { rpc: r2 } = fakeRpc({ ...ST, unsub_scan_targets: [] });
  qs.length = 0;
  await gmailUnsubScan(r2, job("gmail-unsub-scan", { backfill: true, after: old }), deps);
  assert(Number(qs[0].match(/^after:(\d+) /)![1]) > old + 50 * 86_400, qs[0]);              // 30일로 잘림
});

Deno.test("gmail-sync: resync calls onResync once with the last success time, history mode does not; enqueueUnsubRescan never throws", async () => {
  const seen: string[] = [];
  const onResync = async (_sb: RpcClient, u: string, c: string, at: string) => { seen.push(`${u}|${c}|${at}`); };
  const { rpc } = fakeRpc(ST);
  assertEquals(await gmailSync(rpc, job("gmail-sync"), { ...fakeDeps(), onResync }), "resync");     // fakeDeps 기본 history = 404
  assertEquals(seen, [`${USER}|${CONN}|2026-09-20T00:00:00Z`]);
  const hist = fakeDeps({ history: async () => ({ history: [], historyId: "2" }) });
  assertEquals(await gmailSync(rpc, job("gmail-sync"), { ...hist, onResync }), "history");
  assertEquals(seen.length, 1);
  const { rpc: r2, calls: c2 } = fakeRpc();
  await enqueueUnsubRescan(r2, USER, CONN, "2026-09-20T00:00:00Z");
  assertEquals(c2.map((c) => [c.args.p_kind, c.args.p_lease_key, c.args.p_payload]), [["gmail-unsub-scan", "backfill:" + USER,
    { connection_id: CONN, backfill: true, lease_key: "backfill:" + USER, after: Math.floor(Date.parse("2026-09-20T00:00:00Z") / 1000) - 86_400 }]]);
  const { rpc: bad } = fakeRpc({}, ["enqueue_job"]);
  await enqueueUnsubRescan(bad, USER, CONN, "2026-09-20T00:00:00Z");                           // 실패를 삼킨다(sync 는 계속)
});

// 리뷰 U4 M3: 배선이 빠지거나 스캔 간격이 실시간 간격으로 돌아가도 다른 테스트는 모두 통과한다 → 직접 단언
Deno.test("wiring: default onResync is enqueueUnsubRescan; gmail-unsub-fetch paces at 400ms (scan gap, not the 240ms fetch gap)", async () => {
  assertEquals(defaultGmailDeps.onResync, enqueueUnsubRescan);
  const paused: number[] = [];
  const { rpc } = fakeRpc(ST);
  const deps = { ...fakeDeps({ getMessageMeta: async (id) => { if (id === "gone") throw new GmailHttpError("messages.get", 404); return mk(id); } }),
    pause: async (ms: number) => { paused.push(ms); } };
  await gmailUnsubFetch(rpc, job("gmail-unsub-fetch", { msgs: [{ id: "a", item: null }, { id: "gone", item: null }] }), deps);
  assertEquals(paused, [400, 400]);
});
