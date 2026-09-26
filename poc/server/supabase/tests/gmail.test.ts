import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createLocalJWKSet, exportJWK, generateKeyPair, type KeyLike, SignJWT } from "npm:jose@5";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import {
  collectNewMessageIds, type GmailApi, type GmailClient, type GmailMessage, gmailToItem, plainText, ReauthRequired, refreshAccessToken,
} from "../functions/_shared/gmail.ts";
import { gmailFetch, type GmailJobDeps, gmailSync, gmailWatch, type RpcClient } from "../functions/_shared/gmail-jobs.ts";
import { type ConnectDeps, handleConnect } from "../functions/gmail-connect/handler.ts";
import { handleWebhook, verifyPubSubToken } from "../functions/gmail-webhook/handler.ts";
import type { Job } from "../functions/_shared/job.ts";

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fakeApi(o: { historyPages?: { ids: string[]; historyId: string }[]; notFound?: boolean; listPages?: string[][]; profileHistoryId?: string }) {
  const calls: string[] = [];
  const api: GmailApi = {
    history: async (_start, pageToken) => {
      calls.push("history:" + (pageToken ?? ""));
      if (o.notFound) return { notFound: true as const };
      const i = Number(pageToken ?? 0), p = o.historyPages![i];
      return { history: [{ messagesAdded: p.ids.map((id) => ({ message: { id } })) }], historyId: p.historyId,
               nextPageToken: i + 1 < o.historyPages!.length ? String(i + 1) : undefined };
    },
    listMessageIds: async (q, pageToken) => {
      calls.push("list:" + q);
      const i = Number(pageToken ?? 0);
      return { messages: o.listPages![i].map((id) => ({ id })), nextPageToken: i + 1 < o.listPages!.length ? String(i + 1) : undefined };
    },
    profile: async () => { calls.push("profile"); return { emailAddress: "poc@example.com", historyId: o.profileHistoryId ?? "0" }; },
  };
  return { api, calls };
}

// ── 순수: history·재동기화·본문·규칙 ──────────────────────────────

Deno.test("history pages are merged and cursor moves to the last historyId", async () => {
  const { api } = fakeApi({ historyPages: [{ ids: ["a", "b"], historyId: "110" }, { ids: ["b", "c"], historyId: "120" }] });
  const r = await collectNewMessageIds(api, { cursor: "100", lastSuccessAt: "2026-09-20T00:00:00Z" });
  assertEquals(r, { ids: ["a", "b", "c"], cursor: "120", mode: "history" });
});

Deno.test("history 404 → profile first, then messages.list(after: last_success_at - 1 day) across pages", async () => {
  const { api, calls } = fakeApi({ notFound: true, listPages: [["m1", "m2"], ["m3"]], profileHistoryId: "999" });
  const r = await collectNewMessageIds(api, { cursor: "1", lastSuccessAt: "2026-09-20T00:00:00Z" });
  const after = Date.UTC(2026, 8, 20) / 1000 - 86400;
  assertEquals(calls, ["history:", "profile", `list:after:${after} -category:promotions`, `list:after:${after} -category:promotions`]);
  assertEquals(r, { ids: ["m1", "m2", "m3"], cursor: "999", mode: "resync" });
});

Deno.test("plainText prefers text/plain, skips attachments, falls back to stripped html", () => {
  const multipart = { payload: { mimeType: "multipart/mixed", parts: [
    { mimeType: "multipart/alternative", parts: [
      { mimeType: "text/plain", body: { data: b64("합성 주문 확인: 무선 이어폰") } },
      { mimeType: "text/html", body: { data: b64("<p>무시</p>") } } ] },
    { mimeType: "application/pdf", filename: "영수증.pdf", body: { attachmentId: "att1" } } ] } };
  assertEquals(plainText(multipart), "합성 주문 확인: 무선 이어폰");
  const htmlOnly = { payload: { mimeType: "text/html", body: { data: b64("<style>p{}</style><p>합성&nbsp;배송 <b>시작</b> &amp; 안내</p>") } } };
  assertEquals(plainText(htmlOnly), "합성 배송 시작 & 안내");
});

