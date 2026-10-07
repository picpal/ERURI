import { assert, assertEquals } from "jsr:@std/assert";
import type { BudgetDeps, LedgerLine } from "../functions/_shared/budget.ts";
import { GmailHttpError, type GmailMessage, type MessagePart } from "../functions/_shared/gmail.ts";
import { importTokenKey, signToken, type TokenClaims, verifyToken } from "../functions/_shared/mail-token.ts";
import type { MailReadDeps } from "../functions/mail-read/common.ts";
import { handleMailRead } from "../functions/mail-read/handler.ts";
import type { SummaryInput, SummaryOutput } from "../functions/mail-read/summary.ts";

// 가짜 Gmail·가짜 OpenAI·SQL 없음(스펙 §15 SUMMARY-server). 합성 발신자·제목·본문만
const KEY_B64 = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const NOW = Date.parse("2026-10-07T03:00:00Z");                    // 서울 10/7 12:00
const NOW_S = NOW / 1000;
const USER = "11111111-1111-4111-8111-111111111111", CONN = "22222222-2222-4222-8222-222222222222";
type M = { id: string; at: number | null; labels?: string[]; from?: string; subject?: string; gone?: boolean; payload?: MessagePart };
const msg = (id: string, minsAgo: number, o: Partial<M> = {}): M =>
  ({ id, at: NOW - minsAgo * 60_000, from: "합성상점 <shop@example.com>", subject: `합성 안내 ${id}`, ...o });
const toGmail = (m: M): GmailMessage => ({ id: m.id, internalDate: m.at === null ? "" : String(m.at), labelIds: m.labels ?? ["INBOX"],
  payload: { headers: [{ name: "From", value: m.from ?? "" }, { name: "Subject", value: m.subject ?? "" }], ...(m.payload ?? {}) } });
const OK_SUMMARY: SummaryOutput = { status: "ok", lines: ["합성학원 설명회 안내", "10/20 15:00 시작", "참가비 35,000원"], dates: ["10/20(화) 15:00"],
  amounts: ["35,000원"], todos: ["10/16까지 신청서 제출"], language: "ko", translation: null, ask: null };

type Opt = { msgs?: M[]; pageSize?: number; conn?: { connection_id: string; status: string } | null; access?: string | null | Error;
  take?: (n: number) => boolean | Error; enabled?: boolean; clockStep?: number; accessStep?: number; listError?: Error; full?: Record<string, M | Error>;
  summary?: SummaryOutput | Error; usage?: boolean; level?: "ok" | "refused"; slots?: (number | null)[]; auditFails?: boolean };
