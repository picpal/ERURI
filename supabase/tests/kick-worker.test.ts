import { assertEquals } from "jsr:@std/assert";
import { kickInBackground, kickWorker } from "../functions/_shared/kick-worker.ts";

// 가짜 fetch: 받은 요청을 기록하고 정한 응답(또는 abort 될 때까지 대기·오류)을 돌려준다
function fake(mode: { status?: number; hang?: boolean; throws?: boolean }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (mode.throws) return Promise.reject(new TypeError("network"));
    if (mode.hang) {
      return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    return Promise.resolve(new Response("{}", { status: mode.status ?? 200 }));
  }) as unknown as typeof fetch;
  return { f, calls };
}
const SECRET = "sb_secret_TESTONLY";

Deno.test("kickWorker POSTs {} to /functions/v1/worker with the service key", async () => {
  const { f, calls } = fake({ status: 200 });
  const logs: string[] = [];
  assertEquals(await kickWorker({ url: "https://x.supabase.co/", key: SECRET, fetch: f, log: (l) => logs.push(l) }), "ok");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://x.supabase.co/functions/v1/worker");
  assertEquals(calls[0].init.method, "POST");
  assertEquals(calls[0].init.body, "{}");
  assertEquals((calls[0].init.headers as Record<string, string>).authorization, `Bearer ${SECRET}`);
  assertEquals(logs, []);
});

Deno.test("kickWorker: a worker still running after the timeout is 'started' (normal, not logged)", async () => {
  const { f } = fake({ hang: true });
  const logs: string[] = [];
  assertEquals(await kickWorker({ url: "https://x", key: SECRET, fetch: f, timeoutMs: 10, log: (l) => logs.push(l) }), "started");
  assertEquals(logs, []);
});

Deno.test("kickWorker: http error, network error and missing env are logged as codes only (no key, no url)", async () => {
  const logs: string[] = [];
  const log = (l: string) => logs.push(l);
  assertEquals(await kickWorker({ url: "https://x", key: SECRET, fetch: fake({ status: 403 }).f, log }), "http_403");
  assertEquals(await kickWorker({ url: "https://x", key: SECRET, fetch: fake({ throws: true }).f, log }), "error");
  const none = fake({ status: 200 });
  assertEquals(await kickWorker({ url: "", key: SECRET, fetch: none.f, log }), "no_env");
  assertEquals(none.calls.length, 0);
  assertEquals(logs, ['{"kick_worker":"http_403"}', '{"kick_worker":"error"}', '{"kick_worker":"no_env"}']);
  for (const l of logs) { assertEquals(l.includes(SECRET), false); assertEquals(l.includes("https://x"), false); }
});

Deno.test("kickInBackground hands the promise to EdgeRuntime.waitUntil when present, and never throws", async () => {
  const held: Promise<unknown>[] = [];
  const g = globalThis as { EdgeRuntime?: unknown };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => held.push(p) };
  try {
    const p = kickInBackground({ url: "https://x", key: SECRET, fetch: fake({ status: 200 }).f });
    assertEquals(held.length, 1);
    assertEquals(await held[0], "ok");
    assertEquals(await p, "ok");
  } finally {
    delete g.EdgeRuntime;
  }
  // EdgeRuntime 없음(로컬): 그냥 띄운다. log 가 던져도 거부되지 않는다
  const bad = () => { throw new Error("log down"); };
  assertEquals(await kickInBackground({ url: "https://x", key: SECRET, fetch: fake({ status: 500 }).f, log: bad }), "error");
});
