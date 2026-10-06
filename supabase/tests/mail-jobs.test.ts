import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { Deferred } from "../functions/_shared/budget.ts";
import { GmailHttpError, type GmailMailApi } from "../functions/_shared/gmail.ts";
import type { Job } from "../functions/_shared/job.ts";
import { type Action, MAIL_JOB_BUDGET_MS, mailActionJob, type MailJobDeps, type Method, type Phase, QUOTA_STUCK_MS, RETRY_DEFER_MS } from "../functions/worker/mail-action.ts";

// 메일 정리 잡(스펙 §7 실행·되돌리기): 행·DB 는 메모리 흉내(progress 는 커서 비교 — 0030 과 같은 규칙), Gmail 은 가짜.
// 시계는 Gmail 호출마다(성공·실패 모두) step ms 씩 간다 — 예산 검사가 호출 직전마다 있는지 본다(Codex C1)
const USER = "00000000-0000-0000-0000-0000000000aa", T0 = 1_790_000_000_000;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
const job = (phase: Phase = "execute", attempts = 1): Job =>
  ({ id: "job-1", kind: "mail-action", user_id: USER, payload: { id: "row-1", phase, connection_id: "conn-1" }, attempts, checkpoint: null });
const E = (s: number, ...r: string[]) => new GmailHttpError("x", s, r);
const iso = (ms: number) => new Date(ms).toISOString();

type Opts = { action?: Action; phase?: Phase; ids?: string[]; method?: Method | null; status?: string; api?: Partial<GmailMailApi>;
  token?: string | { code: "reauth_required" | "no_connection" }; take?: (units: number) => boolean; step?: number; failProgressOnce?: boolean; quotaSince?: string };
function harness(o: Opts = {}) {
  const phase = o.phase ?? "execute", list = o.ids ?? ids(3);
  const st = { status: o.status ?? (phase === "execute" ? "running" : "undoing"), cursor: 0, ok: [] as string[], failed: [] as string[],
    method: (o.method ?? null) as Method | null, finished: undefined as string | null | undefined, quotaSince: (o.quotaSince ?? null) as string | null,
    taken: [] as number[], gmail: [] as string[], logs: [] as Record<string, unknown>[] };
  let failOnce = o.failProgressOnce ?? false, t = T0;
  const now = () => t;
  const raw: GmailMailApi = {
    list: () => Promise.resolve({}), headers: (id) => Promise.resolve({ id, internalDate: "0" }),
    labels: (id) => { st.gmail.push("labels:" + id); return Promise.resolve({ id, labelIds: [] }); },
    batchModify: (b, a, r) => { st.gmail.push(`batch:${b.length}:+${a.join()}:-${r.join()}`); return Promise.resolve(); },
    trash: (id) => { st.gmail.push("trash:" + id); return Promise.resolve(); },
    untrash: (id) => { st.gmail.push("untrash:" + id); return Promise.resolve(); },
    modify: (id, a, r) => { st.gmail.push(`modify:${id}:+${a.join()}:-${r.join()}`); return Promise.resolve(); },
    ...o.api,
  };
  const api = Object.fromEntries(Object.entries(raw).map(([k, f]) =>
    [k, (...a: unknown[]) => { t += o.step ?? 0; return (f as (...x: unknown[]) => Promise<unknown>)(...a); }])) as unknown as GmailMailApi;
  const d: MailJobDeps = {
    begin: () => Promise.resolve(st.status === "gone" ? null : (st.status === "running" || st.status === "undoing")
      ? { status: st.status, action: o.action ?? "trash", method: st.method, connection_id: "conn-1", ids: list, cursor: st.cursor } : { status: st.status }),
    token: () => Promise.resolve(o.token ?? "access-1"),
    api: () => api,
    take: (_user, units) => { st.taken.push(units); return Promise.resolve((o.take ?? (() => true))(units)); },
    setMethod: (_u, _i, m) => { if (st.method === null || (st.method === "batch" && m === "single")) st.method = m; return Promise.resolve(); },
    progress: (_u, _i, _p, from, to, ok, failed) => {
      if (failOnce) { failOnce = false; return Promise.reject(new Error("connection reset")); }   // Gmail 성공 뒤·기록 전 죽음
      if (from !== st.cursor || ok.length + failed.length !== to - from) return Promise.resolve(false);
      st.cursor = to; st.ok.push(...ok); st.failed.push(...failed); st.quotaSince = null;
      return Promise.resolve(true);
    },
    quota: () => Promise.resolve(st.quotaSince ??= iso(now())),
    finish: (_u, _i, _p, code) => { st.failed.push(...list.slice(st.cursor)); st.cursor = list.length; st.finished = code; return Promise.resolve(); },
    now, log: (x) => { st.logs.push(x); },
  };
  return { d, st };
}

