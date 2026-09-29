import { assertEquals } from "jsr:@std/assert";
import { type AccountDeps, handleAccount } from "../functions/account/handler.ts";

function fake(o: { conns?: string[]; revokeFails?: boolean; wipeFails?: boolean } = {}) {
  const calls: string[] = [];
  const d: AccountDeps = {
    authUser: async (t) => (t === "user-jwt" ? "u1" : null),
    connections: async () => o.conns ?? ["c1"],
    refreshToken: async (_u, c) => `rt-${c}`,
    revoke: async (t) => { calls.push("revoke:" + t); if (o.revokeFails) throw new Error("revoke 400"); },
    deleteGmailSource: async (_u, c) => { calls.push("source:" + c); return { items: 2, facts: 1, jobs: 3 }; },
    wipeDevices: async () => { calls.push("wipe"); if (o.wipeFails) throw new Error("apns"); return 1; },
    removeStorage: async () => { calls.push("storage"); return 0; },
    audit: async (_u, a) => { calls.push("audit:" + a); },
    deleteUser: async () => { calls.push("delete_user"); },
  };
  return { d, calls };
}
const req = (path: string, body?: unknown, token: string | null = "user-jwt", method = "POST") => new Request(`http://x/account/${path}`, {
  method, body: body === undefined ? undefined : JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {} });

Deno.test("account: 401 without user JWT; 405 non-POST; 404 unknown path; 400 unknown provider", async () => {
  const { d, calls } = fake();
  assertEquals((await handleAccount(req("delete", undefined, null), d)).status, 401);
  assertEquals((await handleAccount(req("delete", undefined, "user-jwt", "GET"), d)).status, 405);
  assertEquals((await handleAccount(req("nope"), d)).status, 404);
  assertEquals((await handleAccount(req("source", { provider: "outlook" }), d)).status, 400);
  assertEquals(calls, []);
});

Deno.test("account/source gmail: revoke then delete each connection; a failed revoke does not stop deletion", async () => {
  const { d, calls } = fake({ conns: ["c1", "c2"], revokeFails: true });
  const r = await handleAccount(req("source", { provider: "gmail" }), d);
  assertEquals(r.status, 200);
  assertEquals(calls, ["revoke:rt-c1", "revoke:rt-c2", "source:c1", "source:c2"]);
  assertEquals(await r.json(), { provider: "gmail", connections: 2, revoked: 0, revoke_failed: 2,
    deleted: [{ items: 2, facts: 1, jobs: 3 }, { items: 2, facts: 1, jobs: 3 }] });
});

Deno.test("account/delete: revoke → wipe devices → storage → audit → delete user; wipe failure does not block", async () => {
  const { d, calls } = fake({ wipeFails: true });
  const r = await handleAccount(req("delete"), d);
  assertEquals(r.status, 200);
  assertEquals(calls, ["revoke:rt-c1", "wipe", "storage", "audit:account_delete", "delete_user"]);
  assertEquals((await r.json()).devices_wiped, 0);
});
