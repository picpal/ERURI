import { assert, assertEquals } from "jsr:@std/assert";
import { GmailHttpError, type GmailMessage } from "../functions/_shared/gmail.ts";
import { type Counts, handleMailAction, type MailActionDeps, type MailConnection, type RowResult, RpcError, sampleOf } from "../functions/mail-action/handler.ts";

// 메일 정리 함수(스펙 §7): 가짜 deps(DB·Gmail 없음). 미리보기 글·조건 값이 로그에 남지 않는지도 본다
const MOD = "https://www.googleapis.com/auth/gmail.modify", RO = "https://www.googleapis.com/auth/gmail.readonly";
const USER = "00000000-0000-0000-0000-0000000000aa", CONN = "00000000-0000-0000-0000-0000000000cc", TOKEN = "11111111-1111-4111-8111-111111111111";
const mk = (id: string, from = "합성상점 <shop@example.com>", subject = "합성 광고 " + id) =>
  ({ id, internalDate: "1790000000000", payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] } }) as GmailMessage;
type Page = { messages?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number };
const C = (status: string, x: Partial<Counts> = {}): Counts =>
  ({ id: TOKEN, status, total: 3, done: 0, failed: 0, undone: 0, undo_failed: 0, code: null, method: null, ...x });
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

type FakeOpts = { user?: string | null; conn?: Partial<MailConnection> | null; enabled?: boolean; token?: string | null; tokenThrows?: boolean; pages?: Page[]; starred?: number;
  list?: (q: string, n: number, p?: string) => Promise<Page>; headers?: (id: string) => Promise<GmailMessage>; row?: string | null;
  start?: RowResult; undo?: RowResult; status?: Counts | null; step?: number };
function fake(o: FakeOpts = {}) {
  const calls = { list: [] as { q: string; n: number; p?: string }[], headers: [] as string[], notes: [] as number[],
    rows: [] as { action: string; ids: string[] }[], kicks: 0, starts: [] as string[], undos: [] as string[], tokens: 0 };
  const pages = o.pages ?? [{ messages: [{ id: "a" }, { id: "b" }, { id: "c" }], resultSizeEstimate: 3 }];
  let clock = 0;
  const d: MailActionDeps = {
    enabled: () => o.enabled ?? true,
    authUser: (t) => Promise.resolve(t === "user-jwt" ? (o.user === undefined ? USER : o.user) : null),
    connection: () => Promise.resolve(o.conn === null ? null : { connection_id: CONN, account_ref: "poc@example.com", status: "active", scopes: [RO, MOD], ...o.conn }),
    accessToken: () => { calls.tokens++; return o.tokenThrows ? Promise.reject(new Error("token refresh 503")) : Promise.resolve(o.token === undefined ? "at" : o.token); },
    api: () => ({
      list: (q, n, p) => {
        calls.list.push({ q, n, p });
        if (o.list) return o.list(q, n, p);
        return Promise.resolve(n === 1 ? { resultSizeEstimate: o.starred ?? 0 } : pages[p ? Number(p) : 0]);
      },
      headers: (id) => { calls.headers.push(id); return o.headers ? o.headers(id) : Promise.resolve(mk(id)); },
    }),
    noteUnits: (_u, n) => { calls.notes.push(n); return Promise.resolve(); },
    createRow: (_u, _c, action, ids) => { calls.rows.push({ action, ids }); return Promise.resolve(o.row === undefined ? TOKEN : o.row); },
    start: (_u, id) => { calls.starts.push(id); return Promise.resolve(o.start ?? { result: "started", ...C("pending") }); },
    undo: (_u, id) => { calls.undos.push(id); return Promise.resolve(o.undo ?? { result: "started", ...C("undo_pending") }); },
    status: () => Promise.resolve(o.status === undefined ? C("running") : o.status),
    kick: () => { calls.kicks++; },
    now: () => (clock += o.step ?? 0),                                   // 부를 때마다 step ms(미리보기 예산)
  };
  return { d, calls };
}
const req = (path: string, body?: unknown, o: { method?: string; token?: string | null } = {}) => new Request("http://x/functions/v1/mail-action/" + path, {
  method: o.method ?? (body === undefined ? "GET" : "POST"), body: body === undefined ? undefined : JSON.stringify(body),
  headers: { "content-type": "application/json", ...(o.token === null ? {} : { authorization: `Bearer ${o.token ?? "user-jwt"}` }) } });
const mail = (x: Record<string, unknown> = {}) =>
  ({ action: "trash", sender: "합성상점", subject_words: [], received_from: null, received_to: null, promotions: true, unread_only: false, ...x });
