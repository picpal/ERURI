import { assert, assertEquals } from "jsr:@std/assert";
import type { BudgetDeps, HoldDeps } from "../functions/_shared/budget.ts";
import { GmailHttpError, type GmailMessage } from "../functions/_shared/gmail.ts";
import { importTokenKey, verifyToken } from "../functions/_shared/mail-token.ts";
import type { MailReadDeps } from "../functions/mail-read/common.ts";
import { handleMailRead } from "../functions/mail-read/handler.ts";

// 진행 위치 검색(스펙 §15 DIGEST-unit ②, 계획 DP6): 가짜 Gmail(최신순·pageToken "p<색인>"·before:<초>)·SQL·OpenAI 없음. 합성 id·발신자만
const KEY_B64 = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const NOW = Date.parse("2026-10-23T03:00:00Z");
const USER = "11111111-1111-4111-8111-111111111111", CONN = "22222222-2222-4222-8222-222222222222";
type M = { id: string; at: number; labels?: string[] };
const mails = (n: number, at = (i: number) => NOW - i * 60_000, prefix = "m") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${String(i).padStart(3, "0")}`, at: at(i) }));
const idsOf = (n: number, at?: (i: number) => number) => mails(n, at).map((m) => m.id);
// pageCap = Gmail 이 maxResults 보다 짧은 쪽을 주는 경우(문서상 가능 — "Maximum number") — 한 요청이 여러 쪽을 넘기게 한다
function fake(list: () => M[], o: { rejectPage?: boolean; pageCap?: number; onList?: (n: number) => void } = {}) {
  const seen = { lists: 0, metas: 0, queries: [] as string[] };
  const noop = async () => {};
  const budget: BudgetDeps = { reserve: async () => ({ level: "ok", month: "2026-10-01" }), settle: noop, acquire: async () => 1, release: noop, now: () => new Date(NOW) };
  const holds: HoldDeps = { reserve: () => { throw new Error("no hold in search"); }, settle: () => { throw new Error("no hold in search"); } };
  const d: MailReadDeps = {
    enabled: () => true, authUser: async (t) => (t === "good" ? USER : null), connection: async () => ({ connection_id: CONN, status: "active" }),
    accessToken: async () => "at", takeUnits: async () => true, tokenKey: () => importTokenKey(KEY_B64), budget, holds,
    summarize: () => { throw new Error("no model in search"); }, summarizeDigest: () => { throw new Error("no model in search"); },
    audit: noop, sleep: noop, now: () => NOW, today: () => "2026-10-23",
    api: () => ({
      list: async (q, max, page) => {
        seen.lists++; seen.queries.push(q);
        o.onList?.(seen.lists);
        if (page && o.rejectPage) throw new GmailHttpError("messages.list", 400, ["invalidArgument"]);
        const before = Math.min(...[...q.matchAll(/before:(\d+)/g)].map((x) => Number(x[1]) * 1000), Infinity);
        const all = list().filter((m) => m.at < before), start = page ? Number(page.slice(1)) : 0, size = Math.min(max, o.pageCap ?? max);
        const slice = all.slice(start, start + size);
        return { messages: slice.map((m) => ({ id: m.id })), nextPageToken: start + size < all.length ? `p${start + size}` : undefined };
      },
      headers: async (id) => {
        seen.metas++;
        const m = list().find((x) => x.id === id);
        if (!m) throw new GmailHttpError("messages.get", 404, []);
        return { id, internalDate: String(m.at), labelIds: m.labels ?? ["INBOX"], payload: { headers: [{ name: "From", value: "합성상점 <shop@example.com>" }, { name: "Subject", value: "합성 " + id }] } } as GmailMessage;
      },
      full: () => { throw new Error("no full in search"); },
    }),
  };
  return { d, seen };
}
const post = (d: MailReadDeps, body: unknown) => handleMailRead(new Request("http://x/mail-read/search", { method: "POST", headers: { authorization: "Bearer good" }, body: JSON.stringify(body) }), d);
const claimsOf = (c: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(c.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0)))) as
  { b: number | null; p: string | null; o: number; l: string | null; t: number | null; s: string[] };
async function ids(r: Response): Promise<{ status: number; ids: string[]; next: string | null; complete: boolean; capped: boolean; j: Record<string, unknown> }> {
  const j = await r.json();
  const k = await importTokenKey(KEY_B64);
  const out: string[] = [];
  for (const c of (j.candidates ?? []) as { token: string }[]) { const v = await verifyToken(k, c.token, NOW / 1000); if (v.ok) out.push(v.claims.m); }
  return { status: r.status, ids: out, next: j.next_cursor ?? null, complete: j.complete, capped: j.count_capped, j };
}
// [다음]을 끝까지 누른다. between(n) = n 번째 응답 뒤(다음 요청 전) — 목록을 보는 사이의 변경
async function pageAll(d: MailReadDeps, body: Record<string, unknown>, between?: (n: number) => void) {
  const got: string[] = [];
  let cursor: string | null = null, n = 0;
  do {
    const r = await ids(await post(d, { ...body, ...(cursor ? { cursor } : {}) }));
    assertEquals(r.status, 200);
    got.push(...r.ids); cursor = r.next; n++;
    between?.(n);
  } while (cursor && n < 50);
  return { got, requests: n };
}
const B = { sender: "합성상점", limit: 10 };

Deno.test("no limit (0.18.x app): 5 candidates sorted by received time, next_cursor null, count_capped false, conditions.count null even if count sent", async () => {
  const { d } = fake(() => mails(12));
  const r = await ids(await post(d, { sender: "합성상점", count: 3 }));
  assertEquals([r.ids, r.next, r.capped, (r.j.conditions as { count: unknown }).count], [["m000", "m001", "m002", "m003", "m004"], null, false, null]);
  assertEquals(r.j.more, true);
});
Deno.test("limit 10 / limit 3: that many in list order; limit 11 and 0 → 400 bad_condition limit; cursor without limit → 400 cursor", async () => {
  const { d } = fake(() => mails(12));
  assertEquals((await ids(await post(d, B))).ids.length, 10);
  assertEquals((await ids(await post(d, { sender: "합성상점", limit: 3 }))).ids, ["m000", "m001", "m002"]);
  for (const l of [11, 0]) assertEquals((await (await post(d, { sender: "합성상점", limit: l })).json()), { error: "bad_condition", fields: ["limit"] });
  assertEquals((await (await post(d, { sender: "합성상점", cursor: "c1.a.b" })).json()), { error: "bad_condition", fields: ["cursor"] });
});
Deno.test("paging to the end: same millisecond 30, same second different ms 25, 3+ pages (65) → duplicates 0, missing 0, next_cursor null only at the end", async () => {
  for (const list of [mails(30, () => NOW), mails(25, (i) => NOW - (i % 1000)), mails(65)]) {
    const { d } = fake(() => list);
    const { got } = await pageAll(d, B);
    assertEquals(got, list.map((m) => m.id));
  }
});
Deno.test("a cursor that stopped at a page end points at the anchor's page (o 20), not the next page token (DP6)", async () => {
  const { d } = fake(() => mails(45));
  const first = await ids(await post(d, B));
  const second = await ids(await post(d, { ...B, cursor: first.next }));
  assertEquals(second.ids, idsOf(20).slice(10));
  const c = claimsOf(second.next!);
  assertEquals([c.p, c.o, c.l, c.b], [null, 20, "m019", null]);
});
Deno.test("filtered-only pages and empty pages: the same request keeps going; caps (list 10 · meta 20) still return a cursor that moves forward", async () => {
  const list = [...mails(20, undefined, "s").map((m) => ({ ...m, labels: ["SENT"] })), ...mails(5, (i) => NOW - 3_600_000 - i, "r")];
  const { d } = fake(() => list);
  const first = await ids(await post(d, B));
  assertEquals([first.ids, first.complete, first.next !== null], [[], false, true]);   // 메타 20 이 SENT 로 다 쓰였다 — 0통이어도 커서
  const second = await ids(await post(d, { ...B, cursor: first.next }));
  assertEquals([second.ids, second.next], [["r000", "r001", "r002", "r003", "r004"], null]);
});
Deno.test("new mail arriving at the top between requests: the anchor is found again at a shifted offset → duplicates 0, missing 0, no time fallback", async () => {
  let list = mails(25);
  const { d, seen } = fake(() => list);
  const { got } = await pageAll(d, B, (n) => { if (n === 1) list = [...mails(3, (i) => NOW + (3 - i) * 1000, "n"), ...list]; });
  assertEquals(got, idsOf(25));
  assertEquals(seen.queries.some((q) => q.includes("before:")), false);
});
Deno.test("resume: last consumed mail trashed before [next] → the following mail is not skipped and nothing repeats (time fallback, DP6, Review Focus 1)", async () => {
  let list = mails(25);
  const { d, seen } = fake(() => list);
  const { got } = await pageAll(d, B, (n) => { if (n === 1) list = list.filter((m) => m.id !== "m009"); });
  assertEquals(got, idsOf(25));                                                        // m009 는 지우기 전에 이미 받았다
  assert(seen.queries.some((q) => q.includes("before:")), "time fallback used");
});
Deno.test("page boundary: the anchor (last of a Gmail page) deleted before [next] → duplicates 0, missing 0 (Codex plan review #1)", async () => {
  let list = mails(45);
  const { d } = fake(() => list);
  const { got } = await pageAll(d, B, (n) => { if (n === 2) list = list.filter((m) => m.id !== "m019"); });   // 둘째 응답 = m010~m019, 앵커 m019 = 첫 쪽 끝
  assertEquals(got, idsOf(45));
});
Deno.test("same page: the last two consumed deleted before [next] → duplicates 0, missing 0", async () => {
  let list = mails(25);
  const { d } = fake(() => list);
  const { got } = await pageAll(d, B, (n) => { if (n === 1) list = list.filter((m) => m.id !== "m008" && m.id !== "m009"); });
  assertEquals(got, idsOf(25));
});
Deno.test("insertion pushes the anchor out of its page (15 new mails on top) → the old list continues: duplicates 0, missing 0, new mails not mixed in", async () => {
  let list = mails(30);
  const { d } = fake(() => list);
  const { got } = await pageAll(d, B, (n) => { if (n === 1) list = [...mails(15, (i) => NOW + (15 - i) * 1000, "n"), ...list]; });
  assertEquals(got, idsOf(30));
});
Deno.test("same millisecond 30 with the anchor deleted → time fallback with s: duplicates 0, missing 0 (t on a whole second still included — ⌊t/1000⌋ + 1)", async () => {
  let list = mails(30, () => NOW);
  const { d } = fake(() => list);
  const { got } = await pageAll(d, B, (n) => { if (n === 1) list = list.filter((m) => m.id !== "m009"); });
  assertEquals(got, idsOf(30, () => NOW));
});
Deno.test("documented limit: same millisecond 40 with the anchor deleted after 30 were seen (s keeps 20) → missing 0; repeats only mails already shown; it ends", async () => {
  let list = mails(40, () => NOW);
  const { d } = fake(() => list);
  const shown: string[] = [];
  const { got, requests } = await pageAll(d, B, (n) => { if (n === 3) { shown.push(...idsOf(30, () => NOW)); list = list.filter((m) => m.id !== "m029"); } });
  assertEquals(new Set(got), new Set(idsOf(40, () => NOW)));                         // 누락 0
  const repeats = got.slice(30).filter((id) => got.indexOf(id) < 30);
  assert(repeats.length > 0 && repeats.every((id) => shown.includes(id)), JSON.stringify(repeats));   // 중복은 이미 본 메일만(한계 — 스펙 "보장 범위")
  assert(requests < 50);
});
Deno.test("one request never yields the same Gmail id twice even when the list shifts between pages (Review Focus 5)", async () => {
  // 쪽 5개씩: 첫 쪽(m000~m004)을 읽은 뒤 새 메일 2통이 맨 앞에 와서 둘째 쪽 "p5"가 m003·m004 부터 시작한다
  let list: M[] = mails(40);
  const { d } = fake(() => list, { pageCap: 5, onList: (n) => { if (n === 2) list = [...mails(2, (i) => NOW + (2 - i) * 1000, "n"), ...mails(40)]; } });
  const r = await ids(await post(d, { sender: "합성상점", limit: 10, count: 30 }));
  assertEquals(r.ids, idsOf(10));                                                     // 중복 0(m003·m004 한 번씩), 누락 0
});
Deno.test("resume at a page end (o 20): new mail on top between the anchor page and the next page in the same request → the anchor and earlier ids are not consumed again (S4 review I1)", async () => {
  // 셋째 요청: 첫 쪽에서 앵커 m019 를 k = 19 에서 확인(소비 0) → 둘째 list("p20") 직전 새 메일 1통 — 오프셋형 p20 이 m019 부터 시작한다
  let list: M[] = mails(45);
  const { d } = fake(() => list, { onList: (n) => { if (n === 4) list = [...mails(1, () => NOW + 1000, "n"), ...list]; } });
  const { got } = await pageAll(d, B);
  assertEquals(got, idsOf(45));
});
Deno.test("a Gmail 400 on a nextPageToken issued within the same request is a Gmail error (502), not token_expired (S4 review M1)", async () => {
  const { d } = fake(() => mails(40), { rejectPage: true, pageCap: 5 });
  const r = await post(d, B);
  assertEquals([r.status, (await r.json()).error], [502, "gmail_upstream"]);
});
Deno.test("cursor errors: other conditions → 404, expired → 410, latest + cursor → 400, a rejected pageToken on a real second Gmail page (p set) → 410", async () => {
  const { d } = fake(() => mails(65));
  const first = await ids(await post(d, B));
  assertEquals((await post(d, { sender: "합성레터", limit: 10, cursor: first.next })).status, 404);
  const later: MailReadDeps = { ...d, now: () => NOW + 601_000 };
  assertEquals((await (await post(later, { ...B, cursor: first.next })).json()).error, "token_expired");
  assertEquals((await post(d, { latest: true, limit: 10, cursor: first.next })).status, 400);
  let cur = first.next!, guard = 0;
  while (claimsOf(cur).p === null && guard++ < 5) cur = (await ids(await post(d, { ...B, cursor: cur }))).next!;
  assertEquals([claimsOf(cur).p, claimsOf(cur).l], ["p20", "m029"]);                  // 세 번째 응답 뒤 — 앵커가 둘째 Gmail 쪽에 있다
  const { d: rej, seen } = fake(() => mails(65), { rejectPage: true });
  const r = await post(rej, { ...B, cursor: cur });
  assertEquals([r.status, (await r.json()).error, seen.lists], [410, "token_expired", 1]);
});
Deno.test("count_capped: count 40 with limit → conditions.count 30, count_capped true; latest with limit uses the time-window path (≤ 5, no cursor)", async () => {
  const { d } = fake(() => mails(12));
  const r = await ids(await post(d, { sender: "합성상점", count: 40, limit: 10 }));
  assertEquals([(r.j.conditions as { count: number }).count, r.capped, r.ids.length], [30, true, 10]);
  const l = await ids(await post(d, { latest: true, limit: 10 }));
  assertEquals([l.ids[0], l.ids.length <= 5, l.next], ["m000", true, null]);          // 0.18.x 시간 창 경로 그대로(후보 최대 5, 앱은 첫 후보)
});
// S3 리뷰가 S4에 넘긴 확인(브리프 밖 추가): 앱은 [다음]에 응답 conditions 를 그대로 되보낸다(count 30 으로 줄어든 값·latest false) — 같은 지문이어야 이어진다.
// 커서 e = 발급 + TOKEN_TTL_S. Gmail nextPageToken 은 숫자 문자열 모양(관측) — mail-token PAGE 정규식 안이라 커서가 왕복한다
Deno.test("S3 review checks: echoing the response conditions continues (same print, count 40 → 30, latest dropped); cursor e = now + 600; a Gmail-like numeric page token round-trips", async () => {
  const { d } = fake(() => mails(65));
  const gm = new Map<string, string>(), back = new Map<string, string>();
  const gmailLike = (p: string) => { if (!gm.has(p)) { const g = String(10_000_000_000_000_000_000n + BigInt(p.slice(1))); gm.set(p, g); back.set(g, p); } return gm.get(p)!; };
  const base = d.api("at");
  const nd: MailReadDeps = { ...d, api: () => ({ ...base, list: async (q, max, page, t) => {
    const r = await base.list(q, max, page === undefined ? undefined : back.get(page) ?? "bad", t);
    return { ...r, nextPageToken: r.nextPageToken === undefined ? undefined : gmailLike(r.nextPageToken) };
  } }) };
  const first = await ids(await post(nd, { sender: "합성상점", count: 40, latest: true, limit: 10 }));
  assertEquals([(first.j.conditions as { count: number; latest: boolean }).count, (first.j.conditions as { latest: boolean }).latest, first.capped], [30, false, true]);
  assertEquals((claimsOf(first.next!) as unknown as { e: number }).e, NOW / 1000 + 600);
  const got = [...first.ids];
  let cursor = first.next, n = 0, withPage = 0;
  while (cursor && n++ < 10) {
    const r = await ids(await post(nd, { ...(first.j.conditions as Record<string, unknown>), cursor, limit: 10 }));
    assertEquals(r.status, 200);
    got.push(...r.ids); cursor = r.next;
    if (cursor && claimsOf(cursor).p !== null) { withPage++; assert(/^[0-9]{20}$/.test(claimsOf(cursor).p!), claimsOf(cursor).p!); }
  }
  assertEquals(got, idsOf(65));
  assert(withPage > 0, "a cursor carried a Gmail-like page token into the next request");
});