Deno.test("execute trash: one batchModify(+TRASH) for all ids, 50 units, method batch, clean finish, elapsed in the done log", async () => {
  const { d, st } = harness();
  assertEquals(await mailActionJob(d, job()), "done");
  assertEquals([st.gmail, st.taken, st.method, st.ok, st.failed, st.finished], [["batch:3:+TRASH:-"], [50], "batch", ids(3), [], null]);
  assertEquals([st.logs.at(-1)?.mail_action, typeof st.logs.at(-1)?.elapsed_ms], ["done", "number"]);
});

Deno.test("batch TRASH rejected with 400 → per-message trash in the same job (20 units each), method single", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(400, "invalidArgument")) } });
  assertEquals(await mailActionJob(d, job()), "done");
  assertEquals([st.gmail, st.taken, st.method, st.ok], [["trash:m1", "trash:m2", "trash:m3"], [50, 60], "single", ids(3)]);
});

Deno.test("quota (429, 403 rate/quota reasons) → defer one minute, no fallback; stuck over 30 minutes → plain error (fail_job)", async () => {
  for (const e of [E(429), E(403, "rateLimitExceeded"), E(403, "userRateLimitExceeded"), E(403, "quotaExceeded")]) {
    const { d, st } = harness({ api: { batchModify: () => Promise.reject(e) } });
    const err = await assertRejects(() => mailActionJob(d, job()), Deferred);
    assertEquals([err.message, err.until, st.gmail, st.method, st.cursor], ["mail_quota", iso(T0 + 60_000), [], "batch", 0]);
  }
  const { d } = harness({ quotaSince: iso(T0 - QUOTA_STUCK_MS - 1), api: { batchModify: () => Promise.reject(E(429)) } });
  const e2 = await assertRejects(() => mailActionJob(d, job()));
  assert(!(e2 instanceof Deferred));
  assertEquals((e2 as Error).message, "mail_quota_stuck");
});

Deno.test("403 insufficientPermissions → close as scope_missing (rest failed), no retry, no fallback", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(403, "insufficientPermissions")) } });
  assertEquals(await mailActionJob(d, job()), "scope_missing");
  assertEquals([st.finished, st.failed, st.ok, st.method], ["scope_missing", ids(3), [], "batch"]);
});

Deno.test("token problems close the row with the connection code and never call Gmail (the SQL gives an untouched undo back, M3)", async () => {
  for (const phase of ["execute", "undo"] as const) {
    for (const code of ["reauth_required", "no_connection"] as const) {
      const { d, st } = harness({ phase, token: { code } });
      assertEquals(await mailActionJob(d, job(phase)), code);
      assertEquals([st.finished, st.gmail, st.taken], [code, [], []]);
    }
  }
});

Deno.test("single mode: a 404 or 400 on one message fails only that id", async () => {
  const { d, st } = harness({ method: "single", api: { trash: (id) => id === "m2" ? Promise.reject(E(404)) : id === "m3" ? Promise.reject(E(400)) : Promise.resolve() } });
  assertEquals(await mailActionJob(d, job()), "done");
  assertEquals([st.ok, st.failed, st.taken], [["m1"], ["m2", "m3"], [60]]);
});

Deno.test("unknown result (5xx, other 403, timeout) with no progress in this run, before the last attempt → plain error, nothing recorded, same batch next time", async () => {
  for (const e of [E(500), E(403, "forbidden"), new DOMException("t", "TimeoutError")]) {
    const { d, st } = harness({ api: { batchModify: () => Promise.reject(e) } });
    const err = await assertRejects(() => mailActionJob(d, job()));
    assert(!(err instanceof Deferred));
    assertEquals([st.cursor, st.ok, st.finished], [0, [], undefined]);
  }
});

Deno.test("unknown result after progress in the same run → defer one minute (attempts kept), even on the last attempt", async () => {
  for (const attempts of [1, 5]) {
    const { d, st } = harness({ method: "single", api: { trash: (id) => id === "m2" ? Promise.reject(E(500)) : Promise.resolve() } });
    const e = await assertRejects(() => mailActionJob(d, job("execute", attempts)), Deferred);
    assertEquals([e.message, e.until, st.cursor, st.ok, st.finished], ["mail_retry", iso(T0 + RETRY_DEFER_MS), 1, ["m1"], undefined]);
  }
});

Deno.test("last attempt with an unknown result and no progress → reread labels (20 units each): target state ok, others failed, then close", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(503)),
    labels: (id) => id === "m2" ? Promise.resolve({ id, labelIds: ["INBOX"] }) : id === "m3" ? Promise.reject(E(404)) : Promise.resolve({ id, labelIds: ["TRASH"] }) } });
  assertEquals(await mailActionJob(d, job("execute", 5)), "verified");
  assertEquals([st.ok, st.failed, st.finished, st.taken], [["m1"], ["m2", "m3"], null, [50, 60]]);
});