async function quiet<T>(f: () => Promise<T>): Promise<{ r: T; lines: string[] }> {
  const lines: string[] = [], orig = console.log;
  console.log = (s: unknown) => { lines.push(String(s)); };
  try { return { r: await f(), lines }; } finally { console.log = orig; }
}
const call = async (d: MailActionDeps, r: Request) => (await quiet(() => handleMailAction(r, d))).r;

Deno.test("401 without or with an invalid JWT; unknown route 404; nothing else is called", async () => {
  const { d, calls } = fake();
  assertEquals((await call(d, req("preview", mail(), { token: null }))).status, 401);
  assertEquals((await call(d, req("preview", mail(), { token: "bad" }))).status, 401);
  assertEquals((await call(d, req("purge", {}))).status, 404);
  assertEquals([calls.list.length, calls.rows.length], [0, 0]);
});

Deno.test("preview: server builds the query, lists 500 per page, estimates starred, reads 20 headers, creates the row; notes units before calls", async () => {
  const { d, calls } = fake({ starred: 2 });
  const r = await call(d, req("preview", mail()));
  assertEquals(r.status, 200);
  const j = await r.json();
  assertEquals(calls.list, [{ q: `in:inbox -is:starred from:"합성상점" category:promotions`, n: 500, p: undefined },
                            { q: `in:inbox is:starred from:"합성상점" category:promotions`, n: 1, p: undefined }]);
  assertEquals(calls.rows, [{ action: "trash", ids: ["a", "b", "c"] }]);
  assertEquals(calls.notes, [5, 5, 60]);
  assertEquals({ ...j, sample: j.sample.length }, { token: TOKEN, action: "trash", conditions: { action: "trash", sender: "합성상점", subject_words: [],
    received_from: null, received_to: null, promotions: true, unread_only: false }, count: 3, exact: true, total_estimate: 3, starred_estimate: 2, has_more: false, sample: 3 });
  assertEquals(j.sample[0], { from: "합성상점", subject: "합성 광고 a", date: new Date(1790000000000).toISOString() });
});

Deno.test("preview: conditions are the server-confirmed ones (sanitized), a model-written q is ignored", async () => {
  const { d, calls } = fake();
  const j = await (await call(d, req("preview", mail({ sender: `합성"상점"`, q: "in:anywhere" })))).json();
  assertEquals(j.conditions.sender, "합성상점");
  assert(!calls.list[0].q.includes("anywhere"));
  assertEquals(calls.list[1].q, `in:inbox is:starred from:"합성상점" category:promotions`);   // 별표 질의도 정제된 칸으로
});

Deno.test("preview paging: stops at 1,000 ids (has_more, estimate floor = count), exactly 1,000 with no next page is exact, 5-page cap", async () => {
  const p1 = fake({ pages: [{ messages: many("a", 500), nextPageToken: "1", resultSizeEstimate: 900 }, { messages: many("b", 500), nextPageToken: "2" }] });
  const j1 = await (await call(p1.d, req("preview", mail()))).json();
  assertEquals([j1.count, j1.exact, j1.has_more, j1.total_estimate, p1.calls.list.length], [1000, false, true, 1000, 3]);
  const p2 = fake({ pages: [{ messages: many("a", 500), nextPageToken: "1", resultSizeEstimate: 1000 }, { messages: many("b", 500) }] });
  const j2 = await (await call(p2.d, req("preview", mail()))).json();
  assertEquals([j2.count, j2.exact, j2.has_more, j2.total_estimate], [1000, true, false, 1000]);
  const p3 = fake({ pages: [0, 1, 2, 3, 4, 5].map((i) => ({ messages: many(`p${i}-`, 100), nextPageToken: String(i + 1), resultSizeEstimate: 4000 })) });
  const j3 = await (await call(p3.d, req("preview", mail()))).json();
  assertEquals([j3.count, j3.exact, j3.has_more, j3.total_estimate], [500, false, true, 4000]);
  const p4 = fake({ pages: [{ messages: many("a", 400), nextPageToken: "1" }, { messages: many("b", 400), nextPageToken: "2" }, { messages: many("c", 400) }] });
  const j4 = await (await call(p4.d, req("preview", mail()))).json();
  assertEquals([j4.count, j4.exact, j4.has_more], [1000, false, true]);       // 마지막 페이지에서 잘림 = 더 있다
});

