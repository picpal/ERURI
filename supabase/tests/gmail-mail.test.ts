import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { classifyGmailError, getMessageFull, GMAIL_MODIFY_SCOPE, GmailHttpError, gmailMailApi, MAIL_CALL_TIMEOUT_MS, refreshAccessToken } from "../functions/_shared/gmail.ts";

// 메일 정리 Gmail 래퍼(스펙 §7): 요청 모양·reason 파싱·분류. fetch 를 바꿔 끼운다(네트워크 없음)
type Call = { url: URL; method: string; body: unknown; auth: string | null; signal: AbortSignal | null };
function stub(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const c: Call = { url: new URL(input instanceof Request ? input.url : String(input)), method: init.method ?? "GET",
      body: typeof init.body === "string" ? JSON.parse(init.body) : null, auth: new Headers(init.headers).get("authorization"),
      signal: init.signal ?? null };
    calls.push(c);
    return respond(c);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
const gErr = (status: number, reason: string, details?: string) => Response.json({ error: { code: status, message: "합성 메시지 본문",
  errors: [{ reason, message: "x" }], ...(details ? { details: [{ reason: details }] } : {}) } }, { status });

Deno.test("list: q, maxResults and pageToken in the URL; resultSizeEstimate passes through", async () => {
  const s = stub(() => Response.json({ messages: [{ id: "a" }], nextPageToken: "p2", resultSizeEstimate: 1234 }));
  try {
    const p = await gmailMailApi("at").list(`in:inbox -is:starred from:"합성상점"`, 500, "p1");
    assertEquals(p, { messages: [{ id: "a" }], nextPageToken: "p2", resultSizeEstimate: 1234 });
    const u = s.calls[0].url;
    assertEquals([u.pathname, u.searchParams.get("q"), u.searchParams.get("maxResults"), u.searchParams.get("pageToken"), s.calls[0].auth],
      ["/gmail/v1/users/me/messages", `in:inbox -is:starred from:"합성상점"`, "500", "p1", "Bearer at"]);
  } finally { s.restore(); }
});

Deno.test("headers: format=metadata with From and Subject only; labels: format=minimal", async () => {
  const s = stub(() => Response.json({ id: "m 1", internalDate: "1790000000000", labelIds: ["INBOX"] }));
  try {
    await gmailMailApi("at").headers("m 1");
    await gmailMailApi("at").labels("m 1");
    assertEquals(s.calls[0].url.pathname, "/gmail/v1/users/me/messages/m%201");
    assertEquals([s.calls[0].url.searchParams.get("format"), s.calls[0].url.searchParams.getAll("metadataHeaders")], ["metadata", ["From", "Subject"]]);
    assertEquals(s.calls[0].url.searchParams.get("fields"), "id,internalDate,labelIds,payload/headers");   // snippet(본문 앞부분)이 오지 않게
    assertEquals(s.calls[1].url.searchParams.get("format"), "minimal");
  } finally { s.restore(); }
});

Deno.test("writes: batchModify body, trash/untrash/modify paths and POST", async () => {
  const s = stub(() => new Response(null, { status: 204 }));
  try {
    const api = gmailMailApi("at");
    await api.batchModify(["a", "b"], ["TRASH"], []);
    await api.trash("a"); await api.untrash("a"); await api.modify("a", ["UNREAD"], []);
    assertEquals(s.calls.map((c) => [c.method, c.url.pathname]), [
      ["POST", "/gmail/v1/users/me/messages/batchModify"], ["POST", "/gmail/v1/users/me/messages/a/trash"],
      ["POST", "/gmail/v1/users/me/messages/a/untrash"], ["POST", "/gmail/v1/users/me/messages/a/modify"]]);
    assertEquals(s.calls[0].body, { ids: ["a", "b"], addLabelIds: ["TRASH"], removeLabelIds: [] });
    assertEquals(s.calls[3].body, { addLabelIds: ["UNREAD"], removeLabelIds: [] });
    assert(s.calls.every((c) => c.signal instanceof AbortSignal));                // 호출마다 타임아웃 신호(D7 — 15초)
    assertEquals(MAIL_CALL_TIMEOUT_MS, 15_000);
  } finally { s.restore(); }
});

Deno.test("refreshAccessToken: an optional timeout adds an abort signal; without it the request is unchanged (collection path)", async () => {
  const s = stub(() => Response.json({ access_token: "at" }));
  try {
    assertEquals(await refreshAccessToken("rt"), "at");
    assertEquals(await refreshAccessToken("rt", MAIL_CALL_TIMEOUT_MS), "at");
    assertEquals([s.calls[0].signal, s.calls[1].signal instanceof AbortSignal], [null, true]);
  } finally { s.restore(); }
});

Deno.test("errors carry status and reason codes only — never the message body", async () => {
  const s = stub(() => gErr(403, "insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"));
  try {
    const e = await assertRejects(() => gmailMailApi("at").batchModify(["a"], [], ["UNREAD"]), GmailHttpError);
    assertEquals([e.message, e.status, e.reasons], ["messages.batchModify 403", 403, ["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"]]);
    assert(!JSON.stringify(e).includes("합성"));
  } finally { s.restore(); }
  const t = stub(() => Response.json({ error: { errors: [{ reason: "bad reason <x>" }, { reason: "a".repeat(80) }] } }, { status: 400 }));
  try {
    const e = await assertRejects(() => gmailMailApi("at").trash("a"), GmailHttpError);
    assertEquals(e.reasons, []);                                                  // 코드 모양이 아닌 값은 버린다
  } finally { t.restore(); }
});

Deno.test("classifyGmailError: 429 and quota reasons → quota, permission reasons → scope, 400 rejected, 404 gone, the rest unknown", () => {
  const E = (s: number, ...r: string[]) => new GmailHttpError("x", s, r);
  assertEquals(classifyGmailError(E(429)), "quota");
  assertEquals(classifyGmailError(E(403, "rateLimitExceeded")), "quota");
  assertEquals(classifyGmailError(E(403, "userRateLimitExceeded")), "quota");
  assertEquals(classifyGmailError(E(403, "quotaExceeded")), "quota");
  assertEquals(classifyGmailError(E(403, "insufficientPermissions")), "scope");
  assertEquals(classifyGmailError(E(403, "forbidden")), "unknown");              // 403 을 일괄 미지원으로 보지 않는다
  assertEquals(classifyGmailError(E(403)), "unknown");                           // reason 없는 403 도 단정하지 않는다
  assertEquals(classifyGmailError(E(403, "dailyLimitExceeded")), "quota");
  assertEquals(classifyGmailError(E(403, "RATE_LIMIT_EXCEEDED")), "quota");         // 새 형식(error.details[].reason)
  assertEquals(classifyGmailError(E(403, "ACCESS_TOKEN_SCOPE_INSUFFICIENT")), "scope");
  // 쿼터·권한이 함께 오면 쿼터 — 미루기는 30분 뒤 실패로 끝나 되돌릴 수 있지만, scope 는 재시도 없이 남은 id 를 실패로 마감한다
  assertEquals(classifyGmailError(E(403, "insufficientPermissions", "rateLimitExceeded")), "quota");
  assertEquals(classifyGmailError(E(403, "RATE_LIMIT_EXCEEDED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT")), "quota");
  assertEquals(classifyGmailError(E(400, "invalidArgument")), "rejected");
  assertEquals(classifyGmailError(E(404)), "gone");
  assertEquals(classifyGmailError(E(500)), "unknown");
  assertEquals(classifyGmailError(E(401)), "unknown");                           // 401 은 함수·잡이 따로 다룬다(연결 문제)
  assertEquals(classifyGmailError(new TypeError("network")), "unknown");
  assertEquals(classifyGmailError(new DOMException("t", "TimeoutError")), "unknown");
  assertEquals(GMAIL_MODIFY_SCOPE, "https://www.googleapis.com/auth/gmail.modify");
});
Deno.test("getMessageFull: format=full on the message URL, 15 s timeout signal, error carries the status and reasons", async () => {
  const orig = globalThis.fetch;
  const seen: { url: string; signal: boolean }[] = [];
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    seen.push({ url: String(u), signal: init?.signal instanceof AbortSignal });
    return new Response(JSON.stringify({ error: { errors: [{ reason: "notFound" }] } }), { status: 404 });
  }) as typeof fetch;
  try {
    const e = await getMessageFull("at", "abc").catch((x) => x);
    assertEquals([e instanceof GmailHttpError, e.status, e.reasons], [true, 404, ["notFound"]]);
    assertEquals(seen, [{ url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/abc?format=full", signal: true }]);
  } finally { globalThis.fetch = orig; }
});