Deno.test("single mode, last attempt, unknown result on the first call → reread only that id, record it, carry on with the rest (never fail unsent ids)", async () => {
  for (const [labelIds, ok, failed] of [[["TRASH"], ["m1"], []], [["INBOX"], [], ["m1"]]] as const) {
    const read: string[] = [];
    const { d, st } = harness({ method: "single", ids: ids(100),
      api: { trash: (id) => id === "m1" ? Promise.reject(E(500)) : Promise.resolve(), labels: (id) => { read.push(id); return Promise.resolve({ id, labelIds: [...labelIds] }); } } });
    const e = await assertRejects(() => mailActionJob(d, job("execute", 5)), Deferred);
    assertEquals([e.message, e.until, st.cursor, st.ok, st.failed, st.finished, st.taken], ["mail_retry", iso(T0 + RETRY_DEFER_MS), 1, ok, failed, undefined, [400, 20]]);
    assertEquals(read, ["m1"]);
    assertEquals(await mailActionJob(d, job("execute", 5)), "done");             // defer_job −1·클레임 +1 = 다음도 5: 나머지 99건을 보낸다
    assertEquals([st.ok.length + st.failed.length, st.failed, read], [100, failed, ["m1"]]);
  }
});

Deno.test("reread hits quota → records what it read and defers (quota rule), never marks the rest failed", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(503)),
    labels: (id) => id === "m2" ? Promise.reject(E(429)) : Promise.resolve({ id, labelIds: ["TRASH"] }) } });
  const e = await assertRejects(() => mailActionJob(d, job("execute", 5)), Deferred);
  assertEquals([e.message, e.until, st.cursor, st.ok, st.failed, st.finished], ["mail_quota", iso(T0 + 60_000), 1, ["m1"], [], undefined]);
});

Deno.test("worker dies after Gmail success but before progress → next run resends the same batch and the result has no duplicates", async () => {
  const h = harness({ failProgressOnce: true });
  await assertRejects(() => mailActionJob(h.d, job()));
  assertEquals(h.st.cursor, 0);
  assertEquals(await mailActionJob(h.d, job("execute", 2)), "done");
  assertEquals([h.st.gmail, h.st.ok, h.st.failed], [["batch:3:+TRASH:-", "batch:3:+TRASH:-"], ids(3), []]);
});

Deno.test("worker dies in the middle of a single chunk (7 trashed, nothing recorded) → rerun resends from the cursor without duplicates", async () => {
  const sent: string[] = [];
  let boom = 1;
  const h = harness({ method: "single", ids: ids(20), failProgressOnce: true,
    api: { trash: (id) => { sent.push(id); return id === "m8" && boom-- > 0 ? Promise.reject(E(500)) : Promise.resolve(); } } });
  await assertRejects(() => mailActionJob(h.d, job()));                         // 7통 뒤 결과 불명 → 기록 시도에서 죽음
  assertEquals(h.st.cursor, 0);
  assertEquals(await mailActionJob(h.d, job("execute", 2)), "done");
  assertEquals([h.st.ok, h.st.failed, sent.filter((x) => x === "m1").length, sent.length], [ids(20), [], 2, 28]);
});

Deno.test("stale: another worker already recorded the batch → stop without finishing", async () => {
  const { d, st } = harness();
  d.progress = () => Promise.resolve(false);
  assertEquals(await mailActionJob(d, job()), "stale");
  assertEquals(st.finished, undefined);
});

Deno.test("no units this minute → defer to the next minute before any Gmail call", async () => {
  const { d, st } = harness({ take: () => false });
  const e = await assertRejects(() => mailActionJob(d, job()), Deferred);
  assertEquals([e.message, e.until, st.gmail], ["mail_units", iso(Math.floor(T0 / 60_000) * 60_000 + 60_000), []]);
});

Deno.test("budget is checked before every single call: 10 s per call → 3 calls, those 3 recorded, then defer to now", async () => {
  const { d, st } = harness({ method: "single", ids: ids(45), step: 10_000 });
  const e = await assertRejects(() => mailActionJob(d, job()), Deferred);
  assertEquals([e.message, e.until, st.cursor, st.ok, st.gmail.length], ["mail_budget", iso(T0 + 30_000), 3, ["m1", "m2", "m3"], 3]);
  assert(30_000 >= MAIL_JOB_BUDGET_MS);
});

Deno.test("budget is checked before every reread call: records what it read, defers, does not close", async () => {
  const { d, st } = harness({ step: 10_000, api: { batchModify: () => Promise.reject(E(503)), labels: (id) => Promise.resolve({ id, labelIds: ["TRASH"] }) } });
  const e = await assertRejects(() => mailActionJob(d, job("execute", 5)), Deferred);
  assertEquals([e.message, st.cursor, st.ok, st.finished, st.taken], ["mail_budget", 2, ["m1", "m2"], undefined, [50, 60]]);
});