Deno.test("bad_condition and needs_target: 400, never lists, never creates a row, values not echoed or logged", async () => {
  const { d, calls } = fake();
  const { r, lines } = await quiet(() => handleMailAction(req("preview", mail({ received_from: "2026-09-30", received_to: "2026-09-01" })), d));
  assertEquals([r.status, await r.json()], [400, { error: "bad_condition", fields: ["received_from", "received_to"] }]);
  const n = await call(d, req("preview", mail({ sender: null, promotions: false })));
  assertEquals([n.status, await n.json()], [400, { error: "needs_target" }]);
  assertEquals([calls.list.length, calls.rows.length], [0, 0]);
  assert(!lines.join("\n").includes("2026-09"));
});

Deno.test("connection and permission: none 404, readonly or null scopes 403 scope_missing, not active or no token 409 reauth_required", async () => {
  assertEquals((await call(fake({ conn: null }).d, req("preview", mail()))).status, 404);
  for (const scopes of [[RO], null]) {
    const f = fake({ conn: { scopes } });
    const r = await call(f.d, req("preview", mail()));
    assertEquals([r.status, await r.json(), f.calls.list.length], [403, { error: "scope_missing" }, 0]);
  }
  assertEquals((await call(fake({ conn: { status: "reauth_required" } }).d, req("preview", mail()))).status, 409);
  assertEquals((await call(fake({ token: null }).d, req("preview", mail()))).status, 409);
});

Deno.test("execute and undo on a connection that is not active → 409 reauth_required before any row change (the one undo is not used up)", async () => {
  for (const [path, body] of [["execute", { token: TOKEN }], ["undo", { id: TOKEN }]] as const) {
    const f = fake({ conn: { status: "reauth_required" } });
    const r = await call(f.d, req(path, body));
    assertEquals([r.status, await r.json(), f.calls.starts.length, f.calls.undos.length], [409, { error: "reauth_required" }, 0, 0]);
  }
});

Deno.test("undo refreshes the token first: none → 409 reauth_required, transient refresh error → 502 gmail_upstream, neither starts the undo", async () => {
  const n = fake({ token: null });
  const r = await call(n.d, req("undo", { id: TOKEN }));
  assertEquals([r.status, await r.json(), n.calls.undos.length], [409, { error: "reauth_required" }, 0]);
  const x = fake({ tokenThrows: true });
  const r2 = await call(x.d, req("undo", { id: TOKEN }));
  assertEquals([r2.status, await r2.json(), x.calls.undos.length], [502, { error: "gmail_upstream" }, 0]);
  const ok = fake();
  assertEquals([(await call(ok.d, req("undo", { id: TOKEN }))).status, ok.calls.tokens, ok.calls.undos.length], [202, 1, 1]);
  const ex = fake();
  await call(ex.d, req("execute", { token: TOKEN }));
  assertEquals(ex.calls.tokens, 0);                                            // 실행은 토큰을 잡이 얻는다(실패해도 Gmail 은 그대로)
});

Deno.test("preview: transient token refresh error or a network TypeError → 502 gmail_upstream, no row; the whole preview stops at 25 s → 502, no row", async () => {
  const x = fake({ tokenThrows: true });
  const r = await call(x.d, req("preview", mail()));
  assertEquals([r.status, await r.json(), x.calls.rows.length], [502, { error: "gmail_upstream" }, 0]);
  const y = fake({ list: () => Promise.reject(new TypeError("error sending request")) });
  assertEquals([(await call(y.d, req("preview", mail()))).status, y.calls.rows.length], [502, 0]);
  const z = fake({ step: 10_000, pages: [0, 1, 2, 3, 4].map((i) => ({ messages: many(`p${i}-`, 100), nextPageToken: String(i + 1) })) });
  const r3 = await call(z.d, req("preview", mail()));
  assertEquals([r3.status, await r3.json(), z.calls.rows.length, z.calls.list.length < 5], [502, { error: "gmail_upstream" }, 0, true]);
});

Deno.test("contract: execute/undo with a non-JSON body → 400 bad_json; 401 and 405 have no body", async () => {
  const { d } = fake();
  const bad = new Request("http://x/functions/v1/mail-action/execute", { method: "POST", body: "{", headers: { authorization: "Bearer user-jwt" } });
  assertEquals([(await call(d, bad)).status], [400]);
  const u = await call(d, req("preview", mail(), { token: null }));
  assertEquals([u.status, await u.text()], [401, ""]);
  const m = await call(d, req("status?id=" + TOKEN, {}));
  assertEquals([m.status, await m.text()], [405, ""]);
  const g = await call(d, req("preview"));
  assertEquals([g.status, await g.text()], [405, ""]);
});