Deno.test("refresh token invalid_grant → ReauthRequired; other errors are plain errors", async () => {
  {
    using _f = stub(globalThis, "fetch", () => Promise.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    await assertRejects(() => refreshAccessToken("rt"), ReauthRequired);
  }
  {
    using _f = stub(globalThis, "fetch", () => Promise.resolve(new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 })));
    const e = await assertRejects(() => refreshAccessToken("rt"));
    assert(!(e instanceof ReauthRequired));
  }
});

const gmsg = (id: string, body: string, subject: string, labelIds = ["INBOX"]): GmailMessage => ({ id, internalDate: "1790000000000", labelIds,
  payload: { mimeType: "text/plain", headers: [{ name: "Subject", value: subject }, { name: "From", value: "합성쇼핑 <shop@example.com>" }],
             body: { data: b64(body) } } });

Deno.test("gmailToItem applies server rules: promotion label, OTP, card masking in body and subject", () => {
  assertEquals(gmailToItem(gmsg("m1", "가을 세일", "세일", ["INBOX", "CATEGORY_PROMOTIONS"])), { kind: "discard", reason: "promotion" });
  assertEquals(gmailToItem(gmsg("m1", "인증번호 483920 을 입력하세요", "본인 확인")), { kind: "discard", reason: "otp" });
  assertEquals(gmailToItem(gmsg("m1", "카드 4532-0151-1283-0366 승인 32,000원", "결제 4532015112830366 완료")), {
    kind: "pass", sender: "합성쇼핑 <shop@example.com>", title: "결제 ************0366 완료",
    text: "카드 ****-****-****-0366 승인 32,000원", occurredAt: new Date(1790000000000).toISOString() });
});

// ── 모의 API: worker 잡 핸들러 ────────────────────────────────────

const USER = "00000000-0000-4000-8000-000000000001";
const CONN = "00000000-0000-4000-8000-0000000000c1";
const job = (kind: string, payload: Record<string, unknown> = {}): Job =>
  ({ id: "job-1", kind, user_id: USER, payload: { connection_id: CONN, ...payload }, attempts: 1, checkpoint: null });

function fakeRpc(results: Record<string, unknown> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: RpcClient = {
    rpc: (fn, args = {}) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: fn in results ? results[fn] : null, error: null });
    },
  };
  return { rpc, calls };
}

function fakeDeps(o: { api?: Partial<GmailClient>; refresh?: (rt: string) => Promise<string> } = {}) {
  const log: string[] = [];
  const deps: GmailJobDeps = {
    refresh: o.refresh ?? (async () => "access-1"),
    api: () => ({
      history: async () => ({ notFound: true as const }),
      listMessageIds: async () => ({ messages: [] }),
      profile: async () => ({ emailAddress: "poc@example.com", historyId: "1" }),
      getMessage: async (id) => gmsg(id, "합성 본문", "합성 제목"),
      watch: async (topic) => { log.push("watch:" + topic); return { historyId: "500", expiration: "1790600000000" }; },
      ...o.api,
    }),
    encrypt: async (_u, t) => new TextEncoder().encode("ENC(" + t + ")"),
    pause: async () => {},
    topic: () => "projects/p/topics/gmail-push",
  };
  return { deps, log };
}

Deno.test("gmail-sync: history 404 → resync ids enqueued as gmail-fetch (50 per job) before the cursor moves", async () => {
  const ids = Array.from({ length: 120 }, (_, i) => "m" + i);
  const { rpc, calls } = fakeRpc({ gmail_get_refresh_token: "rt-1", gmail_state: [{ cursor: "1", last_success_at: "2026-09-20T00:00:00Z" }] });
  const { deps } = fakeDeps({ api: {
    history: async () => ({ notFound: true as const }),
    profile: async () => ({ emailAddress: "poc@example.com", historyId: "999" }),
    listMessageIds: async (_q, p) => p ? { messages: ids.slice(100).map((id) => ({ id })) } : { messages: ids.slice(0, 100).map((id) => ({ id })), nextPageToken: "1" },
  } });
  assertEquals(await gmailSync(rpc, job("gmail-sync"), deps), "resync");
  const fns = calls.map((c) => c.fn);
  assertEquals(fns, ["gmail_get_refresh_token", "gmail_state", "enqueue_job", "enqueue_job", "enqueue_job", "gmail_update"]);
  const enq = calls.filter((c) => c.fn === "enqueue_job");
  assertEquals(enq.map((c) => (c.args.p_payload as { ids: string[] }).ids.length), [50, 50, 20]);
  assertEquals(enq[0].args.p_lease_key, "gmail:" + CONN);
  assertEquals(enq[0].args.p_kind, "gmail-fetch");
  assertEquals(calls.at(-1)!.args, { p_user: USER, p_connection: CONN, p_cursor: "999" });
});

