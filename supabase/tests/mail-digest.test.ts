import { assert, assertEquals } from "jsr:@std/assert";
import OpenAI from "npm:openai@7";
import { type BudgetDeps, costKrw, type HoldDeps, type HoldReservation, type LedgerLine } from "../functions/_shared/budget.ts";
import { GmailHttpError, type GmailMessage } from "../functions/_shared/gmail.ts";
import { importTokenKey, signToken, verifyToken } from "../functions/_shared/mail-token.ts";
import { type AccessLimit, type MailReadDeps, RpcError, SummaryFailed } from "../functions/mail-read/common.ts";
import { mailReadDeps } from "../functions/mail-read/deps.ts";
import { handleMailRead } from "../functions/mail-read/handler.ts";

const KEY_B64 = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const USER = "11111111-1111-4111-8111-111111111111", OTHER = "33333333-3333-4333-8333-333333333333";
const CONN = "22222222-2222-4222-8222-222222222222", CONN2 = "44444444-4444-4444-8444-444444444444";
const LIM = { deadlineMs: 400, rpcMs: 60, gmailMs: 150, modelMs: 150, parallel: 5, slotSeconds: 150 };
const FIXED = Date.parse("2026-10-23T03:00:00Z"), FIXED_S = FIXED / 1000;            // 고정 시계(토큰 만료 시각 비교 — Codex 계획 리뷰 #7)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64u = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// usage: false = 모델 응답이 오지 않은 실패(타임아웃·401) — onUsage 를 부르지 않는다(실제 summarizeDigest 는 응답이 온 뒤에만 부른다)
type Mail = { body?: string; labels?: string[]; gmailMs?: number; gmail?: Error; modelMs?: number; model?: string[] | Error; usage?: boolean; otp?: boolean };
type Opt = { level?: "ok" | "refused"; slots?: (number | null)[]; units?: boolean; auditMs?: number; auditFail?: string[];
  reserveMs?: number; reserveCommit?: "late" | "early"; acquireMs?: number; acquireError?: boolean; access?: MailReadDeps["accessToken"]; now?: () => number };
