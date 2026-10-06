import { assert, assertEquals } from "jsr:@std/assert";
import type { GmailClient, GmailMessage } from "../functions/_shared/gmail.ts";
import { gmailFetch, type GmailJobDeps, gmailSync, gmailUnsubFetch, noteGmailUnits, type RpcClient } from "../functions/_shared/gmail-jobs.ts";
import type { Job } from "../functions/_shared/job.ts";

// 수집 경로 units 기록(스펙 §7 "속도", 계획 D6): 기록만, fail-open, 잡당 차단기. 가짜 RPC·Gmail
const USER = "00000000-0000-0000-0000-0000000000aa", CONN = "00000000-0000-0000-0000-0000000000cc";
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const mk = (id: string): GmailMessage => ({ id, internalDate: "1790000000000", labelIds: ["INBOX"], payload: { mimeType: "text/plain",
  body: { data: b64("합성 본문") }, headers: [{ name: "From", value: "합성 <a@example.com>" }, { name: "Subject", value: "합성 안내" }] } });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `g${i + 1}`);
const job = (kind: string, payload: Record<string, unknown>): Job => ({ id: "j", kind, user_id: USER, payload: { connection_id: CONN, ...payload }, attempts: 1, checkpoint: null });
function rpcFake() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: RpcClient = { rpc: (fn, args = {}) => {
    calls.push({ fn, args });
    const data = fn === "gmail_get_refresh_token" ? "rt" : fn === "gmail_state" ? [{ cursor: "1", last_success_at: "2026-10-01T00:00:00Z" }]
      : fn === "insert_item" ? crypto.randomUUID() : null;
    return Promise.resolve({ data, error: null });
  } };
  return { rpc, calls };
}
function deps(noteUnits?: GmailJobDeps["noteUnits"], api: Partial<GmailClient> = {}): GmailJobDeps {
  return {
    refresh: () => Promise.resolve("at"),
    api: () => ({ history: () => Promise.resolve({ notFound: true as const }), listMessageIds: () => Promise.resolve({ messages: [] }),
      profile: () => Promise.resolve({ emailAddress: "x@example.com", historyId: "9" }), getMessage: (id) => Promise.resolve(mk(id)),
      getMessageMeta: (id) => Promise.resolve(mk(id)), watch: () => Promise.resolve({ historyId: "1", expiration: "1" }), ...api }),
    encrypt: (_u, t) => Promise.resolve(new TextEncoder().encode(t)), pause: () => Promise.resolve(), topic: () => "t", noteUnits,
  };
}
async function quiet<T>(f: () => Promise<T>): Promise<{ r: T; lines: string[] }> {
  const lines: string[] = [], orig = console.log;
  console.log = (s: unknown) => { lines.push(String(s)); };
  try { return { r: await f(), lines }; } finally { console.log = orig; }
}

Deno.test("gmail-fetch notes 20 units per message, once per 10 messages (23 → 200, 200, 60)", async () => {
  const notes: number[] = [];
  const { rpc } = rpcFake();
  await quiet(() => gmailFetch(rpc, job("gmail-fetch", { ids: ids(23) }), deps((_s, _u, n) => { notes.push(n); return Promise.resolve(true); })));
  assertEquals(notes, [200, 200, 60]);
});

Deno.test("units note fails open: the fetch still stores every message, later notes in that job are skipped, one log line", async () => {
  let calls = 0;
  const { rpc, calls: rc } = rpcFake();
  const { r, lines } = await quiet(() => gmailFetch(rpc, job("gmail-fetch", { ids: ids(23) }), deps(() => { calls++; return Promise.resolve(false); })));
  assertEquals([r, calls, rc.filter((c) => c.fn === "insert_item").length], ["fetched", 1, 23]);
  assertEquals(lines.filter((l) => l.includes("units_note_error")).length, 1);
});

Deno.test("without a noteUnits dep nothing is noted (old fakes and tests keep their RPC order)", async () => {
  const { rpc, calls } = rpcFake();
  await quiet(() => gmailFetch(rpc, job("gmail-fetch", { ids: ids(3) }), deps()));
  assertEquals(calls.filter((c) => c.fn === "gmail_note_units").length, 0);
});

Deno.test("gmail-sync notes 2 per history page, 1 for profile, 5 per list page (resync)", async () => {
  const notes: number[] = [];
  const { rpc } = rpcFake();
  await quiet(() => gmailSync(rpc, job("gmail-sync", {}), deps((_s, _u, n) => { notes.push(n); return Promise.resolve(true); }, {
    listMessageIds: (_q, p) => Promise.resolve(p ? { messages: [{ id: "b" }] } : { messages: [{ id: "a" }], nextPageToken: "2" }) })));
  assertEquals(notes, [2, 1, 5, 5]);
});

Deno.test("gmail-unsub-fetch notes 20 per header read, once per 10 (12 → 200, 40)", async () => {
  const notes: number[] = [];
  const { rpc } = rpcFake();
  await quiet(() => gmailUnsubFetch(rpc, job("gmail-unsub-fetch", { msgs: ids(12).map((id) => ({ id, item: null })) }),
    deps((_s, _u, n) => { notes.push(n); return Promise.resolve(true); })));
  assertEquals(notes, [200, 40]);
});

Deno.test("noteGmailUnits: ok → true; RPC error (e.g. function missing before 0030) → false; a hanging RPC → false within the budget", async () => {
  const ok = await noteGmailUnits({ rpc: () => Promise.resolve({ data: null, error: null }) }, USER, 20);
  const bad = await noteGmailUnits({ rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202" } }) }, USER, 20);
  const t0 = performance.now();
  const hang = await noteGmailUnits({ rpc: () => new Promise(() => {}) }, USER, 20, 50);
  assertEquals([ok, bad, hang], [true, false, false]);
  assert(performance.now() - t0 < 1000);
});