function fake(o: Opt = {}) {
  const seen = { list: [] as { q: string; max: number; page?: string }[], headers: [] as string[], full: [] as string[], take: [] as number[],
    summarize: [] as SummaryInput[], audit: [] as string[], settled: [] as LedgerLine[][], reserved: [] as string[], sleeps: [] as number[], timeouts: [] as number[] };
  const msgs = o.msgs ?? [];
  let clock = NOW;
  const slots = [...(o.slots ?? [])];
  const budget: BudgetDeps = {
    reserve: async (_u, k) => { seen.reserved.push(k); return { level: o.level ?? "ok", month: "2026-10-01" }; },
    settle: async (_u, _k, _e, _m, lines) => { seen.settled.push([...lines]); },
    acquire: async () => (slots.length ? slots.shift()! : 1), release: async () => {}, now: () => new Date(clock),
  };
  const d: MailReadDeps = {
    enabled: () => o.enabled ?? true,
    authUser: async (t) => (t === "good" ? USER : t === "other" ? "33333333-3333-4333-8333-333333333333" : null),
    connection: async () => (o.conn === undefined ? { connection_id: CONN, status: "active" } : o.conn),
    accessToken: async () => { clock += o.accessStep ?? 0; if (o.access instanceof Error) throw o.access; return o.access === undefined ? "at" : o.access; },
    api: () => ({
      list: async (q, max, page, timeoutMs) => {
        seen.list.push({ q, max, page }); seen.timeouts.push(timeoutMs ?? -1);
        clock += o.clockStep ?? 0;
        if (o.listError) throw o.listError;
        const afters = [...q.matchAll(/after:(\d+)/g)].map((x) => Number(x[1]) * 1000);   // 가짜 Gmail: after: 만 해석(받은 시각 기준 — U4 전제)
        const pool = msgs.filter((m) => afters.every((a) => (m.at ?? 0) >= a));
        const start = page ? Number(page) : 0, n = Math.min(max, o.pageSize ?? max);
        return { messages: pool.slice(start, start + n).map((m) => ({ id: m.id })), nextPageToken: start + n < pool.length ? String(start + n) : undefined };
      },
      headers: async (id, timeoutMs) => {
        seen.headers.push(id); seen.timeouts.push(timeoutMs ?? -1);
        const m = msgs.find((x) => x.id === id)!;
        if (m.gone) throw new GmailHttpError("messages.get", 404);
        return toGmail(m);
      },
      full: async (id) => {
        seen.full.push(id);
        const f = o.full?.[id];
        if (f instanceof Error) throw f;
        const m = f ?? msgs.find((x) => x.id === id);
        if (!m) throw new GmailHttpError("messages.get", 404);
        return toGmail(m);
      },
    }),
    takeUnits: async (_u, n) => { seen.take.push(n); const r = o.take?.(n) ?? true; if (r instanceof Error) throw r; return r; },
    tokenKey: () => importTokenKey(KEY_B64),
    budget,
    summarize: async (i, onUsage) => {
      seen.summarize.push(i);
      if (o.usage !== false) onUsage({ input: 9000, cached: 0, output: 600 });
      if (o.summary instanceof Error) throw o.summary;
      return o.summary ?? OK_SUMMARY;
    },
    audit: async (_u, t) => { if (o.auditFails) throw new Error("audit_mail_read 42883"); seen.audit.push(t); },
    sleep: async (ms) => { seen.sleeps.push(ms); },
    now: () => clock,
    today: () => "2026-10-07",
  };
  return { d, seen };
}
const req = (path: string, body: unknown, token: string | null = "good", method = "POST") => new Request(`http://x/functions/v1/mail-read/${path}`,
  { method, body: method === "GET" ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
// 응답 + 그동안의 콘솔 출력(로그 검사 — 스펙 §7 "로그": 코드·개수·시간만)
async function call(d: MailReadDeps, r: Request) {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    const res = await handleMailRead(r, d);
    const text = await res.text();
    return { status: res.status, j: text ? JSON.parse(text) : null, logs, headers: res.headers };
  } finally { console.log = orig; }
}
const F = { sender: "합성상점", subject_words: [], received_from: null, received_to: null, latest: false, translate: false, target_in_message: true };

Deno.test("routing: 401 without a session, 404 unknown path, 405 GET, 503 disabled when MAIL_READ is off (search and read), 400 bad_json", async () => {
  assertEquals((await call(fake().d, req("search", F, null))).status, 401);
  assertEquals((await call(fake().d, req("nope", F))).j, { error: "not_found" });
  assertEquals((await call(fake().d, req("search", F, "good", "GET"))).status, 405);
  for (const p of ["search", "read"]) assertEquals((await call(fake({ enabled: false }).d, req(p, F))).j, { error: "disabled" });
  assertEquals((await call(fake().d, req("search", [1]))).j, { error: "bad_json" });
});
// Codex 리뷰 #5: 칸 검사가 연결보다 먼저 — Gmail 없는 사용자도 400 을 받는다
Deno.test("search: field checks come before the connection — 400 bad_condition / needs_target even with no Gmail, 404 only for valid fields", async () => {
  const none = fake({ conn: null });
  assertEquals((await call(none.d, req("search", { ...F, received_from: "2026-02-30" }))).j, { error: "bad_condition", fields: ["received_from"] });
  assertEquals((await call(none.d, req("search", { translate: true }))).j, { error: "needs_target" });
  assertEquals((await call(none.d, req("search", F))).j, { error: "no_connection" });
  assertEquals(none.seen.list.length, 0);
});
Deno.test("search: inactive connection or no refresh token → 409 reauth_required; refresh transient error → 502 gmail_upstream", async () => {
  assertEquals((await call(fake({ conn: { connection_id: CONN, status: "reauth_required" } }).d, req("search", F))).j, { error: "reauth_required" });
  assertEquals((await call(fake({ access: null }).d, req("search", F))).j, { error: "reauth_required" });
  assertEquals((await call(fake({ access: new Error("token refresh 500") }).d, req("search", F))).j, { error: "gmail_upstream" });
});
Deno.test("search: the query is built server-side — no in:inbox, a model-written q is ignored", async () => {
  const { d, seen } = fake({ msgs: [msg("a", 10)] });
  await call(d, req("search", { ...F, q: "in:anywhere -in:sent", action: "trash" }));
  assertEquals(seen.list.map((l) => l.q), [`from:"합성상점"`]);
});
Deno.test("search: SENT/DRAFT/CHAT and vanished (404) metas are dropped; newest first by internalDate even when the sixth id is the newest; at most 5; more", async () => {
  const msgs = [msg("m1", 60), msg("m2", 50, { gone: true }), msg("m3", 40, { labels: ["SENT"] }), msg("m4", 30, { labels: ["DRAFT"] }),
    msg("m5", 25, { labels: ["CHAT"] }), msg("m6", 20), msg("m7", 15), msg("m8", 12), msg("m9", 11), msg("m10", 1), msg("m11", 70)];
  const { d, seen } = fake({ msgs });
  const { status, j } = await call(d, req("search", F));
  assertEquals(status, 200);
  assertEquals(j.candidates.map((c: { subject: string }) => c.subject), ["합성 안내 m10", "합성 안내 m9", "합성 안내 m8", "합성 안내 m7", "합성 안내 m6"]);
  assertEquals([j.complete, j.more], [true, true]);                                 // 유효 7통 > 5
  assertEquals(seen.headers.length, 11);                                             // 5통을 모았다고 멈추지 않는다
  assertEquals(j.conditions, { sender: "합성상점", subject_words: [], received_from: null, received_to: null, latest: false, translate: false });
});
Deno.test("search: complete with nothing → 200 [] complete true more false; 20 all-SENT ids with a next page → complete false, more true, [] (not 'none')", async () => {
  assertEquals((await call(fake().d, req("search", F))).j, { conditions: { sender: "합성상점", subject_words: [], received_from: null, received_to: null,
    latest: false, translate: false }, candidates: [], complete: true, more: false });
  const msgs = [...Array.from({ length: 20 }, (_, i) => msg(`s${i}`, i + 1, { labels: ["SENT"] })), ...Array.from({ length: 5 }, (_, i) => msg(`r${i}`, 30 + i))];
  const { j } = await call(fake({ msgs }).d, req("search", F));
  assertEquals([j.candidates.length, j.complete, j.more], [0, false, true]);
});
Deno.test("search: a short page with a nextPageToken asks for the rest (maxResults = 20 − collected); list calls cap at 10 → incomplete", async () => {
  const ten = fake({ msgs: Array.from({ length: 10 }, (_, i) => msg(`a${i}`, i + 1)), pageSize: 7 });
  const r = await call(ten.d, req("search", F));
  assertEquals(ten.seen.list.map((l) => l.max), [20, 13]);
  assertEquals(r.j.complete, true);
  const many = fake({ msgs: Array.from({ length: 30 }, (_, i) => msg(`b${i}`, i + 1)), pageSize: 1 });
  const r2 = await call(many.d, req("search", F));
  assertEquals([many.seen.list.length, r2.j.complete, many.seen.headers.length], [10, false, 10]);
});
Deno.test("latest: the 1-hour window with one valid mail settles it — only that window is listed and read, complete", async () => {
  const { d, seen } = fake({ msgs: [msg("new", 30), msg("old", 60 * 48)] });
  const { j } = await call(d, req("search", { ...F, sender: null, latest: true }));
  assertEquals(seen.list.map((l) => l.q), [`after:${NOW_S - 3600}`]);
  assertEquals([seen.headers, j.complete, j.candidates[0].subject], [["new"], true, "합성 안내 new"]);
});
Deno.test("latest: a window of only sent mail widens to the next window without re-reading metadata; the reply sent later is skipped", async () => {
  const { d, seen } = fake({ msgs: [msg("reply", 10, { labels: ["SENT"] }), msg("inbox", 300)] });
  const { j } = await call(d, req("search", { ...F, sender: null, latest: true }));
  assertEquals(seen.list.map((l) => l.q), [`after:${NOW_S - 3600}`, `after:${NOW_S - 86_400}`]);
  assertEquals([seen.headers, j.candidates.map((c: { subject: string }) => c.subject), j.complete], [["reply", "inbox"], ["합성 안내 inbox"], true]);
});
Deno.test("latest: more than 20 ids inside a window ends incomplete there (the app will not read directly)", async () => {
  const { d } = fake({ msgs: Array.from({ length: 21 }, (_, i) => msg(`w${i}`, i + 1)) });
  const { j } = await call(d, req("search", { ...F, sender: null, latest: true }));
  assertEquals([j.complete, j.more, j.candidates.length], [false, true, 5]);
});
Deno.test("latest: windows earlier than the received-from day are skipped and the last window is the received range itself", async () => {
  const floor = 1791298800;                                                          // 2026-10-07 00:00 서울
  const { d, seen } = fake({ msgs: [msg("morning", 180)] });
  const { j } = await call(d, req("search", { ...F, sender: null, latest: true, received_from: "2026-10-07" }));
  assertEquals(seen.list.map((l) => l.q), [`after:${floor} after:${NOW_S - 3600}`, `after:${floor}`]);
  assertEquals([j.candidates.length, j.complete], [1, true]);
});
// S1 리뷰 deferred: buildReadQuery 는 창 시작이 받은 기간 시작보다 앞서도 after: 두 개를 그대로 붙인다 — 그런 창은 호출자(collect)가 건너뛴다.
// 받은 기간이 지난 하루(10/5)면 끝 T = 10/6 0시, 1일 창 시작 = 받은 기간 시작과 같아 건너뛰고(마지막 창이 그 범위 자체), 7일·30일 창도 건너뛴다
Deno.test("latest: a window starting at or before the received-from day is never listed — no after: earlier than the range start", async () => {
  const floor = 1791126000, end = 1791212400;                                        // 2026-10-05 00:00 · 2026-10-06 00:00 서울
  const { d, seen } = fake({ msgs: [msg("tue", 60 * 50)] });                         // 10/5 10:00 서울
  const { j } = await call(d, req("search", { ...F, sender: null, latest: true, received_from: "2026-10-05", received_to: "2026-10-05" }));
  assertEquals(seen.list.map((l) => l.q), [`after:${floor} after:${end - 3600} before:${end}`, `after:${floor} before:${end}`]);
  for (const l of seen.list) for (const a of l.q.matchAll(/after:(\d+)/g)) assert(Number(a[1]) >= floor, l.q);
  assertEquals([j.candidates.length, j.complete], [1, true]);
});
// Codex 리뷰 #4: 호출 직전마다 원자 확보, 거절이면 그 뒤 Gmail 호출 0회
Deno.test("units: taken before every Gmail call (list 5, metadata 20 × group); refusal → 429 with no further Gmail call; RPC failure → 500 with none", async () => {
  const ok = fake({ msgs: Array.from({ length: 6 }, (_, i) => msg(`u${i}`, i + 1)) });
  await call(ok.d, req("search", F));
  assertEquals(ok.seen.take, [5, 100, 20]);
  assertEquals(ok.seen.take.reduce((a, b) => a + b, 0), 5 * ok.seen.list.length + 20 * ok.seen.headers.length);
  const refused = fake({ msgs: [msg("x", 1)], take: (n) => n === 5 });
  assertEquals((await call(refused.d, req("search", F))).j, { error: "gmail_rate_limited" });
  assertEquals(refused.seen.headers.length, 0);
  const broken = fake({ msgs: [msg("x", 1)], take: () => new Error("gmail_take_units timeout") });
  assertEquals((await call(broken.d, req("search", F))).status, 500);
  assertEquals(broken.seen.list.length, 0);
});
Deno.test("search: the 20 s budget is checked before each Gmail call → 502 gmail_upstream (an aborted search is never 'none')", async () => {
  const { d } = fake({ msgs: [msg("x", 1)], clockStep: 21_000 });
  assertEquals((await call(d, req("search", F))).j, { error: "gmail_upstream" });
});
// Codex 계획 리뷰 3: 앱 검색 요청 타임아웃은 30초(§7 "시간") — 19초에 시작한 호출이 15초를 다 쓰면 서버는 34초에 성공하고 앱은 이미 실패한다.
// 그래서 Gmail 호출마다 제한 시간 = min(15초, 20초 예산의 남은 시간)
Deno.test("search: each Gmail call's timeout is the remaining 20 s budget capped at 15 s (token refresh took 19 s → every call ≤ 1 s)", async () => {
  const fresh = fake({ msgs: [msg("x", 1)] });
  assertEquals((await call(fresh.d, req("search", F))).status, 200);
  assert(fresh.seen.timeouts.length >= 2 && fresh.seen.timeouts.every((t) => t === 15_000));
  const late = fake({ msgs: [msg("x", 1)], accessStep: 19_000 });
  assertEquals((await call(late.d, req("search", F))).status, 200);
  assert(late.seen.timeouts.length >= 2 && late.seen.timeouts.every((t) => t > 0 && t <= 1_000));
});
Deno.test("search: Gmail 429/403 quota → 429 gmail_rate_limited, 403 insufficientPermissions → 403 scope_missing, 401 → 409, 500 → 502", async () => {
  const cases: [GmailHttpError, number, string][] = [[new GmailHttpError("messages.list", 429), 429, "gmail_rate_limited"],
    [new GmailHttpError("messages.list", 403, ["userRateLimitExceeded"]), 429, "gmail_rate_limited"],
    [new GmailHttpError("messages.list", 403, ["insufficientPermissions"]), 403, "scope_missing"],
    [new GmailHttpError("messages.list", 401), 409, "reauth_required"], [new GmailHttpError("messages.list", 500), 502, "gmail_upstream"]];
  for (const [e, s, code] of cases) {
    const r = await call(fake({ listError: e }).d, req("search", F));
    assertEquals([r.status, r.j.error], [s, code]);
  }
});
Deno.test("search: each candidate carries a token binding user, connection and message for 10 minutes", async () => {
  const { d } = fake({ msgs: [msg("abc123", 5)] });
  const { j } = await call(d, req("search", F));
  const v = await verifyToken(await importTokenKey(KEY_B64), j.candidates[0].token, NOW_S);
  assertEquals(v, { ok: true, claims: { u: USER, c: CONN, m: "abc123", e: NOW_S + 600 } });
});
Deno.test("search logs carry codes and counts only — no sender, subject, Gmail id or field values", async () => {
  const { d } = fake({ msgs: [msg("id77aa", 5, { subject: "합성 비밀 제목", from: "합성비밀 <secret@example.com>" })] });
  const { logs } = await call(d, req("search", { ...F, subject_words: ["비밀"] }));
  const out = logs.join("\n");
  for (const s of ["합성비밀", "secret@example.com", "합성 비밀 제목", "id77aa", "비밀", "합성상점"]) assert(!out.includes(s), s);
  assert(out.includes('"mail_read":"search"'));
});