const h = new Headers();
function fake(mails: Record<string, Mail>, o: Opt = {}) {
  const log: string[] = [], settled: LedgerLine[][] = [], acquired: (number | undefined)[] = [], estimates: number[] = [], holdIds: string[] = [], holders: string[] = [];
  const fullArgs: [number | undefined, boolean][] = [];
  let inflight = 0, maxInflight = 0;
  const slots = [...(o.slots ?? [1])];
  // 서버 상태 흉내(0037 usage_holds · llm_slots): 최종 예약액과 잡힌 슬롯을 단언한다
  const money = { reserved: 0 };
  const hs = new Map<string, { state: "held" | "settled" | "cancelled"; est: number }>();
  const held = new Map<number, string>();
  const holds: HoldDeps = {
    reserve: async (_u, hold, k, est) => {
      log.push(`reserve ${k}`); estimates.push(est); holdIds.push(hold);
      const commit = (): HoldReservation => {
        if (hs.has(hold)) return { level: "cancelled", month: null };                  // 묘비 — 보상 정산이 먼저 왔다
        if (o.level === "refused") { hs.set(hold, { state: "cancelled", est }); return { level: "refused", month: "2026-10-01" }; }
        hs.set(hold, { state: "held", est }); money.reserved += est; return { level: "ok", month: "2026-10-01" };
      };
      if (o.reserveCommit === "early") { const r = commit(); await sleep(o.reserveMs ?? 0); return r; }   // 커밋은 됐는데 응답이 늦다
      await sleep(o.reserveMs ?? 0); return commit();                                                    // 커밋 자체가 늦다(기본)
    },
    settle: async (_u, hold, lines) => {
      log.push(`settle ${lines.length}`); settled.push([...lines]);
      const x = hs.get(hold);
      if (!x) { if (lines.length) throw new Error("reservation_missing"); hs.set(hold, { state: "cancelled", est: 0 }); return "absent"; }
      if (x.state !== "held") return "done";
      money.reserved += lines.reduce((a, l) => a + l.krw, 0) - x.est; x.state = "settled"; return "settled";
    },
  };
  const budget: BudgetDeps = {
    reserve: async () => ({ level: "ok", month: "2026-10-01" }), settle: async () => { log.push("read settle"); },   // read 경로(guarded) 전용
    acquire: async (_u, holder, s) => {
      acquired.push(s); holders.push(holder); log.push("acquire");
      if (o.acquireError) throw new RpcError("acquire_llm_slot", "57014");
      const next = slots.length ? slots.shift()! : 1;
      await sleep(o.acquireMs ?? 0);                                                   // 늦게 성공 = 제한 시간 뒤에 슬롯을 잡는다
      if (next !== null) held.set(next, holder);
      return next;
    },
    release: async (_u, slot, holder) => { log.push("release"); if (held.get(slot) === holder) held.delete(slot); },
    now: () => new Date(),
  };
  const d: MailReadDeps = {
    enabled: () => true, authUser: async (t) => (t === "good" ? USER : null), connection: async () => ({ connection_id: CONN, status: "active" }),
    accessToken: o.access ?? (async () => "at"), takeUnits: async (_u, n) => { log.push(`units ${n}`); return o.units ?? true; },
    tokenKey: () => importTokenKey(KEY_B64), budget, holds,
    summarize: () => { throw new Error("no detail"); },
    summarizeDigest: async (i, onUsage, signal, timeoutMs) => {
      const id = i.subject.replace("합성 ", "");
      const m = mails[id];
      log.push(`model start ${id}`);
      // 실제처럼 timeoutMs 가 지나면 응답 없이 끊긴다(usage 없음 — PF-10). 취소 신호도 받는다
      await new Promise<void>((res, rej) => {
        const done = (f: () => void) => () => { clearTimeout(t); clearTimeout(u); f(); };
        const t = setTimeout(done(res), m.modelMs ?? 5);
        const u = setTimeout(done(() => rej(new SummaryFailed("timeout"))), timeoutMs);
        signal.addEventListener("abort", done(() => rej(signal.reason)));
      });
      if (m.model instanceof Error) { if (m.usage !== false) onUsage({ input: 100, cached: 0, output: 0 }); throw m.model; }
      onUsage({ input: 100, cached: 0, output: 10 });
      log.push(`model end ${id}`);
      return m.model ?? [`${id} 요약`];
    },
    audit: async (_u, t) => { log.push(`audit ${t.slice(0, 6)}`); await sleep(o.auditMs ?? 0); },
    sleep: async () => {}, now: o.now ?? (() => Date.now()), today: () => "2026-10-23",
    api: () => ({
      list: () => { throw new Error("no list"); }, headers: () => { throw new Error("no headers"); },
      full: async (id, t, signal) => {
        const m = mails[id];
        fullArgs.push([t, signal instanceof AbortSignal]);                             // S5 리뷰 M3: 제한 시간·취소 신호가 실제로 넘어오는지
        inflight++; maxInflight = Math.max(maxInflight, inflight); log.push(`full ${id}`);
        try {
          await new Promise((res, rej) => { const t = setTimeout(res, m.gmailMs ?? 5); signal?.addEventListener("abort", () => { clearTimeout(t); rej(signal.reason); }); });
          if (m.gmail) throw m.gmail;
          const text = m.otp ? "인증번호 [123456]를 입력하세요" : m.body ?? `합성 본문 ${id}`;
          return { id, internalDate: String(Date.parse("2026-10-23T00:00:00Z")), labelIds: m.labels ?? ["INBOX"],
            payload: { mimeType: "text/plain", body: { data: b64u(text) }, headers: [{ name: "From", value: "합성상점 <a@b>" }, { name: "Subject", value: `합성 ${id}` }] } } as GmailMessage;
        } finally { inflight--; }
      },
    }),
  };
  return { d, log, settled, acquired, estimates, holdIds, holders, money, held, fullArgs, max: () => maxInflight };
}
async function tok(m: string, o: { u?: string; c?: string; e?: number } = {}) {
  return signToken(await importTokenKey(KEY_B64), { u: o.u ?? USER, c: o.c ?? CONN, m, e: o.e ?? Math.floor(Date.now() / 1000) + 600 });
}
const post = (d: MailReadDeps, body: unknown, lim = LIM) =>
  handleMailRead(new Request("http://x/mail-read/digest", { method: "POST", headers: { authorization: "Bearer good" }, body: JSON.stringify(body) }), d, lim);