Deno.test("gmail-sync: invalid_grant → connection reauth_required, job ends as skipped (no retry)", async () => {
  const { rpc, calls } = fakeRpc({ gmail_get_refresh_token: "rt-1" });
  const { deps } = fakeDeps({ refresh: async () => { throw new ReauthRequired("invalid_grant"); } });
  assertEquals(await gmailSync(rpc, job("gmail-sync"), deps), "skipped");
  assertEquals(calls.map((c) => c.fn), ["gmail_get_refresh_token", "gmail_update"]);
  assertEquals(calls[1].args, { p_user: USER, p_connection: CONN, p_status: "reauth_required" });
});

Deno.test("gmail jobs skip inactive connections (no refresh token)", async () => {
  const { rpc, calls } = fakeRpc({ gmail_get_refresh_token: null });
  const { deps } = fakeDeps();
  assertEquals(await gmailWatch(rpc, job("gmail-watch"), deps), "skipped");
  assertEquals(calls.map((c) => c.fn), ["gmail_get_refresh_token"]);
});

Deno.test("gmail-fetch: rules → encrypt → insert_item; discarded messages are not stored", async () => {
  const bodies: Record<string, GmailMessage> = {
    a: gmsg("a", "카드 4532-0151-1283-0366 승인 32,000원", "결제 4532015112830366 완료"),
    b: gmsg("b", "인증번호 483920 을 입력하세요", "본인 확인"),
    c: gmsg("c", "가을 세일", "세일", ["INBOX", "CATEGORY_PROMOTIONS"]),
  };
  const { rpc, calls } = fakeRpc({ gmail_get_refresh_token: "rt-1", insert_item: "item-a" });
  const { deps } = fakeDeps({ api: { getMessage: async (id) => bodies[id] } });
  assertEquals(await gmailFetch(rpc, job("gmail-fetch", { ids: ["a", "b", "c"] }), deps), "fetched");
  const ins = calls.filter((c) => c.fn === "insert_item");
  assertEquals(ins.length, 1);
  const a = ins[0].args;
  assertEquals([a.p_user, a.p_source, a.p_idempotency_key, a.p_title], [USER, "GMAIL", "gmail:a", "결제 ************0366 완료"]);
  // 본문은 마스킹 후 암호화된 bytea로만 간다
  assertEquals(a.p_content_enc, "\\x" + Array.from(new TextEncoder().encode("ENC(카드 ****-****-****-0366 승인 32,000원)"), (x) => x.toString(16).padStart(2, "0")).join(""));
  assert(!JSON.stringify(a).includes("4532-0151"));
});

Deno.test("gmail-watch: renews watch on the topic and stores the new expiration", async () => {
  const { rpc, calls } = fakeRpc({ gmail_get_refresh_token: "rt-1" });
  const { deps, log } = fakeDeps();
  assertEquals(await gmailWatch(rpc, job("gmail-watch"), deps), "watched");
  assertEquals(log, ["watch:projects/p/topics/gmail-push"]);
  assertEquals(calls.at(-1)!.args, { p_user: USER, p_connection: CONN, p_watch_expires_at: new Date(1790600000000).toISOString() });
});

// ── 모의 API: gmail-connect ───────────────────────────────────────