Deno.test("empty preview: 200 token null, count 0, no row, no header reads", async () => {
  const { d, calls } = fake({ pages: [{ resultSizeEstimate: 0 }] });
  const j = await (await call(d, req("preview", mail()))).json();
  assertEquals([j.token, j.count, j.exact, j.sample, calls.rows.length, calls.headers.length], [null, 0, true, [], 0, 0]);
});

Deno.test("samples: a message deleted in between (404) is left out but still counted; other Gmail errors fail the preview", async () => {
  const g = fake({ headers: (id) => id === "b" ? Promise.reject(new GmailHttpError("messages.get", 404)) : Promise.resolve(mk(id)) });
  const j = await (await call(g.d, req("preview", mail()))).json();
  assertEquals([j.count, j.sample.length], [3, 2]);
  const h = fake({ headers: () => Promise.reject(new GmailHttpError("messages.get", 500)) });
  const r = await call(h.d, req("preview", mail()));
  assertEquals([r.status, await r.json(), h.calls.rows.length], [502, { error: "gmail_upstream" }, 0]);
});

Deno.test("Gmail errors map: 429/403 rate → 429, 403 permissions → 403 scope_missing, 401 → 409, 5xx and timeout → 502", async () => {
  const cases: [unknown, number, string][] = [
    [new GmailHttpError("l", 429), 429, "gmail_rate_limited"], [new GmailHttpError("l", 403, ["rateLimitExceeded"]), 429, "gmail_rate_limited"],
    [new GmailHttpError("l", 403, ["insufficientPermissions"]), 403, "scope_missing"], [new GmailHttpError("l", 401), 409, "reauth_required"],
    [new GmailHttpError("l", 500), 502, "gmail_upstream"], [new DOMException("t", "TimeoutError"), 502, "gmail_upstream"]];
  for (const [e, status, code] of cases) {
    const r = await call(fake({ list: () => Promise.reject(e) }).d, req("preview", mail()));
    assertEquals([r.status, await r.json()], [status, { error: code }]);
  }
});

Deno.test("MAIL_ACTIONS off: preview and execute 503 disabled; undo and status still work", async () => {
  const { d, calls } = fake({ enabled: false });
  assertEquals((await call(d, req("preview", mail()))).status, 503);
  assertEquals((await call(d, req("execute", { token: TOKEN }))).status, 503);
  assertEquals([calls.list.length, calls.starts.length, calls.kicks], [0, 0, 0]);
  assertEquals((await call(d, req("undo", { id: TOKEN }))).status, 202);
  assertEquals((await call(d, req("status?id=" + TOKEN))).status, 200);
});

Deno.test("execute: started → 202 + one kick; same token again → 200 current, no kick; not_found 404; expired 410; bad token 400; no scope 403 before start", async () => {
  const s = fake();
  const r = await call(s.d, req("execute", { token: TOKEN }));
  assertEquals([r.status, await r.json(), s.calls.kicks], [202, C("pending"), 1]);
  const c = fake({ start: { result: "current", ...C("running", { done: 1 }) } });
  const r2 = await call(c.d, req("execute", { token: TOKEN }));
  assertEquals([r2.status, (await r2.json()).status, c.calls.kicks], [200, "running", 0]);
  assertEquals((await call(fake({ start: { result: "not_found" } }).d, req("execute", { token: TOKEN }))).status, 404);
  const e = await call(fake({ start: { result: "expired" } }).d, req("execute", { token: TOKEN }));
  assertEquals([e.status, await e.json()], [410, { error: "token_expired" }]);
  assertEquals((await call(s.d, req("execute", { token: "not-a-uuid", ids: ["x"] }))).status, 400);
  const ns = fake({ conn: { scopes: [RO] } });
  assertEquals([(await call(ns.d, req("execute", { token: TOKEN }))).status, ns.calls.starts.length], [403, 0]);
});