const SLOW_MODEL = { ...LIM, modelMs: 10_000 };                                         // 모델 제한 시간이 먼저 끊지 않게 — 중단·deadline 이 끊는지 잰다(PF-10)

Deno.test("digest: results keep input order even when later mails finish first; each ok line has a new token for the same mail expiring now + 600 s (fixed clock)", async () => {
  const ids = ["a1", "a2", "a3", "a4"];
  const { d, fullArgs } = fake({ a1: { gmailMs: 80 }, a2: { gmailMs: 40 }, a3: { gmailMs: 20 }, a4: { gmailMs: 1 } }, { now: () => FIXED });
  const tokens = await Promise.all(ids.map((m) => tok(m, { e: FIXED_S + 100 })));      // 500초 전에 받은 토큰
  const j = await (await post(d, { tokens })).json();
  assertEquals(j.results.map((x: { status: string; lines: string[] }) => [x.status, x.lines]), ids.map((m) => ["ok", [`${m} 요약`]]));
  assertEquals(fullArgs, ids.map(() => [LIM.gmailMs, true]));                          // full(id, gmailMs, signal) — S5 리뷰 M3
  const k = await importTokenKey(KEY_B64);
  for (const [i, x] of j.results.entries()) {
    const v = await verifyToken(k, x.token, FIXED_S);
    if (!v.ok) throw new Error(ids[i] + " " + v.code);
    assertEquals([v.claims.m, v.claims.e], [ids[i], FIXED_S + 600]);
  }
});
Deno.test("digest failed lines also get a new token (D-M8, DP28) — mail id and expiry per failure type, fixed clock", async () => {
  const mails: Record<string, Mail> = { t1: { gmail: new GmailHttpError("messages.get", 500, []) }, t2: { model: new SummaryFailed("empty") },
    t3: { gmail: new GmailHttpError("messages.get", 404, []) }, t4: { labels: ["TRASH"] }, t5: { gmail: new GmailHttpError("messages.get", 429, []) }, t6: {} };
  const { d } = fake(mails, { now: () => FIXED });
  const names = Object.keys(mails);
  const j = await (await post(d, { tokens: await Promise.all(names.map((m) => tok(m, { e: FIXED_S + 100 }))) })).json();
  assertEquals(j.results.map((x: { status: string; code: string | null }) => [x.status, x.code]),
    [["failed", "gmail_upstream"], ["failed", "summary_failed"], ["failed", "mail_gone"], ["failed", "mail_gone"], ["failed", "gmail_rate_limited"], ["ok", null]]);
  const k = await importTokenKey(KEY_B64);
  for (const [i, x] of j.results.entries()) {
    const v = await verifyToken(k, x.token, FIXED_S);
    if (!v.ok) throw new Error(names[i] + " " + v.code);
    assertEquals([v.claims.m, v.claims.e], [names[i], FIXED_S + 600], names[i]);
  }
});
Deno.test("digest: partial failure — Gmail 500 on one, model timeout on one → only those lines failed (gmail_upstream, summary_failed)", async () => {
  const { d } = fake({ b1: {}, b2: { gmail: new GmailHttpError("messages.get", 500, []) }, b3: { modelMs: 1_000 }, b4: { gmail: new GmailHttpError("messages.get", 404, []) } });
  const tokens = await Promise.all(["b1", "b2", "b3", "b4"].map((m) => tok(m)));
  const t0 = Date.now();
  const j = await (await post(d, { tokens })).json();
  assertEquals(j.results.map((x: { status: string; code: string | null }) => [x.status, x.code]),
    [["ok", null], ["failed", "gmail_upstream"], ["failed", "summary_failed"], ["failed", "mail_gone"]]);
  assert(Date.now() - t0 < LIM.deadlineMs, String(Date.now() - t0));                   // b3 은 모델 제한 시간(150)에서 끊겼다 — deadline(400)이 아니다(PF-10)
});
Deno.test("digest audit order: full 200 → audit once → labels; SPAM/TRASH lines are audited and failed mail_gone; 404 is not audited", async () => {
  const { d, log } = fake({ c1: { labels: ["SPAM"] }, c2: { labels: ["TRASH"] }, c3: { gmail: new GmailHttpError("messages.get", 404, []) } });
  const j = await (await post(d, { tokens: await Promise.all(["c1", "c2", "c3"].map((m) => tok(m))) })).json();
  assertEquals(j.results.map((x: { code: string }) => x.code), ["mail_gone", "mail_gone", "mail_gone"]);
  assertEquals(log.filter((l) => l.startsWith("audit")).length, 2);
  assertEquals(log.filter((l) => l.startsWith("model")).length, 0);
});
Deno.test("digest: first OpenAI 401 stops everything — no new mail starts, in-flight calls aborted, all settled, usage settled once, slot released, 503 llm_unavailable", async () => {
  const unauth = new OpenAI.AuthenticationError(401, { code: "invalid_api_key" }, "bad key", h);
  // d2~d5 는 모델 300ms — 다섯 자리가 d1 실패(≈15ms)까지 모두 차 있어 d6·d7 은 그 전에 시작할 수 없다
  const mails: Record<string, Mail> = { d1: { model: unauth, modelMs: 10, usage: false }, d2: { modelMs: 300 }, d3: { modelMs: 300 }, d4: { modelMs: 300 },
    d5: { modelMs: 300 }, d6: {}, d7: {} };
  const { d, log, settled, money, held } = fake(mails);
  const t0 = Date.now();
  const r = await post(d, { tokens: await Promise.all(Object.keys(mails).map((m) => tok(m))) }, SLOW_MODEL);
  assertEquals([r.status, (await r.json()).error], [503, "llm_unavailable"]);
  assert(Date.now() - t0 < 250, "did not wait for the 300 ms calls");                 // ② 취소 ③ 대기는 곧 끝난다
  assertEquals(log.filter((l) => l === "full d6" || l === "full d7"), []);            // ① 새 통 시작 없음
  assertEquals(log.filter((l) => /^model end d[2-5]$/.test(l)), []);                   // ② 진행 중 호출 취소
  assertEquals([log.filter((l) => l.startsWith("settle")).length, settled.length], [1, 1]);   // ④ 한 번
  assertEquals(log.at(-1), "release");                                                // ⑤ 반납이 마지막
  assertEquals([money.reserved, held.size], [0, 0]);                                  // 응답 온 usage 없음 → 전액 반환
});
Deno.test("digest deadline: unfinished mails fail at the deadline (Gmail stage gmail_upstream, model stage summary_failed, not started gmail_upstream) with new tokens, one settle, 200", async () => {
  const mails: Record<string, Mail> = { e1: {}, e2: { gmailMs: 10_000 }, e3: { modelMs: 10_000 }, e4: { gmailMs: 10_000 }, e5: { gmailMs: 10_000 }, e6: { gmailMs: 10_000 }, e7: {} };
  const { d, log, held } = fake(mails);
  const tokens = await Promise.all(Object.keys(mails).map((m) => tok(m)));
  const t0 = Date.now();
  const j = await (await post(d, { tokens }, SLOW_MODEL)).json();                      // e3 은 모델 단계에서 deadline 으로 끊긴다
  assert(Date.now() - t0 < LIM.deadlineMs + 300);
  assertEquals(j.results.map((x: { status: string; code: string | null }) => x.code),
    [null, "gmail_upstream", "summary_failed", "gmail_upstream", "gmail_upstream", "gmail_upstream", "gmail_upstream"]);
  assert(j.results.every((x: { token: string | null }) => x.token !== null));          // DP28
  assertEquals([log.filter((l) => l.startsWith("settle")).length, held.size], [1, 0]);
});
Deno.test("digest deadline counts from the request start (DP27): a slow token refresh eats into it — the Gmail stage is cut at t0 + deadline, not refresh + deadline", async () => {
  const { d } = fake({ u1: { gmailMs: 10_000 } }, { access: async () => { await sleep(300); return "at"; } });
  const t0 = Date.now();
  const j = await (await post(d, { tokens: [await tok("u1")] })).json();
  assert(Date.now() - t0 < LIM.deadlineMs + 150, String(Date.now() - t0));            // 300 + 400 이 아니다
  assertEquals(j.results[0].code, "gmail_upstream");
});
Deno.test("digest passes {rpcMs, deadline} to the token refresh; a stuck refresh RPC fails within the deadline — 500 internal, reservation returned, slot released", async () => {
  let seen: AccessLimit | undefined;
  const { d, money, held } = fake({ s1: {} }, { access: (_u, _c, lim) => {
    seen = lim;                                                                       // 실제 deps 처럼 min(rpcMs, 남은 시간)에서 RpcError
    return new Promise((_, rej) => setTimeout(() => rej(new RpcError("gmail_get_refresh_token", "timeout")), lim ? Math.min(lim.rpcMs, lim.deadline - Date.now()) : 10_000));
  } });
  const t0 = Date.now();
  const r = await post(d, { tokens: [await tok("s1")] });
  assertEquals([r.status, (await r.json()).error], [500, "internal"]);
  assert(Date.now() - t0 < LIM.deadlineMs, String(Date.now() - t0));
  assert(seen !== undefined && seen.rpcMs === LIM.rpcMs && seen.deadline - t0 >= LIM.deadlineMs && seen.deadline - t0 < LIM.deadlineMs + 100, JSON.stringify(seen));   // ctx.t0(핸들러 시작) + 400
  assertEquals([money.reserved, held.size], [0, 0]);
});
Deno.test("mailReadDeps.accessToken with a limit: a hanging gmail_get_refresh_token RPC becomes RpcError(fn, timeout) within rpcMs (timedRpc, DP27)", async () => {
  const sb = { rpc: (fn: string) => (fn === "gmail_get_refresh_token" ? new Promise(() => {}) : Promise.resolve({ data: null, error: null })), auth: {} };
  const deps = mailReadDeps(sb as never);
  const t0 = Date.now();
  let e: unknown;
  try { await deps.accessToken(USER, CONN, { rpcMs: 50, deadline: Date.now() + 1_000 }); } catch (x) { e = x; }
  assert(e instanceof RpcError && e.message === "gmail_get_refresh_token timeout", String(e));
  assert(Date.now() - t0 < 300);
});
Deno.test("digest RPC 5 s cap: slow audit → that line internal (with a new token); slow reservation → 500 internal and no Gmail call", async () => {
  const a = fake({ f1: {}, f2: {} }, { auditMs: 500 });
  const j = await (await post(a.d, { tokens: [await tok("f1"), await tok("f2")] })).json();
  assertEquals(j.results.map((x: { code: string; token: string | null }) => [x.code, x.token !== null]), [["internal", true], ["internal", true]]);
  const b = fake({ g1: {} }, { reserveMs: 500 });
  const r = await post(b.d, { tokens: [await tok("g1")] });
  assertEquals([r.status, (await r.json()).error, b.log.some((l) => l.startsWith("full"))], [500, "internal", false]);
  await sleep(500);                                                                   // 느린 감사·늦은 예약 가짜가 끝날 때까지(타이머 누수 없이) — 늦은 예약은 묘비로 cancelled
  assertEquals([b.money.reserved, b.held.size], [0, 0]);
});
Deno.test("cleanup (Codex plan review #2): reservation RPC times out — committed after the compensation (tombstone) or before it (refund) → final reserved_krw back to the start, no slot", async () => {
  for (const reserveCommit of ["late", "early"] as const) {
    const f = fake({ q1: {} }, { reserveMs: 300, reserveCommit });
    const r = await post(f.d, { tokens: [await tok("q1")] });
    assertEquals([r.status, (await r.json()).error], [500, "internal"], reserveCommit);
    await sleep(350);                                                                 // 늦은 예약 응답까지 끝난 뒤
    assertEquals([f.money.reserved, f.held.size, f.log.some((l) => l.startsWith("full")), f.log.filter((l) => l.startsWith("settle")).length], [0, 0, false, 1], reserveCommit);
  }
});
Deno.test("cleanup: slot RPC throws, or times out and succeeds late → reservation returned, holder released on both slots, the late slot released when it arrives", async () => {
  const a = fake({ r1: {} }, { acquireError: true });
  assertEquals((await post(a.d, { tokens: [await tok("r1")] })).status, 500);
  assertEquals([a.money.reserved, a.held.size, a.log.includes("settle 0")], [0, 0, true]);
  const b = fake({ r1: {} }, { acquireMs: 200, slots: [2] });
  assertEquals((await post(b.d, { tokens: [await tok("r1")] })).status, 500);
  await sleep(250);                                                                   // 늦게 잡힌 슬롯 2
  assertEquals([b.money.reserved, b.held.size, b.log.filter((l) => l === "release").length >= 3], [0, 0, true]);   // 두 자리 반납 + 늦은 자리 반납
});
Deno.test("cleanup: token refresh says reauth (409) or throws (500) → reservation returned, slot released", async () => {
  const a = fake({ w1: {} }, { access: async () => null });
  assertEquals([(await post(a.d, { tokens: [await tok("w1")] })).status, a.money.reserved, a.held.size], [409, 0, 0]);
  const b = fake({ w1: {} }, { access: async () => { throw new RpcError("gmail_get_refresh_token", "XX000"); } });
  assertEquals([(await post(b.d, { tokens: [await tok("w1")] })).status, b.money.reserved, b.held.size], [500, 0, 0]);
});
Deno.test("digest: slot lease 150 s; reservation = valid count × estimate exactly; units = valid × 20; the hold id is the slot holder", async () => {
  const { d, acquired, log, estimates, holdIds, holders } = fake({ h1: {}, h2: {} });
  await post(d, { tokens: [await tok("h1"), await tok("h2"), await tok("h3", { u: OTHER })] });
  assertEquals(acquired, [150]);
  assertEquals(estimates, [2 * costKrw("gpt-6-luna", { input: 10_000, output: 1_000 })]);   // 유효 2통 × 단가(남의 토큰 제외)
  assert(log.includes("units 40"));
  assertEquals(holders, holdIds);
});
Deno.test("digest tokens: other user / other connection / forged → rejected, expired → expired, the rest ok; 0 valid → 200 with no reservation", async () => {
  const good = await tok("i1"), dot = good.lastIndexOf(".") + 1;                     // 서명 첫 글자를 바꾼다(끝 글자는 atob 가 남는 비트를 버려 같은 바이트일 수 있다 — PF-4)
  const forged = good.slice(0, dot) + (good[dot] === "A" ? "B" : "A") + good.slice(dot + 1);
  const { d } = fake({ i1: {}, i2: {} });
  const j = await (await post(d, { tokens: [await tok("i1"), await tok("i2", { u: OTHER }), await tok("i2", { c: CONN2 }), forged, await tok("i2", { e: 1 }), "c1.x.y"] })).json();
  assertEquals(j.results.map((x: { status: string }) => x.status), ["ok", "rejected", "rejected", "rejected", "expired", "rejected"]);
  assertEquals(j.results.slice(1).map((x: { token: string | null }) => x.token), [null, null, null, null, null]);
  const z = fake({});
  const r = await (await post(z.d, { tokens: [await tok("i9", { u: OTHER })] })).json();
  assertEquals([r.results[0].status, z.log.some((l) => l.startsWith("reserve"))], ["rejected", false]);
});
Deno.test("digest bad_request: 0 tokens, 11 tokens, duplicates, non-string, > 512 chars", async () => {
  const { d } = fake({});
  const t = await tok("j1");
  for (const tokens of [[], Array.from({ length: 11 }, (_, i) => t + i), [t, t], [3], ["v1." + "A".repeat(600)], "x"]) {
    const r = await post(d, { tokens });
    assertEquals([r.status, (await r.json()).error], [400, "bad_request"], JSON.stringify(tokens).slice(0, 40));
  }
});
Deno.test("digest concurrency: at most 5 Gmail reads in flight for 10 tokens", async () => {
  const mails = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, { gmailMs: 30 } as Mail]));
  const { d, max } = fake(mails);
  await post(d, { tokens: await Promise.all(Object.keys(mails).map((m) => tok(m))) });
  assertEquals(max(), 5);
});
Deno.test("digest OTP / no body → ok + note, model not called", async () => {
  const { d, log } = fake({ l1: { otp: true }, l2: { body: "" } });
  const j = await (await post(d, { tokens: [await tok("l1"), await tok("l2")] })).json();
  assertEquals(j.results.map((x: { status: string; note: string; lines: string[] }) => [x.status, x.note, x.lines]), [["ok", "otp", []], ["ok", "no_body", []]]);
  assertEquals(log.filter((l) => l.startsWith("model")).length, 0);
});
Deno.test("digest budget refused → 429 budget_exhausted, no Gmail, no settle; no slot → 1 s·2 s retry then 503 llm_busy with the reservation returned; units refused → 429 gmail_rate_limited, reservation returned, slot released", async () => {
  const a = fake({ m1: {} }, { level: "refused" });
  const ra = await post(a.d, { tokens: [await tok("m1")] });
  assertEquals([ra.status, (await ra.json()).error, a.log.some((l) => l.startsWith("full")), a.log.some((l) => l.startsWith("settle")), a.money.reserved], [429, "budget_exhausted", false, false, 0]);
  const b = fake({ m1: {} }, { slots: [null, null, null] });
  const rb = await post(b.d, { tokens: [await tok("m1")] });
  assertEquals([rb.status, (await rb.json()).error, b.log.filter((l) => l === "acquire").length, b.log.includes("settle 0"), b.money.reserved], [503, "llm_busy", 3, true, 0]);
  const c = fake({ m1: {} }, { units: false });
  const rc = await post(c.d, { tokens: [await tok("m1")] });
  assertEquals([rc.status, (await rc.json()).error, c.log.includes("settle 0"), c.log.includes("release"), c.money.reserved, c.held.size], [429, "gmail_rate_limited", true, true, 0, 0]);
});
Deno.test("digest settles one mail_digest line per model response, including summary_failed responses that carried usage", async () => {
  // n2 = 응답은 왔지만 후처리 실패(빈 줄·incomplete — usage 있음), n3 = 응답 없이 실패(타임아웃 — usage 없음)
  const { d, settled, money } = fake({ n1: {}, n2: { model: new SummaryFailed("empty") }, n3: { model: new SummaryFailed("timeout"), usage: false } });
  const j = await (await post(d, { tokens: [await tok("n1"), await tok("n2"), await tok("n3")] })).json();
  assertEquals(j.results.map((x: { status: string; code: string | null }) => [x.status, x.code]), [["ok", null], ["failed", "summary_failed"], ["failed", "summary_failed"]]);
  assertEquals([settled.length, settled[0].length, settled[0].every((x) => x.kind === "mail_digest" && x.model === "gpt-6-luna")], [1, 2, true]);
  assert(Math.abs(money.reserved - settled[0].reduce((a, l) => a + l.krw, 0)) < 1e-9);   // 예약 − 예약 + Σkrw(부동소수 — 근사)
});
Deno.test("read keeps the audit-before-labels order (SPAM read: audit row once, 404 mail_gone)", async () => {
  const { d, log } = fake({ o1: { labels: ["SPAM"] } });
  const r = await handleMailRead(new Request("http://x/mail-read/read", { method: "POST", headers: { authorization: "Bearer good" },
    body: JSON.stringify({ token: await tok("o1"), request: "요약해줘" }) }), d, LIM);
  assertEquals([r.status, (await r.json()).error, log.filter((l) => l.startsWith("audit")).length], [404, "mail_gone", 1]);
});