function connectDeps(o: { user?: string | null; refreshToken?: string | null; saveError?: string } = {}) {
  const calls: string[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const d: ConnectDeps = {
    authUser: async (t) => (t === "user-jwt" ? (o.user === undefined ? USER : o.user) : null),
    exchange: async (code) => { calls.push("exchange:" + code); return { access_token: "at", refresh_token: o.refreshToken === undefined ? "rt" : o.refreshToken ?? undefined, expires_in: 3600 }; },
    api: () => ({
      profile: async () => { calls.push("profile"); return { emailAddress: "poc@example.com", historyId: "400" }; },
      watch: async () => { calls.push("watch"); return { historyId: "500", expiration: "1790600000000" }; },
      listMessageIds: async (q, p) => { calls.push("list:" + q + ":" + (p ?? "")); return p ? { messages: [{ id: "m3" }] } : { messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "1" }; },
    }),
    rpc: { rpc: (fn, args = {}) => {
      rpcCalls.push({ fn, args });
      if (fn === "gmail_save_connection" && o.saveError) return Promise.resolve({ data: null, error: { code: o.saveError } });
      return Promise.resolve({ data: fn === "gmail_save_connection" ? CONN : null, error: null });
    } },
    topic: () => "projects/p/topics/gmail-push",
  };
  return { d, calls, rpcCalls };
}
const connectReq = (body: unknown, token: string | null = "user-jwt") => new Request("http://x/gmail-connect", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });

Deno.test("gmail-connect: 401 without or with invalid user JWT, nothing exchanged", async () => {
  const { d, calls } = connectDeps();
  assertEquals((await handleConnect(connectReq({ code: "c" }, null), d)).status, 401);
  assertEquals((await handleConnect(connectReq({ code: "c" }, "bad"), d)).status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("gmail-connect: 400 without code", async () => {
  const { d } = connectDeps();
  assertEquals((await handleConnect(connectReq({}), d)).status, 400);
  assertEquals((await handleConnect(connectReq({ code: "" }), d)).status, 400);
});

Deno.test("gmail-connect: exchange → profile → watch → save(vault) → watch expiry → backfill fetch jobs → sync job", async () => {
  const { d, calls, rpcCalls } = connectDeps();
  const r = await handleConnect(connectReq({ code: "auth-code" }), d);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { connection_id: CONN, account: "poc@example.com", refresh_token_stored: true,
    watch_expires_at: new Date(1790600000000).toISOString(), backfill_pages: 2, backfill_messages: 3 });
  assertEquals(calls, ["exchange:auth-code", "profile", "watch", "list:newer_than:90d -category:promotions:", "list:newer_than:90d -category:promotions:1"]);
  assertEquals(rpcCalls.map((c) => c.fn), ["gmail_save_connection", "gmail_update", "enqueue_job", "enqueue_job", "gmail_enqueue_for_account"]);
  assertEquals(rpcCalls[0].args, { p_user: USER, p_account_ref: "poc@example.com", p_refresh_token: "rt", p_history_id: "500" });
  assertEquals(rpcCalls[2].args.p_payload, { connection_id: CONN, ids: ["m1", "m2"] });
});

Deno.test("gmail-connect: no refresh token from Google is reported; account linked to another user → 409", async () => {
  const noRt = connectDeps({ refreshToken: null });
  const r = await handleConnect(connectReq({ code: "c" }), noRt.d);
  assertEquals((await r.json()).refresh_token_stored, false);
  assertEquals(noRt.rpcCalls[0].args.p_refresh_token, null);
  const taken = connectDeps({ saveError: "P0001" });
  assertEquals((await handleConnect(connectReq({ code: "c" }), taken.d)).status, 409);
});

// ── 모의: gmail-webhook OIDC ─────────────────────────────────────

const AUD = "https://example.supabase.co/functions/v1/gmail-webhook";
const SA = "gmail-push@proj.iam.gserviceaccount.com";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const { privateKey: otherKey } = await generateKeyPair("RS256");
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }] });
async function oidc(o: { aud?: string; email?: string; verified?: boolean; iss?: string; exp?: number; key?: KeyLike } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return "Bearer " + await new SignJWT({ email: o.email ?? SA, email_verified: o.verified ?? true })
    .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(o.iss ?? "https://accounts.google.com").setAudience(o.aud ?? AUD)
    .setIssuedAt(now).setExpirationTime(o.exp ?? now + 3600).sign(o.key ?? privateKey);
}