Deno.test("undo: started 202 + kick; current 200; busy 409 with counts; nothing_to_undo 409; expired and not_found 410 undo_expired; bad id 400", async () => {
  const s = fake();
  assertEquals([(await call(s.d, req("undo", { id: TOKEN }))).status, s.calls.kicks], [202, 1]);
  assertEquals((await call(fake({ undo: { result: "current", ...C("undone") } }).d, req("undo", { id: TOKEN }))).status, 200);
  const b = await call(fake({ undo: { result: "busy", ...C("running") } }).d, req("undo", { id: TOKEN }));
  assertEquals([b.status, (await b.json()).error], [409, "busy"]);
  const n = await call(fake({ undo: { result: "nothing_to_undo", ...C("failed") } }).d, req("undo", { id: TOKEN }));
  assertEquals([n.status, await n.json()], [409, { error: "nothing_to_undo" }]);
  for (const result of ["expired", "not_found"]) {
    const x = await call(fake({ undo: { result } }).d, req("undo", { id: TOKEN }));
    assertEquals([x.status, await x.json()], [410, { error: "undo_expired" }]);
  }
  assertEquals((await call(s.d, req("undo", { id: "x" }))).status, 400);
});

Deno.test("status: GET → counts with exactly the contract keys; unknown 404; bad id 400; POST 405", async () => {
  const j = await (await call(fake({ status: C("partial", { done: 2, failed: 1, method: "single" }) }).d, req("status?id=" + TOKEN))).json();
  assertEquals(Object.keys(j).sort(), ["code", "done", "failed", "id", "method", "status", "total", "undo_failed", "undone"]);
  assertEquals([j.status, j.done, j.failed, j.method], ["partial", 2, 1, "single"]);
  assertEquals((await call(fake({ status: null }).d, req("status?id=" + TOKEN))).status, 404);
  assertEquals((await call(fake().d, req("status?id=abc"))).status, 400);
  assertEquals((await call(fake().d, req("status?id=" + TOKEN, {}))).status, 405);
});

Deno.test("privacy: preview logs carry stage, result, counts and ms — never sender, subject, query or ids", async () => {
  const { d } = fake();
  const { lines } = await quiet(() => handleMailAction(req("preview", mail({ subject_words: ["주문"] })), d));
  const text = lines.join("\n");
  assert(lines.length >= 1);
  for (const bad of ["합성상점", "합성 광고", "주문", "from:", "\"a\""]) assert(!text.includes(bad), bad);
});

Deno.test("sampleOf: display name, else address; subject clipped to 100; no headers → empty strings", () => {
  assertEquals(sampleOf(mk("x", "shop@example.com", "y".repeat(150))).from, "shop@example.com");
  assertEquals(sampleOf(mk("x", "합성상점 <shop@example.com>", "y".repeat(150))).subject.length, 100);
  assertEquals(sampleOf({ id: "x", internalDate: "0" }), { from: "", subject: "", date: new Date(0).toISOString() });
});

Deno.test("sampleOf: clipping never splits a surrogate pair (iOS JSON decode rejects a lone surrogate)", () => {
  const s = sampleOf(mk("x", "n".repeat(59) + "🎉 <shop@example.com>", "y".repeat(99) + "🎉"));
  assertEquals([s.subject.length, s.from.length], [99, 59]);
  assert(!JSON.stringify(s).includes("\\ud8"), JSON.stringify(s));
  assertEquals(sampleOf(mk("x", "shop@example.com", "y".repeat(98) + "🎉")).subject.length, 100);   // 다 들어가면 그대로
});

Deno.test("sampleOf: a missing or non-numeric internalDate gives date \"\" — one bad sample does not fail the preview", async () => {
  assertEquals(sampleOf({ id: "x", internalDate: "abc" }).date, "");
  assertEquals(sampleOf({ id: "x" } as GmailMessage).date, "");
  const { d } = fake({ headers: (id) => Promise.resolve(id === "b" ? { ...mk(id), internalDate: "" } : mk(id)) });
  const r = await call(d, req("preview", mail()));
  assertEquals(r.status, 200);
  assertEquals((await r.json()).sample.map((x: { date: string }) => x.date === ""), [false, true, false]);
});

Deno.test("an RPC error is logged with its function name and SQLSTATE only (no user data) → 500 internal", async () => {
  const { d } = fake();
  d.start = () => Promise.reject(new RpcError("mail_action_start", "40001"));
  const { r, lines } = await quiet(() => handleMailAction(req("execute", { token: TOKEN }), d));
  assertEquals([r.status, await r.json()], [500, { error: "internal" }]);
  const last = JSON.parse(lines.at(-1)!);
  assertEquals([last.result, last.error], ["internal", "mail_action_start 40001"]);
  assert(!lines.join("\n").includes(TOKEN) && !lines.join("\n").includes(USER));
  const { lines: other } = await quiet(() => handleMailAction(req("execute", { token: TOKEN }), { ...d, start: () => Promise.reject(new Error("secret detail")) }));
  assert(!other.join("\n").includes("secret detail"));                   // 그 밖의 오류는 여전히 이름만
});
