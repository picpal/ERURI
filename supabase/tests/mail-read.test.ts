import { assert, assertEquals } from "jsr:@std/assert";
import type { BudgetDeps, LedgerLine } from "../functions/_shared/budget.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GmailHttpError, type GmailMessage, type MessagePart, ReauthRequired } from "../functions/_shared/gmail.ts";
import { importTokenKey, signToken, type TokenClaims, verifyToken } from "../functions/_shared/mail-token.ts";
import { type MailReadDeps, RpcError, SummaryFailed as SummaryFailedProbe } from "../functions/mail-read/common.ts";
import { mailReadDeps } from "../functions/mail-read/deps.ts";
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
  payload: { ...(m.payload ?? {}), headers: [{ name: "From", value: m.from ?? "" }, { name: "Subject", value: m.subject ?? "" }, ...(m.payload?.headers ?? [])] } });
const OK_SUMMARY: SummaryOutput = { status: "ok", lines: ["합성학원 설명회 안내", "10/20 15:00 시작", "참가비 35,000원"], dates: ["10/20(화) 15:00"],
  amounts: ["35,000원"], todos: ["10/16까지 신청서 제출"], language: "ko", translation: null, ask: null };

type Opt = { msgs?: M[]; pageSize?: number; conn?: { connection_id: string; status: string } | null; access?: string | null | Error;
  take?: (n: number) => boolean | Error; enabled?: boolean; clockStep?: number; accessStep?: number; listError?: Error; full?: Record<string, M | Error>;
  summary?: SummaryOutput | Error; summarizeStep?: number; usage?: boolean; level?: "ok" | "refused"; slots?: (number | null)[]; auditFails?: boolean; key?: string };
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
    tokenKey: () => importTokenKey(o.key ?? KEY_B64),
    budget,
    summarize: async (i, onUsage) => {
      seen.summarize.push(i);
      clock += o.summarizeStep ?? 0;                                         // 모델 응답 지연
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
// ── 읽기(스펙 §7 "읽기") ──
const b64u = (s: string) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const plain = (text: string): MessagePart => ({ mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=utf-8" }], body: { data: b64u(text) } });
const tok = async (m: string, o: Partial<TokenClaims> = {}) => signToken(await importTokenKey(KEY_B64), { u: USER, c: CONN, m, e: NOW_S + 600, ...o });
const R = async (m: string, o: Record<string, unknown> = {}) => ({ token: await tok(m), translate: false, request: "합성학원 메일 요약해줘", ...o });
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const mail = (id: string, body: string, o: Partial<M> = {}) => msg(id, 60, { subject: "설명회 안내", from: "합성학원 <academy@example.com>", payload: plain(body), ...o });

Deno.test("read: token format 400 bad_token, tampered/foreign signature 404 not_found, expired 410 token_expired — before the connection", async () => {
  const { d, seen } = fake({ conn: null });
  assertEquals((await call(d, req("read", { token: "x", request: "a" }))).j, { error: "bad_token" });
  const t = await tok("m1");
  assertEquals((await call(d, req("read", { token: t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA"), request: "a" }))).j, { error: "not_found" });
  assertEquals((await call(d, req("read", { token: await tok("m1", { e: NOW_S }), request: "a" }))).j, { error: "token_expired" });
  assertEquals(seen.full.length, 0);
});
Deno.test("read: request must be 1–500 UTF-16 non-blank and translate a boolean → else 400 bad_request", async () => {
  const { d } = fake({ msgs: [mail("m1", "본문")] });
  for (const o of [{ request: undefined }, { request: "  " }, { request: "가".repeat(501) }, { translate: "yes" }, { request: 7 }]) {
    assertEquals((await call(d, req("read", await R("m1", o)))).j, { error: "bad_request" }, JSON.stringify(o));
  }
});
Deno.test("read: a token of another user or another connection → 404 not_found (never reads)", async () => {
  const { d, seen } = fake({ msgs: [mail("m1", "본문")] });
  assertEquals((await call(d, req("read", await R("m1"), "other"))).j, { error: "not_found" });
  assertEquals((await call(d, req("read", { ...(await R("m1")), token: await tok("m1", { c: "44444444-4444-4444-8444-444444444444" }) }))).j, { error: "not_found" });
  assertEquals(seen.full.length, 0);
});
Deno.test("read: Gmail 404 or SPAM/TRASH labels → 404 mail_gone", async () => {
  assertEquals((await call(fake().d, req("read", await R("missing")))).j, { error: "mail_gone" });
  for (const l of ["SPAM", "TRASH"]) {
    assertEquals((await call(fake({ msgs: [mail("m1", "본문", { labels: [l] })] }).d, req("read", await R("m1")))).j, { error: "mail_gone" });
  }
});
Deno.test("read: ok → summary with a new 10-minute token for the same mail; reserve chat, line mail_summary; audit target = SHA-256 of the Gmail id", async () => {
  const { d, seen } = fake({ msgs: [mail("m1", "합성학원 설명회 10/20(화) 15:00, 참가비 35,000원")] });
  const { status, j } = await call(d, req("read", await R("m1")));
  assertEquals(status, 200);
  assertEquals([j.status, j.summary.lines.length, j.from, j.subject, j.body_truncated, j.attachments, j.translation, j.ask], ["ok", 3, "합성학원", "설명회 안내", false, 0, null, null]);
  assertEquals(await verifyToken(await importTokenKey(KEY_B64), j.token, NOW_S), { ok: true, claims: { u: USER, c: CONN, m: "m1", e: NOW_S + 600 } });
  assertEquals([seen.reserved, seen.settled[0].map((l) => [l.kind, l.model])], [["chat"], [["mail_summary", "gpt-6-luna"]]]);
  assertEquals(seen.audit, [await sha("m1")]);
  assertEquals(seen.take, [20]);
});
Deno.test("read: attachmentId-only body → no_body, no model call; attachments counted; subject masked like search", async () => {
  const p: MessagePart = { mimeType: "multipart/mixed", body: {}, parts: [{ mimeType: "text/plain", body: { attachmentId: "big" } }] };
  const { d, seen } = fake({ msgs: [msg("m1", 5, { payload: p, subject: "카드 4111-1111-1111-1111 영수증" })] });
  const { j } = await call(d, req("read", await R("m1")));
  assertEquals([j.status, j.attachments, j.subject, j.language, j.summary, seen.summarize.length], ["no_body", 1, "카드 ****-****-****-1111 영수증", "", null, 0]);
  assertEquals(seen.audit.length, 1);                                       // 본문을 받았다(D7)
});
// 스펙 §15: OTP 키워드가 제목·숫자가 본문인 경우 포함 — 모델 호출 0
Deno.test("read: OTP mail → status otp and the model is never called (keyword in the subject, digits in the body)", async () => {
  const { d, seen } = fake({ msgs: [mail("m1", "482913", { subject: "[합성은행] 인증번호 안내" })] });
  const { j } = await call(d, req("read", await R("m1")));
  assertEquals([j.status, seen.summarize.length, seen.reserved.length], ["otp", 0, 0]);
});
// 가림 뒤 자르기(전역 제약): 카드가 12,000·4,000 경계에 걸치면 자르기가 먼저일 때 번호 앞부분이 그대로 남는다(계획 Ruling M3)
Deno.test("read: masking reaches the model — split account (subject keyword, body number), card across the 12,000 and 4,000 boundaries", async () => {
  const card = "4111-1111-1111-1111";
  const cases = [mail("a", "123-456-789012", { subject: "입금 계좌" }), mail("b", "가".repeat(11_985) + " 결제 카드 " + card + " 끝"),
    mail("c", "Synthetic " + "x".repeat(3_980) + " card " + card),                 // 카드 3,996~4,014자 — 4,000에서 잘림
    mail("d", "Synthetic " + "x".repeat(3_975) + " card 4111111111111111")];     // 구분자 없는 카드 3,991~4,006자
  const { d, seen } = fake({ msgs: cases, summary: { ...OK_SUMMARY, language: "en", translation: "번역" } });
  for (const id of ["a", "b", "c", "d"]) await call(d, req("read", await R(id, { translate: true })));
  assertEquals(seen.summarize.length, 4);
  for (const i of seen.summarize) {
    const all = JSON.stringify(i);
    assert(!all.includes("123-456-789012") && !all.includes("4111-1111-1111") && !all.includes("1111-1111-1111-1111"), all.slice(0, 80));
  }
  assertEquals(seen.summarize[0].body, "***-***-**9012");
  assertEquals([seen.summarize[1].body.length <= 12_000, seen.summarize[2].translateSource!.length <= 4_000], [true, true]);
  assert(seen.summarize[1].body.endsWith("****-***") && !seen.summarize[1].body.includes("4111"));
  for (const i of [seen.summarize[2], seen.summarize[3]]) {
    const src = i.translateSource!;
    assertEquals(src.length, 4_000);
    assert(src.includes("****") && !/\d{4,}/.test(src) && !/\d{5,}/.test(src.replace(/-/g, "")), src.slice(-24));
  }
});
Deno.test("read: translate=false sends no translate source; body over 12,000 → body_truncated", async () => {
  const { d, seen } = fake({ msgs: [mail("m1", "가".repeat(13_000))] });
  const { j } = await call(d, req("read", await R("m1")));
  assertEquals([seen.summarize[0].translateSource, j.body_truncated], [null, true]);
});
// 응답이 온 실패도 원소 기록(§13), 모델 쪽 실패는 모두 502 summary_failed(D9) — gmail_upstream 으로 새지 않는다
Deno.test("read: model refusal/incomplete/network/timeout → 502 summary_failed; a usage line is still settled when a response arrived", async () => {
  for (const e of [new SummaryFailedProbe("refusal"), new TypeError("fetch failed"), Object.assign(new Error("t"), { name: "TimeoutError" })]) {
    const responded = e instanceof SummaryFailedProbe;                       // 거절·잘림은 응답이 왔다 — 네트워크·타임아웃은 응답 없음
    const { d, seen } = fake({ msgs: [mail("m1", "본문")], summary: e, usage: responded });
    const r = await call(d, req("read", await R("m1")));
    assertEquals([r.status, r.j.error], [502, "summary_failed"], e.name);
    assertEquals(seen.settled[0].length, responded ? 1 : 0);
  }
});
Deno.test("read: budget exhausted → 429 budget_exhausted without a model call; no slot after 1 s and 2 s → 503 llm_busy (retry-after 30)", async () => {
  const a = fake({ msgs: [mail("m1", "본문")], level: "refused" });
  assertEquals([(await call(a.d, req("read", await R("m1")))).j.error, a.seen.summarize.length], ["budget_exhausted", 0]);
  const b = fake({ msgs: [mail("m1", "본문")], slots: [null, null, null] });
  const r = await call(b.d, req("read", await R("m1")));
  assertEquals([r.status, r.j.error, r.headers.get("retry-after"), b.seen.sleeps], [503, "llm_busy", "30", [1000, 2000]]);
});
Deno.test("read: units refused before messages.get → 429 gmail_rate_limited and no read; audit failure → 500 and no model call", async () => {
  const a = fake({ msgs: [mail("m1", "본문")], take: () => false });
  assertEquals([(await call(a.d, req("read", await R("m1")))).j.error, a.seen.full.length], ["gmail_rate_limited", 0]);
  const b = fake({ msgs: [mail("m1", "본문")], auditFails: true });
  assertEquals([(await call(b.d, req("read", await R("m1")))).status, b.seen.summarize.length], [500, 0]);
});
Deno.test("read: ask status → ask sentence, summary null; logs carry no subject, sender, body, request or Gmail id", async () => {
  const { d } = fake({ msgs: [mail("id9zz", "합성은행 로그인 알림 비밀본문")], summary: { ...OK_SUMMARY, status: "ask", lines: [], dates: [], amounts: [], todos: [], ask: "어떤 환불 내용을 찾으세요?" } });
  const { j, logs } = await call(d, req("read", await R("id9zz", { request: "합성은행 메일에서 환불 얘기 요약해줘" })));
  assertEquals([j.status, j.summary, j.ask], ["ask", null, "어떤 환불 내용을 찾으세요?"]);
  const out = logs.join("\n");
  for (const s of ["비밀본문", "설명회 안내", "academy@example.com", "합성학원", "환불", "id9zz"]) assert(!out.includes(s), s);
  assert(out.includes('"status":"ask"'));
});

// ── S4 리뷰 반영(계획 Ruling S4-m1) ──
// 새 토큰 만료 = 응답 시점 + 10분(스펙 §7) — 모델이 늦게 답해도 이어서 "번역해줘"가 10분 안에 410 이 되지 않게. otp·no_body 는 모델 없음
Deno.test("read: ok/ask sign the follow-up token after the model answers (slow model → e ≥ response time + 600)", async () => {
  const slow = 48_000;
  for (const summary of [OK_SUMMARY, { ...OK_SUMMARY, status: "ask" as const, lines: [], dates: [], amounts: [], todos: [], ask: "어떤 내용을 찾으세요?" }]) {
    const { d } = fake({ msgs: [mail("m1", "본문")], summary, summarizeStep: slow });
    const { j } = await call(d, req("read", await R("m1")));
    const v = await verifyToken(await importTokenKey(KEY_B64), j.token, NOW_S);
    assert(v.ok, summary.status);
    assert(v.claims.e >= Math.floor((NOW + slow) / 1000) + 600, `${summary.status} e=${v.claims.e}`);
  }
  const { d } = fake({ msgs: [mail("m1", "482913", { subject: "[합성은행] 인증번호 안내" })], summarizeStep: slow });
  const o = await call(d, req("read", await R("m1")));
  const v = await verifyToken(await importTokenKey(KEY_B64), o.j.token, NOW_S);
  assertEquals([o.j.status, v.ok && v.claims.e], ["otp", NOW_S + 600]);
});

// ── S3 리뷰 반영(계획 Ruling S3-m1·m2·m3) ──
// S3 리뷰 Minor 1(계획 Ruling S3-m1): 토큰 갱신 중 RPC/DB 실패는 502 가 아니라 500 internal(로그 = 함수 이름·SQLSTATE), 갱신 일시 오류만 502, ReauthRequired 는 409
Deno.test("search/read: an RPC failure while getting the access token → 500 internal (function + SQLSTATE logged); ReauthRequired → 409; refresh error → 502", async () => {
  for (const p of ["search", "read"]) {
    const body = p === "search" ? F : await R("m1");
    const rpc = await call(fake({ msgs: [mail("m1", "본문")], access: new RpcError("gmail_get_refresh_token", "42883") }).d, req(p, body));
    assertEquals([rpc.status, rpc.j], [500, { error: "internal" }], p);
    assert(rpc.logs.join("\n").includes("gmail_get_refresh_token 42883"), p);
    assertEquals((await call(fake({ msgs: [mail("m1", "본문")], access: new ReauthRequired("invalid_grant") }).d, req(p, body))).j, { error: "reauth_required" }, p);
    assertEquals((await call(fake({ msgs: [mail("m1", "본문")], access: new Error("token refresh 500") }).d, req(p, body))).j, { error: "gmail_upstream" }, p);
  }
});
// 실제 deps: gmail-jobs call 은 평범한 Error("<함수> <SQLSTATE>")를 던진다 — deps 가 RpcError 로 바꾸고, refresh(Google 토큰 엔드포인트) 오류는 그대로 둔다
Deno.test("mailReadDeps.accessToken: RPC errors become RpcError (function + SQLSTATE), refresh transport errors pass through unchanged", async () => {
  const sb = (h: (fn: string) => { data: unknown; error: { code: string } | null }) => ({ rpc: async (fn: string) => h(fn) }) as unknown as SupabaseClient;
  const e1 = await mailReadDeps(sb(() => ({ data: null, error: { code: "42883" } }))).accessToken(USER, CONN).catch((e) => e);
  assertEquals([e1 instanceof RpcError, e1.message], [true, "gmail_get_refresh_token 42883"]);
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = () => Promise.reject(new TypeError("fetch failed"));
    const e2 = await mailReadDeps(sb(() => ({ data: "rt-synthetic", error: null }))).accessToken(USER, CONN).catch((e) => e);
    assertEquals([e2 instanceof RpcError, e2 instanceof TypeError], [false, true]);
    globalThis.fetch = () => Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 }));
    const e3 = await mailReadDeps(sb((fn) => fn === "gmail_get_refresh_token" ? { data: "rt-synthetic", error: null } : { data: null, error: { code: "57014" } }))
      .accessToken(USER, CONN).catch((e) => e);
    assertEquals([e3 instanceof RpcError, e3.message], [true, "gmail_update 57014"]);   // invalid_grant 뒤 연결 갱신 RPC 실패 — RPC 실패라 500
    assertEquals(await mailReadDeps(sb((fn) => ({ data: fn === "gmail_get_refresh_token" ? "rt-synthetic" : null, error: null }))).accessToken(USER, CONN), null);
  } finally { globalThis.fetch = orig; }
});
// S3 리뷰 Minor 2(Ruling S3-m2): MAIL_READ_KEY 형식 오류 → 500 internal(key_invalid), Gmail·units 호출 0 — 검색·읽기 모두
Deno.test("search/read: a malformed MAIL_READ_KEY → 500 internal before any Gmail call or unit", async () => {
  for (const p of ["search", "read"]) {
    const { d, seen } = fake({ msgs: [mail("m1", "본문")], key: "c2hvcnQ=" });
    const r = await call(d, req(p, p === "search" ? F : await R("m1")));
    assertEquals([r.status, r.j], [500, { error: "internal" }], p);
    assert(r.logs.join("\n").includes('"why":"key_invalid"'), p);
    assertEquals([seen.list.length, seen.headers.length, seen.full.length, seen.take.length], [0, 0, 0, 0], p);
  }
});
// S3 리뷰 Minor 3(Ruling S3-m3): 거절된 키 Promise 를 캐시하지 않는다 — 키를 고치면 같은 isolate 에서 바로 낫는다
Deno.test("mailReadDeps.tokenKey: a rejected key import is not cached; the same instance caches a good key", async () => {
  const prev = Deno.env.get("MAIL_READ_KEY");
  try {
    Deno.env.set("MAIL_READ_KEY", "c2hvcnQ=");
    const d = mailReadDeps({} as unknown as SupabaseClient);
    const e = await d.tokenKey().catch((x) => x);
    assertEquals(e.message, "key_invalid");
    Deno.env.set("MAIL_READ_KEY", KEY_B64);
    const k = await d.tokenKey();
    assert(k instanceof CryptoKey);
    assert((await d.tokenKey()) === k);
  } finally { if (prev === undefined) Deno.env.delete("MAIL_READ_KEY"); else Deno.env.set("MAIL_READ_KEY", prev); }
});