Deno.test("verifyPubSubToken: accepts only Google-signed token with matching aud, SA email, verified", async () => {
  const v = (h: string | null, email: string | undefined = SA) => verifyPubSubToken(h, { audience: AUD, email, jwks });
  assertEquals(await v(await oidc()), true);
  assertEquals(await v(await oidc({ iss: "accounts.google.com" })), true);
  assertEquals(await v(await oidc({ aud: "https://evil.example/hook" })), false);
  assertEquals(await v(await oidc({ email: "someone@proj.iam.gserviceaccount.com" })), false);
  assertEquals(await v(await oidc({ verified: false })), false);
  assertEquals(await v(await oidc({ iss: "https://evil.example" })), false);
  assertEquals(await v(await oidc({ exp: Math.floor(Date.now() / 1000) - 600 })), false);
  assertEquals(await v(await oidc({ key: otherKey })), false);
  assertEquals(await v(null), false);
  assertEquals(await v("Bearer not-a-jwt"), false);
  assertEquals(await verifyPubSubToken(await oidc(), { audience: AUD, email: undefined, jwks }), false);   // PUBSUB_PUSH_SA_EMAIL 미설정이면 거부
});

const pushReq = (auth: string | null, data: unknown) => new Request("http://x/gmail-webhook", { method: "POST",
  headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
  body: JSON.stringify({ message: { data: btoa(JSON.stringify(data)), messageId: "1" }, subscription: "projects/p/subscriptions/s" }) });

Deno.test("gmail-webhook: 401 on failed verification; otherwise enqueue by emailAddress and ack 200", async () => {
  const enq: string[] = [];
  const deps = (ok: boolean, created: boolean) => ({ verify: async () => ok, enqueue: async (e: string) => { enq.push(e); return created; } });
  assertEquals((await handleWebhook(pushReq(null, { emailAddress: "poc@example.com", historyId: "9" }), deps(false, true))).status, 401);
  assertEquals(enq.length, 0);
  assertEquals((await handleWebhook(pushReq("Bearer x", { emailAddress: "poc@example.com", historyId: "9" }), deps(true, true))).status, 200);
  assertEquals((await handleWebhook(pushReq("Bearer x", { emailAddress: "unknown@example.com", historyId: "9" }), deps(true, false))).status, 200);
  assertEquals(enq, ["poc@example.com", "unknown@example.com"]);
  const bad = new Request("http://x", { method: "POST", headers: { authorization: "Bearer x" }, body: "{not json" });
  assertEquals((await handleWebhook(bad, deps(true, true))).status, 200);   // 형식 오류도 ack(재전송 폭주 방지), 저장 없음
  assertEquals(enq.length, 2);
});

// ── DB (호스팅, db push 후. 워커 cron 정지 상태에서) ─────────────────

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const POC_USER = Deno.env.get("POC_USER_ID")!;

Deno.test("daily watch cron enqueues one gmail-watch per active connection only", async () => {
  await sb.from("jobs").delete().eq("kind", "gmail-watch");
  const { data: conns } = await sb.from("connections").insert([
    { user_id: POC_USER, provider: "gmail", account_ref: `a-${crypto.randomUUID()}@example.com`, status: "active" },
    { user_id: POC_USER, provider: "gmail", account_ref: `r-${crypto.randomUUID()}@example.com`, status: "reauth_required" },
  ]).select("id, status");
  const { count: active } = await sb.from("connections").select("*", { count: "exact", head: true }).eq("status", "active");
  const first = await sb.rpc("gmail_enqueue_all", { p_kind: "gmail-watch" });
  const second = await sb.rpc("gmail_enqueue_all", { p_kind: "gmail-watch" });   // 대기 중이면 중복 적재 안 함
  assertEquals(first.data, active);
  assertEquals(second.data, 0);
  const reauth = conns!.find((c) => c.status === "reauth_required")!;
  const { count } = await sb.from("jobs").select("*", { count: "exact", head: true }).eq("lease_key", "gmail:" + reauth.id);
  assertEquals(count, 0);
  assert(active! >= 1);
  await sb.from("jobs").delete().eq("kind", "gmail-watch");
  await sb.from("connections").delete().in("id", conns!.map((c) => c.id));
});