Deno.test("scattered transient errors over 100 single ids never use attempts (each follows progress) and never close the row early", async () => {
  const flaky = new Set(["m10", "m30", "m50", "m70", "m90"]);
  const { d, st } = harness({ method: "single", ids: ids(100),
    api: { trash: (id) => flaky.delete(id) ? Promise.reject(E(500)) : Promise.resolve() } });
  let attempts = 1, plain = 0, deferred = 0, r = "";
  for (let i = 0; i < 20 && !r; i++) {
    try { r = await mailActionJob(d, job("execute", attempts)); }
    catch (e) { if (e instanceof Deferred) deferred++; else { plain++; attempts++; } }   // defer_job −1·클레임 +1 = 그대로, fail_job = +1
  }
  assertEquals([r, plain, deferred, st.ok.length, st.failed.length, st.finished], ["done", 0, 5, 100, 0, null]);
});

Deno.test("read: execute removes UNREAD in one batch; batch 404 → per-message modify; undo adds UNREAD back with batch even after single", async () => {
  const r1 = harness({ action: "read" });
  assertEquals(await mailActionJob(r1.d, job()), "done");
  assertEquals(r1.st.gmail, ["batch:3:+:-UNREAD"]);
  const r2 = harness({ action: "read", api: { batchModify: () => Promise.reject(E(404)) } });
  assertEquals(await mailActionJob(r2.d, job()), "done");
  assertEquals(r2.st.gmail, ["modify:m1:+:-UNREAD", "modify:m2:+:-UNREAD", "modify:m3:+:-UNREAD"]);
  const r3 = harness({ action: "read", phase: "undo", method: "single" });
  assertEquals(await mailActionJob(r3.d, job("undo")), "done");
  assertEquals(r3.st.gmail, ["batch:3:+UNREAD:-"]);
});

Deno.test("undo trash follows the execute method: single → untrash each (5 units), batch → remove TRASH once; trash batch 404 → per-message (D9)", async () => {
  const s = harness({ phase: "undo", method: "single" });
  assertEquals(await mailActionJob(s.d, job("undo")), "done");
  assertEquals([s.st.gmail, s.st.taken], [["untrash:m1", "untrash:m2", "untrash:m3"], [15]]);
  const b = harness({ phase: "undo", method: "batch" });
  assertEquals(await mailActionJob(b.d, job("undo")), "done");
  assertEquals(b.st.gmail, ["batch:3:+:-TRASH"]);
  const g = harness({ api: { batchModify: () => Promise.reject(E(404)) } });
  assertEquals(await mailActionJob(g.d, job()), "done");                        // 휴지통 batch 404 = 사라진 id 섞임 → 건별(그 id 만 실패)
  assertEquals([g.st.gmail, g.st.method, g.st.taken], [["trash:m1", "trash:m2", "trash:m3"], "single", [50, 60]]);
  const u = harness({ phase: "undo", method: "batch", api: { batchModify: () => Promise.reject(E(404)), untrash: (id) => id === "m2" ? Promise.reject(E(404)) : Promise.resolve() } });
  assertEquals(await mailActionJob(u.d, job("undo")), "done");
  assertEquals([u.st.ok, u.st.failed, u.st.method], [["m1", "m3"], ["m2"], "batch"]);   // 되돌리기 전환은 method 에 남기지 않는다
});

Deno.test("row gone → gone; finished row → noop; neither calls Gmail nor finishes", async () => {
  for (const [status, want] of [["gone", "gone"], ["done", "noop"], ["undone", "noop"]]) {
    const { d, st } = harness({ status });
    assertEquals(await mailActionJob(d, job()), want);
    assertEquals([st.gmail, st.finished], [[], undefined]);
  }
});

Deno.test("quota in the middle of single mode records what was done, then defers", async () => {
  let n = 0;
  const { d, st } = harness({ method: "single", api: { trash: () => (++n === 3 ? Promise.reject(E(429)) : Promise.resolve()) } });
  await assertRejects(() => mailActionJob(d, job()), Deferred);
  assertEquals([st.cursor, st.ok], [2, ["m1", "m2"]]);
});

Deno.test("logs carry codes and counts only (no message ids); the job's deps never touch items or facts", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(400)) } });
  await mailActionJob(d, job());
  const text = JSON.stringify(st.logs);
  assert(!/m\d/.test(text), text);
  const src = await Deno.readTextFile(new URL("../functions/worker/mail-action-deps.ts", import.meta.url));
  assert(!/insert_item|save_fact|worker_set_item_status|delete_gmail_source|from\("items"\)|from\("facts"\)/.test(src));
});
