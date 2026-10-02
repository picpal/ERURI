import { assertEquals } from "jsr:@std/assert";
import { handleUnsubscribe, type Sink, type UnsubDeps } from "../functions/unsubscribe/handler.ts";

const SID = "11111111-2222-3333-4444-555555555555";
const SINK: Sink = { base: "https://proj.example.com/functions/v1/unsubscribe/sink", key: "k123abc" };
function deps(o: Partial<UnsubDeps> = {}) {
  const log: string[] = [];
  const d: UnsubDeps = {
    authUser: async (t) => (t === "good" ? "user-1" : null),
    begin: async () => ({ result: "ok", url_enc: "\\x00" }),
    decrypt: async () => "https://u.example.com/one",
    post: async (u) => { log.push("post:" + u); return { ok: true, code: "ok" }; },
    finish: async (_u, s, c) => { log.push(`finish:${s}:${c}`); },
    ...o,
  };
  return { d, log };
}
const req = (body: unknown, token: string | null = "good", path = "/unsubscribe") =>
  new Request("https://proj.example.com" + path, { method: "POST", headers: token ? { authorization: "Bearer " + token } : {},
    body: typeof body === "string" ? body : JSON.stringify(body) });

Deno.test("auth and input: 401 without/invalid token, 400 bad json/sender, 405 GET", async () => {
  const { d } = deps();
  assertEquals((await handleUnsubscribe(req({ sender_id: SID }, null), d, SINK)).status, 401);
  assertEquals((await handleUnsubscribe(req({ sender_id: SID }, "bad"), d, SINK)).status, 401);
  assertEquals((await handleUnsubscribe(req("{", "good"), d, SINK)).status, 400);
  assertEquals((await handleUnsubscribe(req({ sender_id: "x; drop" }), d, SINK)).status, 400);
  const get = new Request("https://proj.example.com/unsubscribe", { headers: { authorization: "Bearer good" } });
  assertEquals((await handleUnsubscribe(get, d, SINK)).status, 405);
});

Deno.test("ok path: begin → decrypt → post → finish(code) → requested", async () => {
  const { d, log } = deps();
  const r = await handleUnsubscribe(req({ sender_id: SID }), d, SINK);
  assertEquals([r.status, await r.json()], [200, { result: "requested", code: "ok" }]);
  assertEquals(log, ["post:https://u.example.com/one", `finish:${SID}:ok`]);
});

Deno.test("begin refusals pass through without decrypt/post/finish", async () => {
  for (const result of ["not_found", "unsupported", "busy", "already", "limit"]) {
    const { d, log } = deps({ begin: async () => ({ result }), decrypt: () => { throw new Error("must not decrypt"); } });
    const r = await handleUnsubscribe(req({ sender_id: SID }), d, SINK);
    assertEquals(await r.json(), { result });
    assertEquals(log, []);
  }
});

Deno.test("post failure, redirect and decrypt failure are recorded as failed with a code", async () => {
  for (const code of ["blocked_private", "redirect_307"]) {                                   // 3xx 는 접수가 아니다(리뷰 M1)
    const { d, log } = deps({ post: async () => ({ ok: false, code }) });
    assertEquals(await (await handleUnsubscribe(req({ sender_id: SID }), d, SINK)).json(), { result: "failed", code });
    assertEquals(log, [`finish:${SID}:${code}`]);
  }
  {
    const { d, log } = deps({ decrypt: () => Promise.reject(new Error("bad key")) });
    assertEquals(await (await handleUnsubscribe(req({ sender_id: SID }), d, SINK)).json(), { result: "failed", code: "error" });
    assertEquals(log, [`finish:${SID}:error`]);
  }
});

// 리뷰 N10: sink 는 secret 키 경로에서만 열린다
Deno.test("sink: only under the secret key; exact one-click body; /<key>/redirect → 307; closed without the secret", async () => {
  const { d } = deps();
  const at = (path: string, body = "List-Unsubscribe=One-Click", s: Sink = SINK) => handleUnsubscribe(req(body, null, path), d, s);
  assertEquals((await at("/unsubscribe/sink/k123abc")).status, 200);
  assertEquals((await at("/unsubscribe/sink/k123abc", "hello")).status, 400);
  const r = await at("/unsubscribe/sink/k123abc/redirect");
  assertEquals([r.status, r.headers.get("location")], [307, SINK!.base + "/k123abc"]);
  assertEquals((await at("/unsubscribe/sink/wrong")).status, 404);
  assertEquals((await at("/unsubscribe/sink")).status, 404);
  assertEquals((await at("/unsubscribe/sink/k123abc", undefined, null)).status, 404);
});