Deno.test("gmail_reauth_due lists expiring (<24h) and invalid_grant connections only", async () => {
  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const { data: conns } = await sb.from("connections").insert([
    { user_id: POC_USER, provider: "gmail", account_ref: `soon-${crypto.randomUUID()}@example.com`, status: "active", expires_at: inHours(3) },
    { user_id: POC_USER, provider: "gmail", account_ref: `later-${crypto.randomUUID()}@example.com`, status: "active", expires_at: inHours(72) },
    { user_id: POC_USER, provider: "gmail", account_ref: `bad-${crypto.randomUUID()}@example.com`, status: "reauth_required", expires_at: inHours(72) },
  ]).select("id, account_ref");
  const { data } = await sb.rpc("gmail_reauth_due");
  const due = new Map((data as { connection_id: string; reason: string }[]).map((r) => [r.connection_id, r.reason]));
  const [soon, later, bad] = conns!;
  assertEquals(due.get(soon.id), "expiring");
  assertEquals(due.has(later.id), false);
  assertEquals(due.get(bad.id), "invalid_grant");
  await sb.from("connections").delete().in("id", conns!.map((c) => c.id));
});

Deno.test("gmail_save_connection keeps the refresh token in vault, readable only for the owner; webhook enqueue dedups", async () => {
  const account = `v-${crypto.randomUUID()}@example.com`;
  const rt = "synthetic-refresh-" + crypto.randomUUID();
  const { data: id, error } = await sb.rpc("gmail_save_connection", { p_user: POC_USER, p_account_ref: account, p_refresh_token: rt, p_history_id: "100" });
  assertEquals(error, null);
  assertEquals((await sb.rpc("gmail_get_refresh_token", { p_user: POC_USER, p_connection: id })).data, rt);
  assertEquals((await sb.rpc("gmail_get_refresh_token", { p_user: crypto.randomUUID(), p_connection: id })).data, null);
  // 재연결에서 Google이 refresh token을 주지 않으면(null) 기존 값 유지, 커서만 갱신
  await sb.rpc("gmail_save_connection", { p_user: POC_USER, p_account_ref: account, p_refresh_token: null, p_history_id: "200" });
  assertEquals((await sb.rpc("gmail_get_refresh_token", { p_user: POC_USER, p_connection: id })).data, rt);
  assertEquals((await sb.rpc("gmail_state", { p_user: POC_USER, p_connection: id })).data[0].cursor, "200");
  const { data: conn } = await sb.from("connections").select("expires_at").eq("id", id).single();
  assert(Date.parse(conn!.expires_at) > Date.now() + 6.9 * 86400_000);         // 테스트 모드 refresh token 7일
  // 다른 사용자가 같은 계정을 연결하면 거부
  const other = await sb.rpc("gmail_save_connection", { p_user: crypto.randomUUID(), p_account_ref: account, p_refresh_token: rt, p_history_id: "1" });
  assertEquals(other.error?.code, "P0001");
  // 웹훅 적재: 처음 1건, 대기 중이면 null, 모르는 계정 null
  const a = await sb.rpc("gmail_enqueue_for_account", { p_account_ref: account });
  const b = await sb.rpc("gmail_enqueue_for_account", { p_account_ref: account });
  const c = await sb.rpc("gmail_enqueue_for_account", { p_account_ref: "nobody@example.com" });
  assertEquals(typeof a.data, "string");
  assertEquals([b.data, c.data], [null, null]);
  await sb.from("jobs").delete().eq("lease_key", "gmail:" + id);
  await sb.from("connections").delete().eq("id", id);                         // 삭제 트리거가 vault 토큰도 지운다
});
